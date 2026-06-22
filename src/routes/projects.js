const express = require('express');
const multer = require('multer');
const { getDb, saveDb } = require('../services/db');
const { uploadFile } = require('../services/storage');
const QRCode = require('qrcode');
const crypto = require('crypto');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }
});

const auth = require('../middleware/auth');

// ─── helpers de job (persistidos no SQLite) ──────────────────────────────────

async function createJob(jobId) {
  const db = await getDb();
  db.run('INSERT INTO conversion_jobs (id, status) VALUES (?, ?)', [jobId, 'processing']);
  saveDb();
}

async function updateJob(jobId, fields) {
  const db = await getDb();
  const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
  const vals = [...Object.values(fields), jobId];
  db.run(`UPDATE conversion_jobs SET ${sets} WHERE id = ?`, vals);
  saveDb();
}

async function getJob(jobId) {
  const db = await getDb();
  const r = db.exec('SELECT id, status, slug, viewer_url, qr_url, error FROM conversion_jobs WHERE id = ?', [jobId]);
  if (!r.length || !r[0].values.length) return null;
  const [id, status, slug, viewer_url, qr_url, error] = r[0].values[0];
  return { id, status, slug, viewerUrl: viewer_url, qrUrl: qr_url, error };
}

// ─── Rotas ───────────────────────────────────────────────────────────────────

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

// Status de um job de conversão (persiste no SQLite — sobrevive a reinicializações)
router.get('/job/:jobId', auth, async (req, res) => {
  try {
    const job = await getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job não encontrado' });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Buscar projeto pelo slug
router.get('/:slug', async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec('SELECT * FROM projects WHERE slug = ?', [req.params.slug]);
    if (!result.length || !result[0].values.length) {
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

// Criar projeto
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

    // IFC → conversão assíncrona, status salvo no banco
    if (ext === 'ifc') {
      const jobId = crypto.randomBytes(6).toString('hex');
      await createJob(jobId);

      // Responde imediatamente
      res.status(202).json({ jobId, converting: true });

      // Processa em background
      const fileBuffer = file.buffer;
      const originalName = file.originalname;
      const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

      setImmediate(async () => {
        try {
          console.log(`[job:${jobId}] Convertendo IFC: ${originalName}`);
          const { ifcToGltf } = require('../services/converter');
          const gltfBuffer = await ifcToGltf(fileBuffer);
          const fileName = `${slug}.gltf`;
          console.log(`[job:${jobId}] Conversão concluída: ${gltfBuffer.length} bytes`);

          const fileKey = await uploadFile(gltfBuffer, fileName, 'model/gltf+json');
          const viewerUrl = `${baseUrl}/v/${slug}`;
          const qrUrl = await QRCode.toDataURL(viewerUrl);

          const db = await getDb();
          db.run(
            `INSERT INTO projects (slug, name, description, file_name, file_size, file_type, file_key, qr_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [slug, name, description, originalName, gltfBuffer.length, 'gltf', fileKey, qrUrl]
          );
          await updateJob(jobId, { status: 'done', slug, viewer_url: viewerUrl, qr_url: qrUrl });
          console.log(`[job:${jobId}] Projeto criado: ${slug}`);
        } catch (err) {
          console.error(`[job:${jobId}] Erro na conversão:`, err.message);
          await updateJob(jobId, { status: 'error', error: err.message });
        }
      });

      return;
    }

    // Outros formatos — sobe direto
    const mimeMap = {
      gltf: 'model/gltf+json',
      glb: 'model/gltf-binary',
      obj: 'text/plain',
      fbx: 'application/octet-stream',
    };
    const fileName = `${slug}.${ext}`;
    const fileKey = await uploadFile(file.buffer, fileName, mimeMap[ext] || 'application/octet-stream');

    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;
    const viewerUrl = `${baseUrl}/v/${slug}`;
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
      slug, viewerUrl, qrUrl,
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
