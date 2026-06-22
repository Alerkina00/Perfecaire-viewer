// src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb, saveDb } = require('./services/db');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Middlewares ───────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Arquivos estáticos do cliente ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../client/public')));

// ── Serve a pasta de uploads diretamente com cache longo ─────────────────────
// Isso permite que o GLTFLoader busque arquivos .bin e texturas sem passar pelo proxy.
// O proxy ainda existe para slugs (URL amigável), mas downloads diretos são mais rápidos.
app.use('/uploads', express.static(path.join(__dirname, '../uploads'), {
  maxAge: '7d',          // cache de 7 dias no browser
  immutable: true,       // diz ao browser que o arquivo não muda
  etag: true,
  lastModified: true,
}));

// ── Rotas da API ──────────────────────────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/proxy',    require('./routes/proxy'));

// ── Viewer público ────────────────────────────────────────────────────────────
app.get('/v/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/viewer.html'));
});

// ── Admin ─────────────────────────────────────────────────────────────────────
app.get('/admin',      (req, res) => res.sendFile(path.join(__dirname, '../client/public/admin.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, '../client/public/admin.html')));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ── Inicializa banco e sobe o servidor ────────────────────────────────────────
async function start() {
  await getDb();
  app.listen(PORT, () => {
    console.log(`✓ Servidor rodando na porta ${PORT}`);
    console.log(`  Admin: http://localhost:${PORT}/admin`);
  });
}

start().catch(console.error);

process.on('SIGINT', () => {
  saveDb();
  process.exit();
});
