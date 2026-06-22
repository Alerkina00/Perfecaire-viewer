const express = require('express');
const { getFileStream } = require('../services/storage');
const { getDb } = require('../services/db');

const router = express.Router();

const mimeTypes = {
  'ifc': 'application/octet-stream',
  'gltf': 'model/gltf+json',
  'glb': 'model/gltf-binary',
  'obj': 'text/plain',
  'fbx': 'application/octet-stream',
  'bin': 'application/octet-stream',
  'png': 'image/png',
  'jpg': 'image/jpeg',
  'jpeg': 'image/jpeg',
  'webp': 'image/webp',
  'gif': 'image/gif',
  'bmp': 'image/bmp',
};

// ── Rota principal: /api/proxy/:slug e /api/proxy/:slug/ ─────────────────────
// Serve o arquivo principal do projeto
async function serveMainFile(req, res) {
  try {
    const db = await getDb();
    const result = db.exec('SELECT * FROM projects WHERE slug = ?', [req.params.slug]);

    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: 'Projeto não encontrado' });
    }

    const row = result[0].values[0];
    const fileKey = row[7]; // file_key
    const fileType = row[6]; // file_type

    res.setHeader('Content-Type', mimeTypes[fileType] || 'application/octet-stream');

    const stream = await getFileStream(fileKey);
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// Registra com e sem barra final
router.get('/:slug', serveMainFile);
router.get('/:slug/', serveMainFile);

// ── Rota auxiliar: /api/proxy/:slug/:filename ─────────────────────────────────
// Serve arquivos auxiliares (.bin, texturas) associados ao projeto.
// O GLTFLoader faz fetch de paths relativos à URL do arquivo principal,
// então quando o principal é /api/proxy/SLUG, o .bin vai para /api/proxy/SLUG/3dExport.bin
router.get('/:slug/:filename', async (req, res) => {
  try {
    const { slug, filename } = req.params;

    // Valida o slug no banco para não servir arquivos arbitrários
    const db = await getDb();
    const result = db.exec('SELECT id FROM projects WHERE slug = ?', [slug]);
    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: 'Projeto não encontrado' });
    }

    // Bloqueia traversal de diretório
    if (filename.includes('..') || filename.includes('/')) {
      return res.status(400).json({ error: 'Nome de arquivo inválido' });
    }

    // A fileKey dos auxiliares é salva como "SLUG_FILENAME" (ver projects.js)
    const fileKey = `${slug}_${filename}`;
    const ext = filename.split('.').pop().toLowerCase();

    res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');

    const stream = await getFileStream(fileKey);
    stream.pipe(res);
  } catch (err) {
    if (err.message === 'Arquivo não encontrado') {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
