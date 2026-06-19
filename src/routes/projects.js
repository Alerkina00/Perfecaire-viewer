const express = require('express');
const multer = require('multer');
const QRCode = require('qrcode');
const { getDB } = require('../services/db');
const { requireAuth } = require('../middleware/auth');
const { uploadFile, deleteFile, getSignedFileUrl, getPublicUrl } = require('../services/storage');

const router = express.Router();

// Multer — armazena na memória, depois manda para R2
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500MB max
  fileFilter: (req, file, cb) => {
    const allowed = ['.ifc', '.gltf', '.glb', '.obj', '.fbx'];
    const ext = '.' + file.originalname.split('.').pop().toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Formato não suportado: ${ext}. Use: ${allowed.join(', ')}`));
    }
  },
});

function slugify(text) {
  return text
    .toString()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}

// GET /api/projects — lista todos
router.get('/', requireAuth, (req, res) => {
  const db = getDB();
  const projects = db.prepare(`
    SELECT id, slug, name, description, file_type, file_size, qr_url, created_at
    FROM projects ORDER BY created_at DESC
  `).all();
  res.json(projects);
});

// GET /api/projects/:slug — detalhe + URL assinada para o viewer
router.get('/:slug', async (req, res) => {
  const db = getDB();
  const project = db.prepare('SELECT * FROM projects WHERE slug = ?').get(req.params.slug);
  if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

  let fileUrl;
  const publicUrl = getPublicUrl(project.file_key);
  if (publicUrl) {
    fileUrl = publicUrl;
  } else {
    fileUrl = await getSignedFileUrl(project.file_key);
  }

  res.json({ ...project, fileUrl });
});

// POST /api/projects — cria projeto + upload
router.post('/', requireAuth, upload.single('file'), async (req, res) => {
  try {
    const { name, description } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome obrigatório' });
    if (!req.file) return res.status(400).json({ error: 'Arquivo obrigatório' });

    const ext = req.file.originalname.split('.').pop().toLowerCase();
    const mimeTypes = {
      ifc: 'application/x-step',
      gltf: 'model/gltf+json',
      glb: 'model/gltf-binary',
      obj: 'text/plain',
      fbx: 'application/octet-stream',
    };

    // Upload para R2
    const fileKey = await uploadFile(req.file.buffer, req.file.originalname, mimeTypes[ext]);

    // Cria slug único
    let slug = slugify(name);
    const db = getDB();
    const existing = db.prepare('SELECT id FROM projects WHERE slug = ?').get(slug);
    if (existing) slug = `${slug}-${Date.now().toString(36)}`;

    // Gera QR Code
    const viewerUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/v/${slug}`;
    const qrDataUrl = await QRCode.toDataURL(viewerUrl, { width: 300, margin: 2 });

    const result = db.prepare(`
      INSERT INTO projects (slug, name, description, file_key, file_type, file_size, qr_url)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(slug, name, description || '', fileKey, ext, req.file.size, qrDataUrl);

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ ...project, viewerUrl });

  } catch (err) {
    console.error('Erro no upload:', err);
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/projects/:id
router.delete('/:id', requireAuth, async (req, res) => {
  const db = getDB();
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(req.params.id);
  if (!project) return res.status(404).json({ error: 'Projeto não encontrado' });

  try {
    if (project.file_key) await deleteFile(project.file_key);
    db.prepare('DELETE FROM projects WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
