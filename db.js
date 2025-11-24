const sqlite3 = require('sqlite3').verbose();
const path = require('path');
// Place the SQLite file in a non-public `storage` directory so it is not
// directly downloadable from the webroot (safer for cPanel deployments).
const storageDir = path.join(__dirname, 'storage');
const dbPath = path.join(storageDir, 'data.db');

// Ensure storage directory exists
const fs = require('fs');
if (!fs.existsSync(storageDir)) {
  try { fs.mkdirSync(storageDir, { recursive: true }); } catch (e) { console.error('Could not create storage dir', e); }
}
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at INTEGER
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    data TEXT,
    created_at INTEGER
  )`);
});

module.exports = db;
