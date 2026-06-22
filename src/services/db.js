const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = path.resolve(__dirname, '../../database.db');

let db = null;
let SQL = null;

async function getDb() {
  if (db) return db;

  SQL = await initSqlJs({
    locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm')
  });

  let dbData = null;
  if (fs.existsSync(DB_PATH)) {
    dbData = fs.readFileSync(DB_PATH);
  }

  db = new SQL.Database(dbData);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      file_name TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      file_type TEXT NOT NULL,
      file_key TEXT NOT NULL,
      qr_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS conversion_jobs (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'processing',
      slug TEXT,
      viewer_url TEXT,
      qr_url TEXT,
      error TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const bcrypt = require('bcryptjs');
  const adminExists = db.exec('SELECT * FROM users WHERE username = "admin"');
  if (adminExists.length === 0 || adminExists[0].values.length === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    db.run('INSERT INTO users (username, password) VALUES (?, ?)', ['admin', hash]);
    console.log('✓ Usuário admin criado (senha: admin123)');
  }

  saveDb();
  return db;
}

function saveDb() {
  if (db) {
    const data = db.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }
}

function getSQL() {
  return SQL;
}

module.exports = { getDb, saveDb, getSQL };
