// src/routes/proxy.js
const express = require('express');
const fs = require('fs');
const path = require('path');
const { getDb } = require('../services/db');

const router = express.Router();

const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

const mimeTypes = {
  ifc:  'application/octet-stream',
  gltf: 'model/gltf+json',
  glb:  'model/gltf-binary',
  obj:  'text/plain',
  fbx:  'application/octet-stream',
};

// ── Rota principal: /api/proxy/:slug ─────────────────────────────────────────
router.get('/:slug', async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec(
      'SELECT file_key, file_type FROM projects WHERE slug = ?',
      [req.params.slug]
    );

    if (!result.length || !result[0].values.length) {
      return res.status(404).json({ error: 'Projeto não encontrado' });
    }

    const [fileKey, fileType] = result[0].values[0];
    const filePath = path.join(UPLOAD_DIR, fileKey);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Arquivo não encontrado no disco' });
    }

    serveFile(res, filePath, mimeTypes[fileType] || 'application/octet-stream', req);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Rota para arquivos secundários (BIN, texturas): /api/proxy/:slug/:filename
// O GLTFLoader pede automaticamente esses arquivos quando o GLTF tem referências externas.
router.get('/:slug/:filename', async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec(
      'SELECT slug FROM projects WHERE slug = ?',
      [req.params.slug]
    );

    if (!result.length || !result[0].values.length) {
      return res.status(404).json({ error: 'Projeto não encontrado' });
    }

    // Monta o caminho esperado: uploads/<slug>_<filename> ou uploads/<filename>
    // Tenta as duas convenções
    const slug = req.params.slug;
    const filename = path.basename(req.params.filename); // segurança: sem path traversal
    const candidates = [
      path.join(UPLOAD_DIR, `${slug}_${filename}`),
      path.join(UPLOAD_DIR, filename),
    ];

    const filePath = candidates.find(p => fs.existsSync(p));
    if (!filePath) {
      return res.status(404).json({ error: `Arquivo secundário não encontrado: ${filename}` });
    }

    const ext = filename.split('.').pop().toLowerCase();
    const mime = {
      bin:  'application/octet-stream',
      png:  'image/png',
      jpg:  'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      ktx2: 'image/ktx2',
    }[ext] || 'application/octet-stream';

    serveFile(res, filePath, mime, req);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helper: serve arquivo com cache HTTP correto ──────────────────────────────
function serveFile(res, filePath, contentType, req) {
  const stat = fs.statSync(filePath);

  // ETag baseado em tamanho + data de modificação (leve, sem hash)
  const etag = `"${stat.size}-${stat.mtimeMs}"`;

  // Cache de 7 dias para arquivos de modelo (imutáveis após upload)
  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.setHeader('ETag', etag);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', 'bytes');

  // Se o browser já tem a versão certa → 304 Not Modified (sem transferência)
  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }

  // Suporte a Range requests (útil para modelos grandes — browser pode retomar)
  const range = req.headers['range'];
  if (range) {
    const [startStr, endStr] = range.replace('bytes=', '').split('-');
    const start = parseInt(startStr, 10);
    const end   = endStr ? parseInt(endStr, 10) : stat.size - 1;
    const chunkSize = end - start + 1;

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', chunkSize);

    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  fs.createReadStream(filePath).pipe(res);
}

module.exports = router;
