const express = require('express');
const multer = require('multer');
const { getDb, saveDb } = require('../services/db');
const { uploadFile, getFileUrl } = require('../services/storage');
const QRCode = require('qrcode');
const crypto = require('crypto');

const router = express.Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB
});

// Middleware de autenticação
const auth = require('../middleware/auth');

// Listar projetos
router.get('/', auth, async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec('SELECT * FROM projects ORDER BY created_at DESC');
    const projects = result.length > 0 ? result[0].values.map(row => ({
      id: row[0],
      slug: row[1],
      name: row[2],
      description: row[3],
      file_name: row[4],
      file_size: row[5],
      file_type: row[6],
      file_key: row[7],
      qr_url: row[8],
      created_at: row[9]
    })) : [];
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Buscar um projeto
router.get('/:slug', async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec('SELECT * FROM projects WHERE slug = ?', [req.params.slug]);
    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: 'Projeto não encontrado' });
    }
    const row = result[0].values[0];
    const project = {
      id: row[0],
      slug: row[1],
      name: row[2],
      description: row[3],
      file_name: row[4],
      file_size: row[5],
      file_type: row[6],
      file_key: row[7],
      qr_url: row[8],
      created_at: row[9]
    };
    res.json(project);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Criar projeto
router.post('/', auth, upload.single('file'), async (req, res) => {
  try {
    const { name, description } = req.body;
    const file = req.file;

    if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
    if (!file) return res.status(400).json({ error: 'Arquivo é obrigatório' });

    const slug = crypto.randomBytes(4).toString('hex');
    const ext = file.originalname.split('.').pop().toLowerCase();
    const fileName = `${slug}.${ext}`;

    // Upload para S3 (ou local)
    const fileKey = await uploadFile(file.buffer, fileName, file.mimetype);

    // Gera URL do viewer
    const viewerUrl = `${req.protocol}://${req.get('host')}/v/${slug}`;
    const qrUrl = await QRCode.toDataURL(viewerUrl);

    const db = await getDb();
    db.run(`
      INSERT INTO projects (slug, name, description, file_name, file_size, file_type, file_key, qr_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [slug, name, description, file.originalname, file.size, ext, fileKey, qrUrl]);

    saveDb();

    res.status(201).json({
      id: db.exec('SELECT last_insert_rowid()')[0].values[0][0],
      slug,
      viewerUrl,
      qrUrl
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// Deletar projeto
router.delete('/:id', auth, async (req, res) => {
  try {
    const db = await getDb();
    db.run('DELETE FROM projects WHERE id = ?', [req.params.id]);
    saveDb();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
