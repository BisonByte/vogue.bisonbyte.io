<?php

use Illuminate\Http\Request;

define('LARAVEL_START', microtime(true));

$base = dirname(__DIR__) . '/backend';

// Determine if the application is in maintenance mode...
if (file_exists($maintenance = $base . '/storage/framework/maintenance.php')) {
    require $maintenance;
}

// Register the Composer autoloader...
require $base . '/vendor/autoload.php';

// Bootstrap Laravel and handle the request...
(require_once $base . '/bootstrap/app.php')
    ->handleRequest(Request::capture());

