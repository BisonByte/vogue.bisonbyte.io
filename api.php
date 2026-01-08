<?php
// API backend para vogue.bisonbyte.io
// Ahora persiste en MySQL (cPanel) en lugar de archivos JSON locales.

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/src/bootstrap.php';
require_once __DIR__ . '/mailer.php';

$config = loadConfig();
$corsOrigin = $config['cors_allowed_origin'] ?? '*';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: ' . $corsOrigin);
header('Vary: Origin');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Usuario administrador (se puede sobrescribir por BD con kv_store).
// Contraseña actual: 123 (password_hash) si no se define ADMIN_PASSWORD_HASH.
function getAdminUser(): array {
    $user = [
        'username' => getenv('ADMIN_USERNAME') ?: 'admin',
        'password_hash' => getenv('ADMIN_PASSWORD_HASH') ?: '$2y$10$a/E5YHHMGHoKLZbI.tU8w.U8dsXo3iIE.CUzK/oQuaXfOFcyfxOSG',
        'nombre' => getenv('ADMIN_NAME') ?: 'Administrador',
    ];

    $dbUser = kvGet('vogue_admin_user');
    $dbHash = kvGet('vogue_admin_password_hash');
    $dbName = kvGet('vogue_admin_name');

    if (is_string($dbUser) && $dbUser !== '') {
        $user['username'] = $dbUser;
    }
    if (is_string($dbHash) && $dbHash !== '') {
        $user['password_hash'] = $dbHash;
    }
    if (is_string($dbName) && $dbName !== '') {
        $user['nombre'] = $dbName;
    }

    return $user;
}

vogue_start_session();

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function requireAuth() {
    vogue_require_auth();
}

$storageDir = __DIR__ . '/storage';

function ensureStorageDir() {
    global $storageDir;
    if (!is_dir($storageDir)) {
        @mkdir($storageDir, 0700, true);
    }
}

function validateTransaction($tx) {
    if (!is_array($tx)) return false;
    if (!isset($tx['tipo']) || !is_string($tx['tipo'])) return false;
    if (!isset($tx['monto']) || !is_numeric($tx['monto'])) return false;
    if ($tx['monto'] < 0) return false;
    if (isset($tx['cliente']) && strlen((string)$tx['cliente']) > 255) return false;
    if (isset($tx['descripcion']) && strlen((string)$tx['descripcion']) > 1000) return false;
    return true;
}

function logAction($action, $details = []) {
    global $storageDir;
    ensureStorageDir();
    $logFile = $storageDir . '/vogue.log';
    $entry = [
        'time' => date('c'),
        'ip' => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        'user' => $_SESSION['user']['username'] ?? null,
        'action' => $action,
        'details' => $details
    ];
    @file_put_contents($logFile, json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . PHP_EOL, FILE_APPEND | LOCK_EX);
}

function readRateData() {
    global $storageDir;
    ensureStorageDir();
    $file = $storageDir . '/rate_limit.json';
    if (!file_exists($file)) return [];
    $raw = @file_get_contents($file);
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function writeRateData($data) {
    global $storageDir;
    ensureStorageDir();
    $file = $storageDir . '/rate_limit.json';
    $tmp = $file . '.tmp';
    @file_put_contents($tmp, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES), LOCK_EX);
    @rename($tmp, $file);
}

function loginRateCheck($ip) {
    $data = readRateData();
    if (!isset($data[$ip])) return true;
    $now = time();
    if (!empty($data[$ip]['blockedUntil']) && $data[$ip]['blockedUntil'] > $now) {
        return false;
    }
    return true;
}

function loginRateRegisterFail($ip) {
    $data = readRateData();
    $now = time();
    $entry = $data[$ip] ?? ['fails' => 0, 'blockedUntil' => 0];
    if (!empty($entry['blockedUntil']) && $entry['blockedUntil'] > $now) {
        $data[$ip] = $entry;
        writeRateData($data);
        return;
    }
    $entry['fails'] = ($entry['fails'] ?? 0) + 1;
    if ($entry['fails'] >= 5) {
        $entry['blockedUntil'] = $now + 15 * 60;
        $entry['fails'] = 0;
    }
    $data[$ip] = $entry;
    writeRateData($data);
}

function loginRateReset($ip) {
    $data = readRateData();
    if (isset($data[$ip])) {
        unset($data[$ip]);
        writeRateData($data);
    }
}

function respond($data, $code = 200) {
    vogue_json_response($data, $code);
}

function respondHtml(string $html, int $code = 200): never {
    if (!headers_sent()) {
        header('Content-Type: text/html; charset=utf-8');
    }
    http_response_code($code);
    echo $html;
    exit;
}

function actorContext(): array {
    return [
        'user' => $_SESSION['user']['username'] ?? 'desconocido',
        'ip' => $_SERVER['REMOTE_ADDR'] ?? 'unknown',
        'ua' => $_SERVER['HTTP_USER_AGENT'] ?? 'unknown',
        'time' => date('c')
    ];
}

function notifySecurityEvent(string $subject, array $lines, array $context): void {
    $text = $subject . PHP_EOL;
    $text .= "Usuario: {$context['user']}" . PHP_EOL;
    $text .= "IP: {$context['ip']}" . PHP_EOL;
    $text .= "Hora: {$context['time']}" . PHP_EOL;
    $text .= "Agente: {$context['ua']}" . PHP_EOL . PHP_EOL;
    $text .= implode(PHP_EOL, $lines);
    sendSecurityEmail($subject, $text);
}

function normalizeValue($value): string {
    if (is_bool($value)) {
        return $value ? 'true' : 'false';
    }
    if ($value === null) {
        return '';
    }
    if (is_scalar($value)) {
        return (string) $value;
    }
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}

function deleteIntentIsValid(): bool {
    $raw = $_SERVER['HTTP_X_VOGUE_DELETE_INTENT'] ?? '';
    if (!is_string($raw) || $raw === '' || !ctype_digit($raw)) {
        return false;
    }
    $ts = (int) $raw;
    if ($ts <= 0) {
        return false;
    }
    $now = (int) round(microtime(true) * 1000);
    $age = $now - $ts;
    return $age >= 0 && $age <= (5 * 60 * 1000);
}

function requireDeleteIntent(string $action, array $details = []): void {
    if (deleteIntentIsValid()) {
        return;
    }
    $payload = array_merge(['action' => $action], $details);
    logAction('delete_blocked', $payload);
    respond(['error' => 'delete intent required'], 409);
}

function indexById(array $items): array {
    $map = [];
    foreach ($items as $item) {
        if (!is_array($item)) {
            continue;
        }
        if (!array_key_exists('id', $item)) {
            continue;
        }
        $id = (string) $item['id'];
        $map[$id] = $item;
    }
    return $map;
}

function diffItems(array $oldItems, array $newItems, array $fields): array {
    $oldMap = indexById($oldItems);
    $newMap = indexById($newItems);
    $deleted = [];
    $updated = [];

    foreach ($oldMap as $id => $oldItem) {
        if (!array_key_exists($id, $newMap)) {
            $deleted[$id] = $oldItem;
            continue;
        }
        $newItem = $newMap[$id];
        $changes = [];
        foreach ($fields as $field) {
            $oldValue = normalizeValue($oldItem[$field] ?? null);
            $newValue = normalizeValue($newItem[$field] ?? null);
            if ($oldValue !== $newValue) {
                $changes[] = [
                    'field' => $field,
                    'from' => $oldValue,
                    'to' => $newValue
                ];
            }
        }
        if (!empty($changes)) {
            $updated[$id] = [
                'old' => $oldItem,
                'new' => $newItem,
                'changes' => $changes
            ];
        }
    }

    return ['deleted' => $deleted, 'updated' => $updated];
}

function deletedCountForKey(string $key, $oldValue, $newValue): int {
    if (!is_array($oldValue)) {
        return 0;
    }
    $fields = [];
    if ($key === 'vogue_clientes') {
        $fields = [
            'nombre',
            'enlace',
            'enlaceActualizado',
            'direccionEnvio',
            'notas',
            'pagoCompletado',
            'pedidoCompletado',
            'entregado'
        ];
    } elseif ($key === 'vogue_transacciones') {
        $fields = [
            'tipo',
            'subTipo',
            'monto',
            'cliente',
            'enlace',
            'descripcion',
            'direccionEnvio',
            'fecha'
        ];
    }
    if (empty($fields)) {
        return 0;
    }
    if (!is_array($newValue)) {
        return count($oldValue);
    }
    $diff = diffItems($oldValue, $newValue, $fields);
    return count($diff['deleted']);
}

function summarizeClient(array $client): string {
    $name = $client['nombre'] ?? 'Cliente';
    $id = $client['id'] ?? '';
    return trim($name . ($id !== '' ? " (#{$id})" : ''));
}

function summarizeTransaction(array $tx): string {
    $name = $tx['cliente'] ?? 'Registro';
    $id = $tx['id'] ?? '';
    $tipo = $tx['tipo'] ?? '';
    return trim($name . ($tipo !== '' ? " ({$tipo})" : '') . ($id !== '' ? " (#{$id})" : ''));
}

function notifyClientChanges($old, $new): void {
    if (!is_array($old) || !is_array($new)) {
        return;
    }
    $fields = [
        'nombre',
        'enlace',
        'enlaceActualizado',
        'direccionEnvio',
        'notas',
        'pagoCompletado',
        'pedidoCompletado',
        'entregado'
    ];
    $diff = diffItems($old, $new, $fields);
    if (empty($diff['deleted']) && empty($diff['updated'])) {
        return;
    }
    $lines = [];
    foreach (array_slice($diff['deleted'], 0, 5) as $client) {
        $lines[] = 'Cliente eliminado: ' . summarizeClient($client);
    }
    if (count($diff['deleted']) > 5) {
        $lines[] = '... y ' . (count($diff['deleted']) - 5) . ' mas';
    }
    foreach (array_slice($diff['updated'], 0, 5, true) as $data) {
        $lines[] = 'Cliente actualizado: ' . summarizeClient($data['new']);
        foreach ($data['changes'] as $change) {
            $lines[] = "  - {$change['field']}: \"{$change['from']}\" -> \"{$change['to']}\"";
        }
    }
    if (count($diff['updated']) > 5) {
        $lines[] = '... y ' . (count($diff['updated']) - 5) . ' cambios mas';
    }
    notifySecurityEvent('[Vogue] Cambios en clientes', $lines, actorContext());
}

function notifyTransactionChanges($old, $new): void {
    if (!is_array($old) || !is_array($new)) {
        return;
    }
    $fields = [
        'tipo',
        'subTipo',
        'monto',
        'cliente',
        'enlace',
        'descripcion',
        'direccionEnvio',
        'fecha'
    ];
    $diff = diffItems($old, $new, $fields);
    if (empty($diff['deleted']) && empty($diff['updated'])) {
        return;
    }
    $lines = [];
    foreach (array_slice($diff['deleted'], 0, 5) as $tx) {
        $lines[] = 'Registro eliminado: ' . summarizeTransaction($tx);
    }
    if (count($diff['deleted']) > 5) {
        $lines[] = '... y ' . (count($diff['deleted']) - 5) . ' mas';
    }
    foreach (array_slice($diff['updated'], 0, 5, true) as $data) {
        $lines[] = 'Registro actualizado: ' . summarizeTransaction($data['new']);
        foreach ($data['changes'] as $change) {
            $lines[] = "  - {$change['field']}: \"{$change['from']}\" -> \"{$change['to']}\"";
        }
    }
    if (count($diff['updated']) > 5) {
        $lines[] = '... y ' . (count($diff['updated']) - 5) . ' cambios mas';
    }
    notifySecurityEvent('[Vogue] Cambios en historial', $lines, actorContext());
}

function resetRateCheck(string $ip): bool {
    $data = readRateData();
    $entry = $data['reset'][$ip] ?? ['count' => 0, 'window' => time()];
    $now = time();
    if ($now - ($entry['window'] ?? 0) > 30 * 60) {
        $entry = ['count' => 0, 'window' => $now];
    }
    return ($entry['count'] ?? 0) < 3;
}

function resetRateRegister(string $ip): void {
    $data = readRateData();
    $entry = $data['reset'][$ip] ?? ['count' => 0, 'window' => time()];
    $now = time();
    if ($now - ($entry['window'] ?? 0) > 30 * 60) {
        $entry = ['count' => 0, 'window' => $now];
    }
    $entry['count'] = ($entry['count'] ?? 0) + 1;
    $entry['window'] = $entry['window'] ?? $now;
    $data['reset'][$ip] = $entry;
    writeRateData($data);
}

// Routing
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$action = strtolower(trim($path, '/'));
if (strpos($action, 'api/') === 0) {
    $action = substr($action, 4);
}

$method = $_SERVER['REQUEST_METHOD'];
$bodyRaw = file_get_contents('php://input');
$body = json_decode($bodyRaw, true);
if (!is_array($body)) $body = [];

try {
    switch ($action) {
        case 'login':
            if ($method !== 'POST') respond(['error' => 'POST required'], 405);
            $adminUser = getAdminUser();
            $username = isset($body['username']) ? trim($body['username']) : '';
            $password = isset($body['password']) ? $body['password'] : '';
            $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
            if (!loginRateCheck($ip)) {
                logAction('login_blocked', ['username' => $username, 'ip' => $ip]);
                respond(['error' => 'Demasiados intentos. Intenta de nuevo más tarde.'], 429);
            }
            if ($username !== $adminUser['username'] || !password_verify($password, $adminUser['password_hash'])) {
                loginRateRegisterFail($ip);
                logAction('login_failed', ['username' => $username]);
                respond(['error' => 'Credenciales incorrectas'], 401);
            }
            loginRateReset($ip);
            session_regenerate_id(true);
            $_SESSION['user'] = [
                'username' => $adminUser['username'],
                'nombre' => $adminUser['nombre']
            ];
            logAction('login_success', ['username' => $username]);
            respond(['ok' => true, 'user' => $_SESSION['user']]);
            break;

        case 'logout':
            session_unset();
            session_destroy();
            logAction('logout', []);
            respond(['ok' => true]);
            break;

        case 'me':
            if (empty($_SESSION['user'])) {
                respond(['user' => null]);
            } else {
                respond(['user' => $_SESSION['user']]);
            }
            break;

        case 'profile':
            requireAuth();
            if ($method === 'GET') {
                $adminUser = getAdminUser();
                respond([
                    'profile' => [
                        'username' => $adminUser['username'],
                        'nombre' => $adminUser['nombre']
                    ]
                ]);
            }
            if ($method !== 'POST') respond(['error' => 'POST required'], 405);
            $current = isset($body['currentPassword']) ? (string) $body['currentPassword'] : '';
            if ($current === '') respond(['error' => 'currentPassword requerido'], 400);
            $adminUser = getAdminUser();
            if (!password_verify($current, $adminUser['password_hash'])) {
                respond(['error' => 'Contraseña actual incorrecta'], 401);
            }

            $newUser = isset($body['username']) ? trim((string) $body['username']) : '';
            $newName = isset($body['nombre']) ? trim((string) $body['nombre']) : '';

            if ($newUser !== '') {
                kvSet('vogue_admin_user', $newUser);
                $_SESSION['user']['username'] = $newUser;
            }
            if ($newName !== '') {
                kvSet('vogue_admin_name', $newName);
                $_SESSION['user']['nombre'] = $newName;
            }
            respond(['ok' => true]);
            break;

        case 'change-password':
            requireAuth();
            if ($method !== 'POST') respond(['error' => 'POST required'], 405);
            $current = isset($body['currentPassword']) ? (string) $body['currentPassword'] : '';
            $new = isset($body['newPassword']) ? (string) $body['newPassword'] : '';
            $confirm = isset($body['confirmPassword']) ? (string) $body['confirmPassword'] : '';

            if ($current === '' || $new === '') {
                respond(['error' => 'Campos incompletos'], 400);
            }
            if (strlen($new) < 8) {
                respond(['error' => 'La contraseña debe tener al menos 8 caracteres'], 400);
            }
            if ($new !== $confirm) {
                respond(['error' => 'Las contraseñas no coinciden'], 400);
            }
            $adminUser = getAdminUser();
            if (!password_verify($current, $adminUser['password_hash'])) {
                respond(['error' => 'Contraseña actual incorrecta'], 401);
            }

            $hash = password_hash($new, PASSWORD_BCRYPT);
            kvSet('vogue_admin_password_hash', $hash);
            respond(['ok' => true]);
            break;

        case 'backups':
        case 'backup-list':
            requireAuth();
            if ($method !== 'GET') respond(['error' => 'GET required'], 405);
            $backupDir = __DIR__ . '/storage/backups';
            $files = [];
            if (is_dir($backupDir)) {
                foreach (scandir($backupDir) as $file) {
                    if ($file === '.' || $file === '..') continue;
                    if (!preg_match('/\\.json$/', $file)) continue;
                    $path = $backupDir . '/' . $file;
                    if (!is_file($path)) continue;
                    $files[] = [
                        'name' => $file,
                        'size' => filesize($path),
                        'modified' => filemtime($path)
                    ];
                }
                usort($files, function ($a, $b) {
                    return ($b['modified'] ?? 0) <=> ($a['modified'] ?? 0);
                });
            }
            respond(['files' => $files]);
            break;

        case 'backup-create':
            requireAuth();
            if ($method !== 'POST' && $method !== 'GET') respond(['error' => 'POST required'], 405);
            $storageDir = __DIR__ . '/storage';
            $backupDir  = $storageDir . '/backups';
            if (!is_dir($backupDir)) {
                @mkdir($backupDir, 0700, true);
            }
            $payload = [
                'exportedAt' => date('c'),
                'kv' => kvAll(),
                'items' => listItems(),
                'clients' => listClients()
            ];
            $date = date('Y-m-d_H-i-s');
            $backupFile = $backupDir . '/vogue-backup-' . $date . '.json';
            file_put_contents($backupFile, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
            @chmod($backupFile, 0600);
            respond([
                'ok' => true,
                'file' => basename($backupFile),
                'counts' => [
                    'kv' => count($payload['kv']),
                    'items' => count($payload['items']),
                    'clients' => count($payload['clients'])
                ]
            ]);
            break;

        case 'backup-download':
            requireAuth();
            if ($method !== 'GET') respond(['error' => 'GET required'], 405);
            $file = isset($_GET['file']) ? basename((string) $_GET['file']) : '';
            if ($file === '') respond(['error' => 'file required'], 400);
            $backupDir = __DIR__ . '/storage/backups';
            $path = $backupDir . '/' . $file;
            if (!is_file($path)) {
                respond(['error' => 'File not found'], 404);
            }
            header('Content-Type: application/json; charset=utf-8');
            header('Content-Disposition: attachment; filename="' . $file . '"');
            readfile($path);
            exit;

        case 'save':
            requireAuth();
            if ($method !== 'POST') respond(['error' => 'POST required'], 405);
            $key = isset($body['key']) ? $body['key'] : null;
            $value = array_key_exists('value', $body) ? $body['value'] : null;
            if (!is_string($key) || $key === '') respond(['error' => 'key required'], 400);
            $oldValue = null;
            if ($key === 'vogue_clientes' || $key === 'vogue_transacciones') {
                $oldValue = kvGet($key);
                $deletedCount = deletedCountForKey($key, $oldValue, $value);
                if ($deletedCount > 0) {
                    requireDeleteIntent('kv_save', ['key' => $key, 'deleted' => $deletedCount]);
                }
            }
            kvSet($key, $value);
            logAction('kv_save', ['key' => $key]);
            if ($key === 'vogue_clientes') {
                notifyClientChanges($oldValue, is_array($value) ? $value : []);
            }
            if ($key === 'vogue_transacciones') {
                notifyTransactionChanges($oldValue, is_array($value) ? $value : []);
            }
            respond(['ok' => true]);
            break;

        case 'load':
            requireAuth();
            $key = isset($_GET['key']) ? $_GET['key'] : null;
            if (!$key) respond(['error' => 'key required'], 400);
            $value = kvGet($key);
            respond(['value' => $value]);
            break;

        case 'item':
            requireAuth();
            if ($method !== 'POST') respond(['error' => 'POST required'], 405);
            $data = array_key_exists('data', $body) ? $body['data'] : $body;
            if (!validateTransaction($data)) {
                respond(['error' => 'Datos de transacción inválidos'], 400);
            }
            $id = addItem($data);
            logAction('item_add', ['id' => $id]);
            respond(['ok' => true, 'id' => $id]);
            break;

        case 'items':
            requireAuth();
            $items = listItems();
            respond(['items' => $items]);
            break;

        case 'export':
            requireAuth();
            respond([
                'exportedAt' => (int) round(microtime(true) * 1000),
                'kv' => kvAll(),
                'items' => listItems()
            ]);
            break;

        case 'import':
            requireAuth();
            if ($method !== 'POST') respond(['error' => 'POST required'], 405);
            $payload = $body;
            $now = (int) round(microtime(true) * 1000);
            if (isset($payload['kv']) && is_array($payload['kv'])) {
                foreach ($payload['kv'] as $k => $v) {
                    kvSet($k, $v);
                }
            }
            if (isset($payload['items']) && is_array($payload['items'])) {
                foreach ($payload['items'] as $it) {
                    $itemData = is_array($it) && array_key_exists('data', $it) ? $it['data'] : $it;
                    $createdAt = is_array($it) && array_key_exists('created_at', $it) ? (int) $it['created_at'] : $now;
                    addItem($itemData, $createdAt);
                }
            }
            logAction('import', ['items' => isset($payload['items']) ? count($payload['items']) : 0]);
            respond(['ok' => true]);
            break;

        case 'delete':
            requireAuth();
            $key = isset($_GET['key']) ? $_GET['key'] : (isset($body['key']) ? $body['key'] : null);
            if (!$key) respond(['error' => 'key required'], 400);
            requireDeleteIntent('kv_delete', ['key' => $key]);
            $oldValue = kvGet($key);
            kvDelete($key);
            logAction('kv_delete', ['key' => $key]);
            if ($key === 'vogue_clientes' && is_array($oldValue)) {
                notifySecurityEvent('[Vogue] Lista de clientes eliminada', ['Se elimino la lista completa de clientes.'], actorContext());
            }
            if ($key === 'vogue_transacciones' && is_array($oldValue)) {
                notifySecurityEvent('[Vogue] Historial eliminado', ['Se elimino el historial completo.'], actorContext());
            }
            respond(['ok' => true]);
            break;

        case 'clients':
        case 'clientes':
            requireAuth();
            if ($method !== 'GET') respond(['error' => 'GET required'], 405);
            $clients = listClients();
            respond(['clients' => $clients]);
            break;

        case 'client':
        case 'cliente':
            requireAuth();
            if ($method === 'POST') {
                $id = createClient($body);
                logAction('client_add', ['id' => $id]);
                respond(['ok' => true, 'id' => $id]);
            } elseif ($method === 'PUT') {
                $id = isset($body['id']) ? (int) $body['id'] : 0;
                if ($id <= 0) respond(['error' => 'id requerido'], 400);
                updateClient($id, $body);
                logAction('client_update', ['id' => $id]);
                respond(['ok' => true, 'id' => $id]);
            } elseif ($method === 'DELETE') {
                $id = isset($_GET['id']) ? (int) $_GET['id'] : (isset($body['id']) ? (int) $body['id'] : 0);
                if ($id <= 0) respond(['error' => 'id requerido'], 400);
                requireDeleteIntent('client_delete', ['id' => $id]);
                $deleted = deleteClient($id);
                logAction('client_delete', ['id' => $id]);
                respond(['ok' => $deleted]);
            } else {
                respond(['error' => 'Método no permitido'], 405);
            }
            break;

        case 'forgot-password':
            if ($method !== 'POST') respond(['error' => 'POST required'], 405);
            $payload = $body;
            if (!is_array($payload) || empty($payload)) {
                $payload = $_POST ?? [];
            }
            $username = isset($payload['username']) ? trim((string) $payload['username']) : '';
            $adminUser = getAdminUser();
            $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
            if (!resetRateCheck($ip)) {
                respond(['ok' => true]);
            }
            resetRateRegister($ip);
            if ($username === '' || $username === $adminUser['username']) {
                $token = bin2hex(random_bytes(16));
                $tokenHash = password_hash($token, PASSWORD_BCRYPT);
                $expires = time() + 30 * 60;
                kvSet('vogue_reset_token_hash', $tokenHash);
                kvSet('vogue_reset_token_exp', $expires);
                $config = loadConfig();
                $baseUrl = $config['app_url'] ?? ('https://' . ($_SERVER['HTTP_HOST'] ?? 'localhost'));
                $link = rtrim($baseUrl, '/') . '/api/reset-password?token=' . urlencode($token);
                $lines = [
                    'Solicitud de recuperacion de contrasena.',
                    'Usuario: ' . $adminUser['username'],
                    'Enlace: ' . $link,
                    'Este enlace vence en 30 minutos.'
                ];
                notifySecurityEvent('[Vogue] Recuperacion de contrasena', $lines, actorContext());
            }
            respond(['ok' => true]);
            break;

        case 'reset-password':
            if ($method === 'GET') {
                $token = isset($_GET['token']) ? (string) $_GET['token'] : '';
                if ($token === '') {
                    respondHtml('<h1>Token invalido</h1>', 400);
                }
                $html = '<!doctype html><html><head><meta charset="utf-8"><title>Restablecer contraseña</title>'
                    . '<style>body{font-family:Arial,sans-serif;background:#f8fafc;padding:24px}form{max-width:420px;margin:0 auto;background:#fff;padding:20px;border-radius:12px;box-shadow:0 10px 24px rgba(15,23,42,.1)}label{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#64748b;margin-bottom:6px}input{width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;margin-bottom:12px}button{width:100%;padding:10px 12px;border:none;border-radius:10px;background:#0f172a;color:#fff;font-weight:700}</style>'
                    . '</head><body><form method="post"><h2>Restablecer contraseña</h2>'
                    . '<input type="hidden" name="token" value="' . htmlspecialchars($token, ENT_QUOTES, 'UTF-8') . '">'
                    . '<label>Nueva contraseña</label><input type="password" name="newPassword" required>'
                    . '<label>Confirmar contraseña</label><input type="password" name="confirmPassword" required>'
                    . '<button type="submit">Guardar</button></form></body></html>';
                respondHtml($html);
            }
            if ($method !== 'POST') respond(['error' => 'POST required'], 405);
            $payload = $body;
            if (!is_array($payload) || empty($payload)) {
                $payload = $_POST ?? [];
            }
            $token = isset($payload['token']) ? (string) $payload['token'] : '';
            $new = isset($payload['newPassword']) ? (string) $payload['newPassword'] : '';
            $confirm = isset($payload['confirmPassword']) ? (string) $payload['confirmPassword'] : '';
            if ($token === '') respondHtml('<h1>Token invalido</h1>', 400);
            if ($new === '' || strlen($new) < 8) respondHtml('<h1>Contrasena invalida</h1>', 400);
            if ($new !== $confirm) respondHtml('<h1>Las contrasenas no coinciden</h1>', 400);
            $hash = kvGet('vogue_reset_token_hash');
            $exp = (int) kvGet('vogue_reset_token_exp');
            if (!$hash || $exp < time() || !password_verify($token, $hash)) {
                respondHtml('<h1>Token expirado o invalido</h1>', 400);
            }
            kvSet('vogue_admin_password_hash', password_hash($new, PASSWORD_BCRYPT));
            kvDelete('vogue_reset_token_hash');
            kvDelete('vogue_reset_token_exp');
            respondHtml('<h1>Contrasena actualizada. Ya puedes iniciar sesion.</h1>');
            break;

        default:
            respond(['error' => 'Not found'], 404);
    }
} catch (Exception $e) {
    respond(['error' => $e->getMessage()], 500);
}
