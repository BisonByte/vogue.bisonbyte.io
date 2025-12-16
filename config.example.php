<?php
// Copia este archivo a config.local.php y rellena tus credenciales de cPanel/MySQL.
// También puedes usar variables de entorno DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS.

return [
    // Usa MySQL cuando tengas credenciales de cPanel.
    'db_driver' => 'mysql',
    'db_host' => 'localhost',
    'db_port' => 3306,
    'db_name' => 'cpanel_db_name',
    'db_user' => 'cpanel_db_user',
    'db_pass' => 'cpanel_db_password',

    // Si prefieres un modo rápido sin MySQL, cambia db_driver a "sqlite"
    // o deja las credenciales vacías para que el código use storage/vogue.sqlite automáticamente.
    'sqlite_path' => __DIR__ . '/storage/vogue.sqlite',

    // Ajusta el origen permitido si usas otro dominio o subdominio.
    'cors_allowed_origin' => 'https://vogue.bisonbyte.io',
];
