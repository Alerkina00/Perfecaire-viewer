require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { getDb, saveDb } = require('./services/db');

const app = express();
const PORT = process.env.PORT || 3000;

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Arquivos estáticos do cliente
app.use(express.static(path.join(__dirname, '../client/public')));

// Rotas
app.use('/api/auth', require('./routes/auth'));
app.use('/api/projects', require('./routes/projects'));
app.use('/api/proxy', require('./routes/proxy'));

// Rota para viewer
app.get('/v/:slug', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/viewer.html'));
});

// Rota admin
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/admin.html'));
});
app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/public/admin.html'));
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// Inicializa o banco e sobe o servidor
async function start() {
  await getDb();
  app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
  });
}

start().catch(console.error);

process.on('SIGINT', () => {
  saveDb();
  process.exit();
});
