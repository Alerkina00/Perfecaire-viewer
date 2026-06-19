require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { initDB } = require('./services/db');
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const viewerRoutes = require('./routes/viewer');
const proxyRoutes = require('./routes/proxy');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ← WASM antes do static, senão o 404 do static vence
app.get('/web-ifc.wasm', (req, res) => {
  res.sendFile(
    path.join(__dirname, '../node_modules/web-ifc/web-ifc.wasm')
  );
});

// Arquivos estáticos do viewer
app.use(express.static(path.join(__dirname, '../client/public')));

// API
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/proxy', proxyRoutes);

// Viewer público por QR
app.use('/v', viewerRoutes);

// Health check para Railway
app.get('/health', (req, res) => res.json({ ok: true }));

// SPA fallback para o admin
app.get('/admin*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/admin.html'));
});

initDB();

app.listen(PORT, () => {
  console.log(`PerfecAire Viewer rodando na porta ${PORT}`);
});
