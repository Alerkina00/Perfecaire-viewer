const express = require('express');
const multer = require('multer');
const { getDb, saveDb } = require('../services/db');
const { uploadFile } = require('../services/storage');
const QRCode = require('qrcode');
const crypto = require('crypto');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 } // 500MB
});

const auth = require('../middleware/auth');

// Mapa de jobs de conversão em andamento
// { [jobId]: { status: 'processing'|'done'|'error', slug, error } }
const conversionJobs = {};

// Listar projetos
router.get('/', auth, async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec('SELECT * FROM projects ORDER BY created_at DESC');
    const projects = result.length > 0 ? result[0].values.map(row => ({
      id: row[0], slug: row[1], name: row[2], description: row[3],
      file_name: row[4], file_size: row[5], file_type: row[6],
      file_key: row[7], qr_url: row[8], created_at: row[9]
    })) : [];
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Status de conversão de um job
router.get('/job/:jobId', auth, (req, res) => {
  const job = conversionJobs[req.params.jobId];
  if (!job) return res.status(404).json({ error: 'Job não encontrado' });
  res.json(job);
});

// Buscar um projeto pelo slug
router.get('/:slug', async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec('SELECT * FROM projects WHERE slug = ?', [req.params.slug]);
    if (result.length === 0 || result[0].values.length === 0) {
      return res.status(404).json({ error: 'Projeto não encontrado' });
    }
    const row = result[0].values[0];
    res.json({
      id: row[0], slug: row[1], name: row[2], description: row[3],
      file_name: row[4], file_size: row[5], file_type: row[6],
      file_key: row[7], qr_url: row[8], created_at: row[9]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Criar projeto — IFC converte em background; outros formatos sobem direto
router.post('/', auth, upload.single('file'), async (req, res) => {
  try {
    const { name, description } = req.body;
    const file = req.file;

    if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
    if (!file) return res.status(400).json({ error: 'Arquivo é obrigatório' });

    const slug = crypto.randomBytes(4).toString('hex');
    const ext = file.originalname.split('.').pop().toLowerCase();
    const allowed = ['ifc', 'gltf', 'glb', 'obj', 'fbx'];
    if (!allowed.includes(ext)) {
      return res.status(400).json({ error: `Formato .${ext} não suportado` });
    }

    // IFC → conversão assíncrona em background
    if (ext === 'ifc') {
      const jobId = crypto.randomBytes(6).toString('hex');
      conversionJobs[jobId] = { status: 'processing', slug: null, error: null };

      // Responde imediatamente com o jobId
      res.status(202).json({ jobId, converting: true });

      // Processa em background (sem bloquear o request)
      const fileBuffer = file.buffer;
      const originalName = file.originalname;
      setImmediate(async () => {
        try {
          console.log(`[job:${jobId}] Convertendo IFC: ${originalName}`);
          const { ifcToGltf } = require('../services/converter');
          const gltfBuffer = await ifcToGltf(fileBuffer);
          const fileName = `${slug}.gltf`;
          console.log(`[job:${jobId}] Conversão concluída: ${gltfBuffer.length} bytes`);

          const fileKey = await uploadFile(gltfBuffer, fileName, 'model/gltf+json');
          const viewerUrl = `${process.env.BASE_URL || 'http://localhost:3000'}/v/${slug}`;
          const qrUrl = await QRCode.toDataURL(viewerUrl);

          const db = await getDb();
          db.run(
            `INSERT INTO projects (slug, name, description, file_name, file_size, file_type, file_key, qr_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [slug, name, description, originalName, gltfBuffer.length, 'gltf', fileKey, qrUrl]
          );
          saveDb();

          conversionJobs[jobId] = { status: 'done', slug, viewerUrl, qrUrl };
          console.log(`[job:${jobId}] Projeto criado: ${slug}`);

          // Limpa o job após 10 minutos
          setTimeout(() => { delete conversionJobs[jobId]; }, 10 * 60 * 1000);
        } catch (err) {
          console.error(`[job:${jobId}] Erro na conversão:`, err.message);
          conversionJobs[jobId] = { status: 'error', error: err.message };
        }
      });

      return; // já respondeu com 202
    }

    // Formatos que não precisam de conversão — sobe direto
    const fileName = `${slug}.${ext}`;
    const mimeMap = {
      gltf: 'model/gltf+json',
      glb: 'model/gltf-binary',
      obj: 'text/plain',
      fbx: 'application/octet-stream',
    };
    const fileKey = await uploadFile(file.buffer, fileName, mimeMap[ext] || 'application/octet-stream');

    const host = req.get('host');
    const protocol = req.protocol;
    const viewerUrl = `${process.env.BASE_URL || `${protocol}://${host}`}/v/${slug}`;
    const qrUrl = await QRCode.toDataURL(viewerUrl);

    const db = await getDb();
    db.run(
      `INSERT INTO projects (slug, name, description, file_name, file_size, file_type, file_key, qr_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [slug, name, description, file.originalname, file.buffer.length, ext, fileKey, qrUrl]
    );
    saveDb();

    res.status(201).json({
      id: db.exec('SELECT last_insert_rowid()')[0].values[0][0],
      slug,
      viewerUrl,
      qrUrl,
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
