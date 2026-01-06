<?php
// API backend para vogue.bisonbyte.io
// Ahora persiste en MySQL (cPanel) en lugar de archivos JSON locales.

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/src/bootstrap.php';

$config = loadConfig();
$corsOrigin = $config['cors_allowed_origin'] ?? '*';

header('Content-Type: application/json; charset=utf-8');
header('Access-Control-Allow-Origin: ' . $corsOrigin);
header('Vary: Origin');
header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

// Usuario administrador (se puede mover a BD más adelante).
// Contraseña actual: 123 (password_hash) si no se define ADMIN_PASSWORD_HASH.
$ADMIN_USER = [
    'username' => getenv('ADMIN_USERNAME') ?: 'admin',
    'password_hash' => getenv('ADMIN_PASSWORD_HASH') ?: '$2y$10$a/E5YHHMGHoKLZbI.tU8w.U8dsXo3iIE.CUzK/oQuaXfOFcyfxOSG',
    'nombre' => getenv('ADMIN_NAME') ?: 'Administrador',
];

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
            global $ADMIN_USER;
            $username = isset($body['username']) ? trim($body['username']) : '';
            $password = isset($body['password']) ? $body['password'] : '';
            $ip = $_SERVER['REMOTE_ADDR'] ?? 'unknown';
            if (!loginRateCheck($ip)) {
                logAction('login_blocked', ['username' => $username, 'ip' => $ip]);
                respond(['error' => 'Demasiados intentos. Intenta de nuevo más tarde.'], 429);
            }
            if ($username !== $ADMIN_USER['username'] || !password_verify($password, $ADMIN_USER['password_hash'])) {
                loginRateRegisterFail($ip);
                logAction('login_failed', ['username' => $username]);
                respond(['error' => 'Credenciales incorrectas'], 401);
            }
            loginRateReset($ip);
            session_regenerate_id(true);
            $_SESSION['user'] = [
                'username' => $ADMIN_USER['username'],
                'nombre' => $ADMIN_USER['nombre']
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

        case 'save':
            requireAuth();
            if ($method !== 'POST') respond(['error' => 'POST required'], 405);
            $key = isset($body['key']) ? $body['key'] : null;
            $value = array_key_exists('value', $body) ? $body['value'] : null;
            if (!is_string($key) || $key === '') respond(['error' => 'key required'], 400);
            kvSet($key, $value);
            logAction('kv_save', ['key' => $key]);
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
            kvDelete($key);
            logAction('kv_delete', ['key' => $key]);
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
                $deleted = deleteClient($id);
                logAction('client_delete', ['id' => $id]);
                respond(['ok' => $deleted]);
            } else {
                respond(['error' => 'Método no permitido'], 405);
            }
            break;

        default:
            respond(['error' => 'Not found'], 404);
    }
} catch (Exception $e) {
    respond(['error' => $e->getMessage()], 500);
}
