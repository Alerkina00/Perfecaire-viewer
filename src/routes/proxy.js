// src/routes/proxy.js
'use strict';
const express = require('express');
const { getDb } = require('../services/db');
const { getFileStream } = require('../services/storage');

const router = express.Router();

const mimeByType = {
  ifc:  'application/octet-stream',
  gltf: 'model/gltf+json',
  glb:  'model/gltf-binary',
  obj:  'text/plain',
  fbx:  'application/octet-stream',
};
const mimeByExt = {
  bin: 'application/octet-stream', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', webp: 'image/webp', ktx2: 'image/ktx2', gltf: 'model/gltf+json',
  glb: 'model/gltf-binary',
};

// ── /api/proxy/:slug  →  arquivo principal do projeto ────────────────────────
router.get('/:slug', async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec('SELECT file_key, file_type FROM projects WHERE slug = ?', [req.params.slug]);
    if (!result.length || !result[0].values.length) {
      return res.status(404).json({ error: 'Projeto não encontrado' });
    }
    const [fileKey, fileType] = result[0].values[0];
    res.setHeader('Content-Type', mimeByType[fileType] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    const stream = await getFileStream(fileKey);
    stream.on('error', (e) => { if (!res.headersSent) res.status(404).json({ error: e.message }); });
    stream.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// ── /api/proxy/:slug/:filename  →  arquivos secundários (BIN, texturas) ──────
// Para GLTF com .bin externo que não foi convertido em GLB único.
router.get('/:slug/:filename', async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec('SELECT slug FROM projects WHERE slug = ?', [req.params.slug]);
    if (!result.length || !result[0].values.length) {
      return res.status(404).json({ error: 'Projeto não encontrado' });
    }
    const slug = req.params.slug;
    const path = require('path');
    const filename = path.basename(req.params.filename); // evita path traversal
    const ext = filename.split('.').pop().toLowerCase();

    res.setHeader('Content-Type', mimeByExt[ext] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');

    // Convenção de nomes salva pelo projects.js: <slug>_<filename>
    let stream;
    try { stream = await getFileStream(`${slug}_${filename}`); }
    catch (_) { stream = await getFileStream(filename); } // fallback: nome exato

    stream.on('error', (e) => { if (!res.headersSent) res.status(404).json({ error: e.message }); });
    stream.pipe(res);
  } catch (err) {
    if (!res.headersSent) res.status(404).json({ error: `Arquivo secundário não encontrado` });
  }
});

module.exports = router;
