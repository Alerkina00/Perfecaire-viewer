require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { initDB } = require('./services/db');
const authRoutes = require('./routes/auth');
const projectRoutes = require('./routes/projects');
const viewerRoutes = require('./routes/viewer');
const proxyRoutes = require('./routes/proxy'); // ← novo

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Arquivos estáticos do viewer
app.use(express.static(path.join(__dirname, '../client/public')));

// Wasm do web-ifc — servido direto do node_modules
app.get('/web-ifc.wasm', (req, res) => {
  res.sendFile(
    path.join(__dirname, '../node_modules/web-ifc/web-ifc.wasm')
  );
});

initDB();

app.listen(PORT, () => {
  console.log(`PerfecAire Viewer rodando na porta ${PORT}`);
});
