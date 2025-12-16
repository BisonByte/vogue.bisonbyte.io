-- Esquema MySQL para vogue.bisonbyte.io
-- Úsalo en cPanel (phpMyAdmin o terminal) para crear las tablas y cargar datos demo.

CREATE TABLE IF NOT EXISTS kv_store (
    key_name VARCHAR(191) NOT NULL PRIMARY KEY,
    value_json LONGTEXT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS items (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    payload_json LONGTEXT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clients (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    nombre VARCHAR(255) NOT NULL,
    producto_enlace TEXT NULL,
    monto_pagado DECIMAL(12,2) NOT NULL DEFAULT 0,
    direccion_envio TEXT NULL,
    notas TEXT NULL,
    created_at_ms BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Datos demo/tester (se insertan solo si la tabla está vacía)
INSERT INTO kv_store (key_name, value_json) VALUES
('demo_mensaje', JSON_OBJECT('es', 'Datos guardados en MySQL (cPanel).', 'en', 'Server data now lives in MySQL.'))
ON DUPLICATE KEY UPDATE value_json = VALUES(value_json);

INSERT INTO items (payload_json, created_at_ms) VALUES
(JSON_OBJECT('tipo','venta_demo','monto',99.99,'cliente','Cliente demo','descripcion','Pedido inicial para verificar la conexión entre dispositivos.'), UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000);

INSERT INTO clients (nombre, producto_enlace, monto_pagado, direccion_envio, notas, created_at_ms) VALUES
('Cliente demo','https://ejemplo.com/producto-demo',149.99,'Av. Siempre Viva 123, Ciudad Demo','Registro inicial de prueba para la vista de administrador.', UNIX_TIMESTAMP(CURRENT_TIMESTAMP(3))*1000);
