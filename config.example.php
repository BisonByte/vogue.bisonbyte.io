<?php
// Copia este archivo a config.local.php y rellena tus credenciales de cPanel/MySQL.
// También puedes usar variables de entorno DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASS.

return [
    // Usa MySQL con los datos que te entrega cPanel. SQLite ya no está soportado.
    'db_host' => 'localhost',
    'db_port' => 3306,
    'db_name' => 'cpanel_db_name',
    'db_user' => 'cpanel_db_user',
    'db_pass' => 'cpanel_db_password',

    // Ajusta el origen permitido si usas otro dominio o subdominio.
    'cors_allowed_origin' => 'https://vogue.bisonbyte.io',
];
