Backend + client integration for persisting app data

This project now includes a simple Node.js + Express backend using SQLite to persist data.

Quick start:

1. Install dependencies

```bash
cd /home/ddiarsmuvk/vogue.bisonbyte.io
npm install
```

2. Start the server

```bash
npm start
```

The server serves the static site (so visiting http://localhost:3000 will load `index.html`) and exposes API endpoints under `/api`:

- POST `/api/save` { key, value } -> stores a key/value
- GET `/api/load?key=...` -> returns { value }
- POST `/api/item` { data } -> insert item
- GET `/api/items` -> list items
- GET `/api/export` -> export all data as JSON
- POST `/api/import` -> import JSON payload { kv, items }

Client usage from the browser (example):

```js
// save arbitrary state
fetch('/api/save', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ key:'app-state', value: myState }) });

// load
fetch('/api/load?key=app-state').then(r=>r.json()).then(console.log);

// add item
fetch('/api/item', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ data: itemObj }) }).then(r=>r.json()).then(console.log);
```

If you want, I can also add a small client helper in `index.html` that exposes `window.appDB` with convenience methods to call these endpoints; tell me if you want that and I will add it.

--

Deploying on cPanel (Node.js support available)
1. Upload the project to your cPanel account (e.g. into `~/vogue.bisonbyte.io`).
2. Make sure the `storage/` directory exists and is writable by your account. The app already creates it if missing.
3. In cPanel use **Application Manager / Setup Node.js App**:
	- App root: the project folder (where `server.js` is).
	- Application startup file: `server.js`.
	- Set Node.js version (v16+ or v18+ recommended).
	- If the panel does not run `npm install` automatically, connect via SSH and run:

```bash
cd ~/vogue.bisonbyte.io
npm install --production
```

4. If you prefer SSH-only setup (no App Manager):
	- Start the app with `npm start` (only if your hosting allows long-running processes).
	- Otherwise use the Application Manager which integrates with Apache/Passenger and does not require binding arbitrary ports.

5. File permissions: ensure the storage folder and `storage/data.db` are writable by your cPanel user:

```bash
cd ~/vogue.bisonbyte.io
mkdir -p storage
chmod 700 storage
# data.db will be created automatically on first run; if present, ensure writable:
chmod 660 storage/data.db || true
```

6. Backups and security:
	- Keep `storage/data.db` outside of any publicly served folder (the repo places it in `storage/` by default).
	- Configure cPanel backups or download `storage/data.db` regularly.

If you want, puedo also adjust `db.js` to place `data.db` in another absolute path (for example a path outside your home dir) — tell me the path and I will update it.
