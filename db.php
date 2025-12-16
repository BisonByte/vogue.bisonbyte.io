<?php

function loadConfig(): array {
    static $config = null;
    if ($config === null) {
        $config = require __DIR__ . '/config.php';
    }
    return $config;
}

function db(): PDO {
    static $pdo = null;
    static $bootstrapped = false;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $config = loadConfig();
    foreach (['db_host', 'db_name', 'db_user'] as $key) {
        if (empty($config[$key])) {
            throw new Exception("Falta configuración de base de datos ($key). Ajusta config.local.php o variables de entorno.");
        }
    }

    $dsn = sprintf(
        'mysql:host=%s;dbname=%s;port=%s;charset=utf8mb4',
        $config['db_host'],
        $config['db_name'],
        $config['db_port'] ?? 3306
    );

    $pdo = new PDO($dsn, $config['db_user'], $config['db_pass'], [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES => false
    ]);

    if (!$bootstrapped) {
        ensureTables($pdo);
        migrateLegacyData($pdo);
        seedDemoData($pdo);
        $bootstrapped = true;
    }

    return $pdo;
}

function ensureTables(PDO $pdo): void {
    $queries = [
        "CREATE TABLE IF NOT EXISTS kv_store (
            key_name VARCHAR(191) NOT NULL PRIMARY KEY,
            value_json LONGTEXT NULL,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS items (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            payload_json LONGTEXT NULL,
            created_at_ms BIGINT UNSIGNED NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "CREATE TABLE IF NOT EXISTS clients (
            id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
            nombre VARCHAR(255) NOT NULL,
            producto_enlace TEXT NULL,
            monto_pagado DECIMAL(12,2) NOT NULL DEFAULT 0,
            direccion_envio TEXT NULL,
            notas TEXT NULL,
            created_at_ms BIGINT UNSIGNED NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    ];

    foreach ($queries as $sql) {
        $pdo->exec($sql);
    }
}

function encodeValue($value): string {
    return json_encode($value, JSON_UNESCAPED_UNICODE);
}

function decodeValue($value) {
    $decoded = json_decode($value, true);
    if (json_last_error() === JSON_ERROR_NONE) {
        return $decoded;
    }
    return $value;
}

function kvSet(string $key, $value, ?PDO $pdo = null): void {
    $pdo = $pdo ?: db();
    $stmt = $pdo->prepare(
        "INSERT INTO kv_store (key_name, value_json, updated_at)
         VALUES (:key_name, :value_json, NOW())
         ON DUPLICATE KEY UPDATE value_json = VALUES(value_json), updated_at = VALUES(updated_at)"
    );
    $stmt->execute([
        ':key_name' => $key,
        ':value_json' => encodeValue($value)
    ]);
}

function kvGet(string $key, ?PDO $pdo = null) {
    $pdo = $pdo ?: db();
    $stmt = $pdo->prepare("SELECT value_json FROM kv_store WHERE key_name = :key_name LIMIT 1");
    $stmt->execute([':key_name' => $key]);
    $row = $stmt->fetch();
    if (!$row) {
        return null;
    }
    return decodeValue($row['value_json']);
}

function kvDelete(string $key, ?PDO $pdo = null): void {
    $pdo = $pdo ?: db();
    $stmt = $pdo->prepare("DELETE FROM kv_store WHERE key_name = :key_name");
    $stmt->execute([':key_name' => $key]);
}

function kvAll(?PDO $pdo = null): array {
    $pdo = $pdo ?: db();
    $stmt = $pdo->query("SELECT key_name, value_json FROM kv_store");
    $data = [];
    foreach ($stmt as $row) {
        $data[$row['key_name']] = decodeValue($row['value_json']);
    }
    return $data;
}

function addItem($data, ?int $createdMs = null, ?PDO $pdo = null): int {
    $pdo = $pdo ?: db();
    $createdMs = $createdMs ?: (int) round(microtime(true) * 1000);
    $stmt = $pdo->prepare("INSERT INTO items (payload_json, created_at_ms) VALUES (:payload_json, :created_at_ms)");
    $stmt->execute([
        ':payload_json' => encodeValue($data),
        ':created_at_ms' => $createdMs
    ]);
    return (int) $pdo->lastInsertId();
}

function listItems(?PDO $pdo = null): array {
    $pdo = $pdo ?: db();
    $stmt = $pdo->query("SELECT id, payload_json, created_at_ms FROM items ORDER BY id ASC");
    $items = [];
    foreach ($stmt as $row) {
        $items[] = [
            'id' => (int) $row['id'],
            'data' => decodeValue($row['payload_json']),
            'created_at' => (int) $row['created_at_ms']
        ];
    }
    return $items;
}

function migrateLegacyData(PDO $pdo): void {
    $dataFile = __DIR__ . '/storage/data.json';
    if (!file_exists($dataFile)) {
        return;
    }

    $hasKv = (int) $pdo->query("SELECT COUNT(*) FROM kv_store")->fetchColumn();
    $hasItems = (int) $pdo->query("SELECT COUNT(*) FROM items")->fetchColumn();
    if ($hasKv > 0 || $hasItems > 0) {
        return;
    }

    $raw = @file_get_contents($dataFile);
    $parsed = json_decode($raw, true);
    if (!is_array($parsed)) {
        return;
    }

    $now = (int) round(microtime(true) * 1000);
    if (isset($parsed['kv']) && is_array($parsed['kv'])) {
        foreach ($parsed['kv'] as $k => $v) {
            kvSet($k, $v, $pdo);
        }
    }
    if (isset($parsed['items']) && is_array($parsed['items'])) {
        foreach ($parsed['items'] as $item) {
            $data = is_array($item) && array_key_exists('data', $item) ? $item['data'] : $item;
            $createdAt = is_array($item) && array_key_exists('created_at', $item) ? (int) $item['created_at'] : $now;
            addItem($data, $createdAt, $pdo);
        }
    }
}

function seedDemoData(PDO $pdo): void {
    $kvCount = (int) $pdo->query("SELECT COUNT(*) FROM kv_store")->fetchColumn();
    $itemsCount = (int) $pdo->query("SELECT COUNT(*) FROM items")->fetchColumn();
    $clientsCount = (int) $pdo->query("SELECT COUNT(*) FROM clients")->fetchColumn();

    if ($kvCount === 0) {
        kvSet('demo_mensaje', [
            'es' => 'Datos guardados en MySQL (cPanel).',
            'en' => 'Server data now lives in MySQL.'
        ], $pdo);
    }

    if ($itemsCount === 0) {
        addItem([
            'tipo' => 'venta_demo',
            'monto' => 99.99,
            'cliente' => 'Cliente demo',
            'descripcion' => 'Pedido inicial para verificar la conexión entre dispositivos.'
        ], null, $pdo);
    }

    if ($clientsCount === 0) {
        $createdMs = (int) round(microtime(true) * 1000);
        $stmt = $pdo->prepare("INSERT INTO clients (nombre, producto_enlace, monto_pagado, direccion_envio, notas, created_at_ms) VALUES (:nombre, :producto_enlace, :monto_pagado, :direccion_envio, :notas, :created_at_ms)");
        $stmt->execute([
            ':nombre' => 'Cliente demo',
            ':producto_enlace' => 'https://ejemplo.com/producto-demo',
            ':monto_pagado' => 149.99,
            ':direccion_envio' => 'Av. Siempre Viva 123, Ciudad Demo',
            ':notas' => 'Registro inicial de prueba para la vista de administrador.',
            ':created_at_ms' => $createdMs
        ]);
    }
}

function validateClientPayload(array $payload, bool $partial = false): array {
    $fields = [
        'nombre' => isset($payload['nombre']) ? trim($payload['nombre']) : null,
        'producto_enlace' => isset($payload['productoEnlace']) ? trim($payload['productoEnlace']) : (isset($payload['producto_enlace']) ? trim($payload['producto_enlace']) : null),
        'monto_pagado' => isset($payload['monto']) ? $payload['monto'] : (isset($payload['monto_pagado']) ? $payload['monto_pagado'] : null),
        'direccion_envio' => isset($payload['direccionEnvio']) ? trim($payload['direccionEnvio']) : (isset($payload['direccion_envio']) ? trim($payload['direccion_envio']) : null),
        'notas' => isset($payload['notas']) ? trim($payload['notas']) : null,
    ];

    if (!$partial && ($fields['nombre'] === null || $fields['nombre'] === '')) {
        throw new Exception('El nombre del cliente es obligatorio');
    }

    if ($fields['monto_pagado'] !== null) {
        if (!is_numeric($fields['monto_pagado'])) {
            throw new Exception('El monto debe ser numérico');
        }
        $fields['monto_pagado'] = (float) $fields['monto_pagado'];
    }

    return array_filter($fields, function ($v) use ($partial) {
        if ($partial) {
            return $v !== null;
        }
        return true;
    });
}

function createClient(array $payload, ?PDO $pdo = null): int {
    $pdo = $pdo ?: db();
    $data = validateClientPayload($payload, false);
    $createdMs = (int) round(microtime(true) * 1000);

    $stmt = $pdo->prepare("INSERT INTO clients (nombre, producto_enlace, monto_pagado, direccion_envio, notas, created_at_ms) VALUES (:nombre, :producto_enlace, :monto_pagado, :direccion_envio, :notas, :created_at_ms)");
    $stmt->execute([
        ':nombre' => $data['nombre'],
        ':producto_enlace' => $data['producto_enlace'] ?? null,
        ':monto_pagado' => $data['monto_pagado'] ?? 0,
        ':direccion_envio' => $data['direccion_envio'] ?? null,
        ':notas' => $data['notas'] ?? null,
        ':created_at_ms' => $createdMs
    ]);

    return (int) $pdo->lastInsertId();
}

function updateClient(int $id, array $payload, ?PDO $pdo = null): bool {
    $pdo = $pdo ?: db();
    $data = validateClientPayload($payload, true);
    if (empty($data)) {
        throw new Exception('No hay campos para actualizar');
    }

    $sets = [];
    $params = [':id' => $id];
    foreach ($data as $field => $value) {
        $sets[] = "$field = :$field";
        $params[':' . $field] = $value;
    }
    $sets[] = 'updated_at = NOW()';
    $sql = "UPDATE clients SET " . implode(', ', $sets) . " WHERE id = :id";
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    return $stmt->rowCount() > 0;
}

function deleteClient(int $id, ?PDO $pdo = null): bool {
    $pdo = $pdo ?: db();
    $stmt = $pdo->prepare("DELETE FROM clients WHERE id = :id");
    $stmt->execute([':id' => $id]);
    return $stmt->rowCount() > 0;
}

function listClients(?PDO $pdo = null): array {
    $pdo = $pdo ?: db();
    $stmt = $pdo->query("SELECT id, nombre, producto_enlace, monto_pagado, direccion_envio, notas, created_at_ms, created_at, updated_at FROM clients ORDER BY created_at DESC");
    $rows = $stmt->fetchAll();
    return array_map(function ($row) {
        return [
            'id' => (int) $row['id'],
            'nombre' => $row['nombre'],
            'producto_enlace' => $row['producto_enlace'],
            'monto_pagado' => (float) $row['monto_pagado'],
            'direccion_envio' => $row['direccion_envio'],
            'notas' => $row['notas'],
            'created_at' => (int) $row['created_at_ms'],
            'updated_at' => $row['updated_at'],
        ];
    }, $rows);
}
