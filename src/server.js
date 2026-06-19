require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { initDB } = require('./services/db');
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const viewerRoutes = require('./routes/viewer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Arquivos estáticos do viewer
app.use(express.static(path.join(__dirname, '../client/public')));

// API
app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/v', viewerRoutes); // rota pública do viewer por QR

// Health check para Railway
app.get('/health', (req, res) => res.json({ ok: true }));

// SPA fallback para o admin
// Redireciona raiz para o painel admin
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <meta http-equiv="refresh" content="0;url=/admin">
      <title>PerfecAire Viewer</title>
    </head>
    <body>
      <p>Redirecionando para <a href="/admin">painel admin</a>...</p>
    </body>
    </html>
  `);
});
