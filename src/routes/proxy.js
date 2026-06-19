// src/routes/proxy.js
// Faz download do arquivo no R2 server-side e repassa ao browser.
// Evita erro de CORS: o browser nunca fala direto com o R2.

const express = require('express');
const { GetObjectCommand } = require('@aws-sdk/client-s3');
const { getDB } = require('../services/db');
const { getSignedFileUrl, getPublicUrl } = require('../services/storage');

const router = express.Router();

// GET /api/proxy/:slug
// Usado pelo viewer.js no lugar da URL assinada direta do R2
router.get('/:slug', async (req, res) => {
  try {
    const db = getDB();
    const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(req.params.slug);
    if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

    // Tenta URL pública primeiro (se bucket for público)
    const publicUrl = getPublicUrl(project.file_key);
    const url = publicUrl || await getSignedFileUrl(project.file_key, 300); // 5min é suficiente

    // Fetch server-side — sem restrição de CORS
    const r2Response = await fetch(url);

    if (!r2Response.ok) {
      console.error(`Erro R2: ${r2Response.status} ${r2Response.statusText}`);
      return res.status(502).json({ error: `Falha ao buscar arquivo no R2: ${r2Response.status}` });
    }

    // Repassa headers relevantes
    const contentType = r2Response.headers.get('content-type') || 'application/octet-stream';
    const contentLength = r2Response.headers.get('content-length');

    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'private, max-age=300'); // cache 5min no browser
    if (contentLength) res.setHeader('Content-Length', contentLength);

    // Stream direto para o cliente
    const { Readable } = require('stream');
    Readable.fromWeb(r2Response.body).pipe(res);

  } catch (err) {
    console.error('Erro no proxy:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
