// src/routes/proxy.js
const express = require('express');
const fs      = require('fs');
const path    = require('path');
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

// ── /api/proxy/:slug  →  arquivo principal do projeto ────────────────────────
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
      console.error(`[proxy] Arquivo principal não encontrado: ${filePath}`);
      return res.status(404).json({ error: 'Arquivo não encontrado no disco' });
    }

    console.log(`[proxy] Servindo: ${fileKey} (${fileType})`);
    serveFile(res, filePath, mimeTypes[fileType] || 'application/octet-stream', req);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── /api/proxy/:slug/:filename  →  arquivos secundários (BIN, texturas) ──────
// O GLTFLoader chama esta rota automaticamente quando o GLTF tem refs externas.
// Convenção de nomes no disco: <slug>_<filename> (salvo em projects.js)
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

    const slug     = req.params.slug;
    // path.basename evita path traversal
    const filename = path.basename(req.params.filename);

    // Candidatos em ordem de prioridade:
    // 1. slug_filename   (convenção padrão salva pelo projects.js)
    // 2. filename        (arquivo subido com nome exato)
    const candidates = [
      path.join(UPLOAD_DIR, `${slug}_${filename}`),
      path.join(UPLOAD_DIR, filename),
    ];

    // Tenta também listar o diretório para match case-insensitive
    // (útil quando texturas têm nomes misturados Upper/lower)
    let filePath = candidates.find(p => fs.existsSync(p));

    if (!filePath) {
      // Busca case-insensitive
      try {
        const files = fs.readdirSync(UPLOAD_DIR);
        const lowerFilename = filename.toLowerCase();
        const found = files.find(f =>
          f.toLowerCase() === `${slug}_${lowerFilename}` ||
          f.toLowerCase() === lowerFilename
        );
        if (found) filePath = path.join(UPLOAD_DIR, found);
      } catch (_) { /* ignora erro de leitura de dir */ }
    }

    if (!filePath) {
      console.error(`[proxy] Arquivo secundário não encontrado: slug=${slug} file=${filename}`);
      console.error(`[proxy] Candidatos testados: ${candidates.join(', ')}`);
      return res.status(404).json({ error: `Arquivo secundário não encontrado: ${filename}` });
    }

    const ext  = filename.split('.').pop().toLowerCase();
    const mime = {
      bin:  'application/octet-stream',
      png:  'image/png',
      jpg:  'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      ktx2: 'image/ktx2',
      gltf: 'model/gltf+json',
    }[ext] || 'application/octet-stream';

    console.log(`[proxy] Arquivo secundário: ${path.basename(filePath)} (${mime})`);
    serveFile(res, filePath, mime, req);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Helper: serve arquivo com cache e suporte a Range requests ───────────────
function serveFile(res, filePath, contentType, req) {
  const stat = fs.statSync(filePath);
  const etag = `"${stat.size}-${stat.mtimeMs}"`;

  res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  res.setHeader('ETag', etag);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Accept-Ranges', 'bytes');

  if (req.headers['if-none-match'] === etag) {
    return res.status(304).end();
  }

  const range = req.headers['range'];
  if (range) {
    const [startStr, endStr] = range.replace('bytes=', '').split('-');
    const start     = parseInt(startStr, 10);
    const end       = endStr ? parseInt(endStr, 10) : stat.size - 1;
    const chunkSize = end - start + 1;

    res.status(206);
    res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
    res.setHeader('Content-Length', chunkSize);
    fs.createReadStream(filePath, { start, end }).pipe(res);
    return;
  }

  res.setHeader('Content-Length', stat.size);
  fs.createReadStream(filePath).pipe(res);
}

module.exports = router;
