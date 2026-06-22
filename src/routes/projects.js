// src/routes/projects.js
'use strict';
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Worker } = require('worker_threads');
const { getDb, saveDb } = require('../services/db');
const { uploadFile, deleteFile } = require('../services/storage');
const QRCode = require('qrcode');
const crypto = require('crypto');

const router = express.Router();
const auth = require('../middleware/auth');

// ── Upload em DISCO temporário (não na RAM) ──────────────────────────────────
// memoryStorage segurava o arquivo inteiro na RAM — fatal para um IFC de 162 MB.
// Em disco, o IFC grande nunca ocupa o heap do servidor; o worker lê do caminho.
// O filename também é sanitizado aqui (remove caracteres perigosos → fecha o
// path traversal que existia ao montar nomes de arquivos secundários).
const TMP_DIR = path.join(os.tmpdir(), 'perfecaire-uploads');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.\-]+/g, '_');
      cb(null, crypto.randomBytes(8).toString('hex') + '__' + safe);
    },
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
});

// Lê o conteúdo de um upload em disco (para os formatos pequenos).
const readUpload = (f) => fs.readFileSync(f.path);
// Apaga arquivos temporários do upload.
function limparTemp(files) {
  for (const f of files || []) {
    try { if (f && f.path && fs.existsSync(f.path)) fs.unlinkSync(f.path); } catch (_) {}
  }
}

// ─── helpers de job ───────────────────────────────────────────────────────────
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

async function inserirProjeto(p) {
  const db = await getDb();
  db.run(
    `INSERT INTO projects (slug, name, description, file_name, file_size, file_type, file_key, qr_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [p.slug, p.name, p.description, p.fileName, p.fileSize, p.fileType, p.fileKey, p.qrUrl]
  );
  saveDb();
  return db.exec('SELECT last_insert_rowid()')[0].values[0][0];
}

// ─── Rotas ────────────────────────────────────────────────────────────────────

// Listar projetos
router.get('/', auth, async (req, res) => {
  try {
    const db = await getDb();
    const result = db.exec('SELECT * FROM projects ORDER BY created_at DESC');
    const projects = result.length > 0 ? result[0].values.map(row => ({
      id: row[0], slug: row[1], name: row[2], description: row[3],
      file_name: row[4], file_size: row[5], file_type: row[6],
      file_key: row[7], qr_url: row[8], created_at: row[9],
    })) : [];
    res.json(projects);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Status de job de conversão
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
      file_key: row[7], qr_url: row[8], created_at: row[9],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Criar projeto
router.post('/', auth, upload.array('files', 20), async (req, res) => {
  const files = req.files || [];
  try {
    const { name, description } = req.body;
    if (!name) { limparTemp(files); return res.status(400).json({ error: 'Nome é obrigatório' }); }
    if (files.length === 0) return res.status(400).json({ error: 'Pelo menos um arquivo é obrigatório' });

    const slug = crypto.randomBytes(4).toString('hex');
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

    const gltfFile = files.find(f => f.originalname.toLowerCase().endsWith('.gltf'));
    const binFile  = files.find(f => f.originalname.toLowerCase().endsWith('.bin'));
    const textureFiles = files.filter(f => {
      const ext = f.originalname.toLowerCase().split('.').pop();
      return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'tga', 'bmp'].includes(ext);
    });

    // ── GLTF + BIN → GLB (conversão leve, no próprio request) ──────────────────
    if (gltfFile && binFile) {
      const jobId = crypto.randomBytes(6).toString('hex');
      await createJob(jobId);
      res.status(202).json({ jobId, converting: true });

      setImmediate(async () => {
        try {
          const { gltfBinToGlb } = require('../services/converter');
          const textureBuffers = {};
          for (const tex of textureFiles) textureBuffers[tex.originalname] = readUpload(tex);
          const glbBuffer = await gltfBinToGlb(readUpload(gltfFile), readUpload(binFile), textureBuffers);

          const fileKey = await uploadFile(glbBuffer, `${slug}.glb`, 'model/gltf-binary');
          const viewerUrl = `${baseUrl}/v/${slug}`;
          const qrUrl = await QRCode.toDataURL(viewerUrl);
          await inserirProjeto({ slug, name, description, fileName: gltfFile.originalname, fileSize: glbBuffer.length, fileType: 'glb', fileKey, qrUrl });
          await updateJob(jobId, { status: 'done', slug, viewer_url: viewerUrl, qr_url: qrUrl });
          console.log(`[job:${jobId}] GLB (de GLTF+BIN) na nuvem: /v/${slug}`);
        } catch (err) {
          console.error(`[job:${jobId}] Erro GLTF+BIN:`, err.message);
          await updateJob(jobId, { status: 'error', error: err.message });
        } finally {
          limparTemp(files);
        }
      });
      return;
    }

    const mainFile = files[0];
    const ext = mainFile.originalname.split('.').pop().toLowerCase();

    // ── IFC → conversão pesada em WORKER THREAD (não trava o servidor) ─────────
    if (ext === 'ifc') {
      const jobId = crypto.randomBytes(6).toString('hex');
      await createJob(jobId);
      res.status(202).json({ jobId, converting: true });

      const worker = new Worker(path.join(__dirname, '../services/conversion_worker.js'), {
        workerData: { ifcPath: mainFile.path, compressao: process.env.GLB_COMPRESSION || 'draco' },
        resourceLimits: { maxOldGenerationSizeMb: parseInt(process.env.WORKER_MAX_MB || '8192', 10) },
      });

      worker.on('message', async (msg) => {
        try {
          if (!msg.ok) throw new Error(msg.error);
          const glbBuffer = fs.readFileSync(msg.glbPath);
          const fileKey = await uploadFile(glbBuffer, `${slug}.glb`, 'model/gltf-binary');
          const viewerUrl = `${baseUrl}/v/${slug}`;
          const qrUrl = await QRCode.toDataURL(viewerUrl);
          await inserirProjeto({ slug, name, description, fileName: mainFile.originalname, fileSize: glbBuffer.length, fileType: 'glb', fileKey, qrUrl });
          await updateJob(jobId, { status: 'done', slug, viewer_url: viewerUrl, qr_url: qrUrl });
          console.log(`[job:${jobId}] IFC convertido e na nuvem: /v/${slug} (${(glbBuffer.length/1024).toFixed(0)} KB)`);
          try { if (fs.existsSync(msg.glbPath)) fs.unlinkSync(msg.glbPath); } catch (_) {}
        } catch (err) {
          console.error(`[job:${jobId}] Erro pós-conversão:`, err.message);
          await updateJob(jobId, { status: 'error', error: err.message });
        } finally {
          limparTemp(files);
        }
      });

      worker.on('error', async (err) => {
        console.error(`[job:${jobId}] Worker falhou:`, err.message);
        await updateJob(jobId, { status: 'error', error: err.message });
        limparTemp(files);
      });

      return;
    }

    // ── GLB, GLTF (autocontido), OBJ, FBX → sobe direto ──────────────────────
    const allowedExts = ['glb', 'gltf', 'obj', 'fbx'];
    if (!allowedExts.includes(ext)) {
      limparTemp(files);
      return res.status(400).json({ error: `Formato .${ext} não suportado. Use: GLB, GLTF (autocontido), IFC, OBJ ou FBX.` });
    }

    // GLTF autocontido vs. com .bin externo
    if (ext === 'gltf') {
      const head = fs.readFileSync(mainFile.path, { encoding: 'utf8', flag: 'r' }).slice(0, 8192);
      const hasExternalBin = /"uri"\s*:\s*"(?!data:)[^"]+\.bin"/i.test(head);
      if (hasExternalBin) {
        const binAttached = files.find(f => f.originalname.toLowerCase().endsWith('.bin'));
        if (!binAttached) {
          limparTemp(files);
          return res.status(400).json({ error: 'Este GLTF depende de .bin externo. Selecione o .gltf e o .bin juntos.' });
        }
        const gltfKey = await uploadFile(readUpload(mainFile), `${slug}.gltf`, 'model/gltf+json');
        await uploadFile(readUpload(binAttached), `${slug}_${path.basename(binAttached.originalname)}`, 'application/octet-stream');
        for (const extra of files.filter(f => f !== mainFile && f !== binAttached)) {
          const eext = extra.originalname.split('.').pop().toLowerCase();
          const mime = eext === 'png' ? 'image/png' : (eext === 'jpg' || eext === 'jpeg') ? 'image/jpeg' : eext === 'webp' ? 'image/webp' : 'application/octet-stream';
          await uploadFile(readUpload(extra), `${slug}_${path.basename(extra.originalname)}`, mime);
        }
        const viewerUrl = `${baseUrl}/v/${slug}`;
        const qrUrl = await QRCode.toDataURL(viewerUrl);
        const id = await inserirProjeto({ slug, name, description, fileName: mainFile.originalname, fileSize: fs.statSync(mainFile.path).size, fileType: 'gltf', fileKey: gltfKey, qrUrl });
        limparTemp(files);
        return res.status(201).json({ id, slug, viewerUrl, qrUrl });
      }
    }

    const mimeMap = { gltf: 'model/gltf+json', glb: 'model/gltf-binary', obj: 'text/plain', fbx: 'application/octet-stream' };
    const fileKey = await uploadFile(readUpload(mainFile), `${slug}.${ext}`, mimeMap[ext] || 'application/octet-stream');
    const viewerUrl = `${baseUrl}/v/${slug}`;
    const qrUrl = await QRCode.toDataURL(viewerUrl);
    const id = await inserirProjeto({ slug, name, description, fileName: mainFile.originalname, fileSize: fs.statSync(mainFile.path).size, fileType: ext, fileKey, qrUrl });
    limparTemp(files);
    return res.status(201).json({ id, slug, viewerUrl, qrUrl });

  } catch (err) {
    console.error('[projects] Erro no upload:', err);
    limparTemp(files);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

// Deletar projeto — agora também apaga o arquivo do storage (resolve a NC-07)
router.delete('/:id', auth, async (req, res) => {
  try {
    const db = await getDb();
    const r = db.exec('SELECT file_key, file_type FROM projects WHERE id = ?', [req.params.id]);
    if (r.length && r[0].values.length) {
      const [fileKey] = r[0].values[0];
      try { await deleteFile(fileKey); } catch (e) { console.warn('[projects] Falha ao apagar arquivo:', e.message); }
    }
    db.run('DELETE FROM projects WHERE id = ?', [req.params.id]);
    saveDb();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
