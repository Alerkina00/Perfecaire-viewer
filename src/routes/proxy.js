const express = require('express');
const { getFileStream } = require('../services/storage');
const { getDb } = require('../services/db');

const router = express.Router();

router.get('/:slug', async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec('SELECT * FROM projects WHERE slug = ?', [req.params.slug]);
    
    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: 'Projeto não encontrado' });
    }
    
    const row = result[0].values[0];
    const fileKey = row[7]; // file_key
    const fileType = row[6]; // file_type

    // Define o content-type correto
    const mimeTypes = {
      'ifc': 'application/octet-stream',
      'gltf': 'application/octet-stream',
      'glb': 'model/gltf-binary',
      'obj': 'text/plain',
      'fbx': 'application/octet-stream'
    };

    res.setHeader('Content-Type', mimeTypes[fileType] || 'application/octet-stream');
    
    const stream = await getFileStream(fileKey);
    stream.pipe(res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
