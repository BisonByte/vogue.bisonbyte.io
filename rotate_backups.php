<?php
// Simple maintenance script:
// - Deletes backup files older than 90 days from storage/backups
// - Truncates vogue.log if it grows too large

$isCli = PHP_SAPI === 'cli';
if (!$isCli) {
    require_once __DIR__ . '/src/bootstrap.php';
    vogue_start_session();
    vogue_require_auth();
}

$storageDir = __DIR__ . '/storage';
$backupDir  = $storageDir . '/backups';
$logFile    = $storageDir . '/vogue.log';

$now = time();
$maxAgeDays = 90;
$maxAgeSeconds = $maxAgeDays * 24 * 60 * 60;

if (is_dir($backupDir)) {
    $files = scandir($backupDir);
    foreach ($files as $file) {
        if ($file === '.' || $file === '..') continue;
        $path = $backupDir . '/' . $file;
        if (!is_file($path)) continue;
        $mtime = @filemtime($path);
        if ($mtime !== false && ($now - $mtime) > $maxAgeSeconds) {
            @unlink($path);
        }
    }
}

// If log grows beyond ~5 MB, keep only the last 2000 lines
if (is_file($logFile) && filesize($logFile) > 5 * 1024 * 1024) {
    $lines = @file($logFile, FILE_IGNORE_NEW_LINES);
    if ($lines !== false && count($lines) > 2000) {
        $lines = array_slice($lines, -2000);
        @file_put_contents($logFile, implode(PHP_EOL, $lines) . PHP_EOL);
    }
}

echo "OK\n";
