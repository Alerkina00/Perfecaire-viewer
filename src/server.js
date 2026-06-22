// src/server.js
'use strict';
require('dotenv').config();
require('./config');

const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb, saveDb } = require('./services/db');

const app = express();
const PORT = process.env.PORT || 3000;

// ── CORS ──────────────────────────────────────────────────────────────────────
const corsOrigin = process.env.BASE_URL ? [process.env.BASE_URL] : true;
app.use(cors({ origin: corsOrigin }));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Arquivos estáticos do cliente ─────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../client/public')));

// ── Rotas da API ──────────────────────────────────────────────────────────────
app.use('/api/auth',     require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/proxy',    require('./routes/proxy'));

// ── Viewer público e Admin ────────────────────────────────────────────────────
app.get('/v/:slug',    (req, res) => res.sendFile(path.join(__dirname, '../client/public/viewer.html')));
app.get('/admin',      (req, res) => res.sendFile(path.join(__dirname, '../client/public/admin.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, '../client/public/admin.html')));

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ── Inicializa banco e sobe o servidor ────────────────────────────────────────
async function start() {
  await getDb();
  app.listen(PORT, () => {
    console.log(`✓ Perfect Aire Viewer rodando na porta ${PORT}`);
    console.log(`  Admin: http://localhost:${PORT}/admin`);
  });
}

start().catch(console.error);

process.on('SIGINT', () => { saveDb(); process.exit(); });
