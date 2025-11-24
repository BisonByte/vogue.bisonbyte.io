const express = require('express');
const path = require('path');
const bodyParser = require('body-parser');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json({ limit: '5mb' }));
app.use(bodyParser.urlencoded({ extended: true }));

// Serve static files from the project root (so visiting http://localhost:3000 serves index.html)
app.use(express.static(path.join(__dirname)));

function runAsync(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err){
      if(err) reject(err); else resolve(this);
    });
  });
}
function getAsync(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => { if(err) reject(err); else resolve(row); });
  });
}
function allAsync(sql, params=[]) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => { if(err) reject(err); else resolve(rows); });
  });
}

// Key/value save
app.post('/api/save', async (req, res) => {
  try{
    const { key, value } = req.body;
    if(typeof key !== 'string') return res.status(400).json({ error: 'key required' });
    const now = Date.now();
    const v = JSON.stringify(value === undefined ? null : value);
    await runAsync(`INSERT INTO kv(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`, [key, v, now]);
    res.json({ ok:true });
  }catch(e){ console.error(e); res.status(500).json({ error: ''+e }); }
});

app.get('/api/load', async (req, res) => {
  try{
    const key = req.query.key;
    if(!key) return res.status(400).json({ error: 'key required' });
    const row = await getAsync('SELECT value FROM kv WHERE key=?', [key]);
    if(!row) return res.json({ value: null });
    let parsed = null;
    try{ parsed = JSON.parse(row.value); }catch(e){ parsed = row.value; }
    res.json({ value: parsed });
  }catch(e){ console.error(e); res.status(500).json({ error: ''+e }); }
});

// Items table - add individual objects
app.post('/api/item', async (req, res) => {
  try{
    const data = req.body.data === undefined ? req.body : req.body.data;
    const now = Date.now();
    const v = JSON.stringify(data);
    const result = await runAsync('INSERT INTO items(data,created_at) VALUES(?,?)', [v, now]);
    res.json({ ok:true, id: result.lastID });
  }catch(e){ console.error(e); res.status(500).json({ error: ''+e }); }
});

app.get('/api/items', async (req, res) => {
  try{
    const rows = await allAsync('SELECT id, data, created_at FROM items ORDER BY id ASC');
    const out = rows.map(r => { try{ return { id: r.id, data: JSON.parse(r.data), created_at: r.created_at }; }catch(e){ return { id: r.id, data: r.data, created_at: r.created_at }; } });
    res.json({ items: out });
  }catch(e){ console.error(e); res.status(500).json({ error: ''+e }); }
});

// Export all data
app.get('/api/export', async (req, res) => {
  try{
    const kv = await allAsync('SELECT key, value, updated_at FROM kv');
    const items = await allAsync('SELECT id, data, created_at FROM items');
    const kvo = {};
    kv.forEach(r => { try{ kvo[r.key] = JSON.parse(r.value); }catch(e){ kvo[r.key] = r.value; } });
    const itemso = items.map(r => ({ id: r.id, data: JSON.parse(r.data), created_at: r.created_at }));
    const out = { exportedAt: Date.now(), kv: kvo, items: itemso };
    res.json(out);
  }catch(e){ console.error(e); res.status(500).json({ error: ''+e }); }
});

// Import (merge) - accepts { kv: {key: value}, items: [{data:...}, ...] }
app.post('/api/import', async (req, res) => {
  try{
    const payload = req.body || {};
    const now = Date.now();
    if(payload.kv){
      const keys = Object.keys(payload.kv);
      for(const k of keys){
        const v = JSON.stringify(payload.kv[k]);
        await runAsync(`INSERT INTO kv(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`, [k, v, now]);
      }
    }
    if(Array.isArray(payload.items)){
      for(const it of payload.items){
        const data = it.data !== undefined ? it.data : it;
        await runAsync('INSERT INTO items(data,created_at) VALUES(?,?)', [JSON.stringify(data), now]);
      }
    }
    res.json({ ok:true });
  }catch(e){ console.error(e); res.status(500).json({ error: ''+e }); }
});

// Delete a key from kv
app.delete('/api/delete', async (req, res) => {
  try{
    const key = req.query.key || (req.body && req.body.key);
    if(!key) return res.status(400).json({ error: 'key required' });
    await runAsync('DELETE FROM kv WHERE key=?', [key]);
    res.json({ ok:true });
  }catch(e){ console.error(e); res.status(500).json({ error: ''+e }); }
});

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`);
});
