<?php
// Backup sencillo: exporta kv, items y clients desde MySQL a storage/backups/*.json

header('Content-Type: application/json; charset=utf-8');

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/src/bootstrap.php';

// Si se llama por web, requerir sesión autenticada.
if (PHP_SAPI !== 'cli') {
    vogue_start_session();
    vogue_require_auth();
}

$storageDir = __DIR__ . '/storage';
$backupDir  = $storageDir . '/backups';

if (!is_dir($backupDir)) {
    @mkdir($backupDir, 0700, true);
}

try {
    $pdo = db();
    $payload = [
        'exportedAt' => date('c'),
        'kv' => kvAll($pdo),
        'items' => listItems($pdo),
        'clients' => listClients($pdo)
    ];

    $date = date('Y-m-d_H-i-s');
    $backupFile = $backupDir . '/vogue-backup-' . $date . '.json';
    file_put_contents($backupFile, json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
    @chmod($backupFile, 0600);

    echo json_encode([
        'ok' => true,
        'file' => basename($backupFile),
        'counts' => [
            'kv' => count($payload['kv']),
            'items' => count($payload['items']),
            'clients' => count($payload['clients'])
        ]
    ]);
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode(['error' => $e->getMessage()]);
}
