// src/routes/projects.js
const express = require('express');
const multer = require('multer');
const { getDb, saveDb } = require('../services/db');
const { uploadFile } = require('../services/storage');
const QRCode = require('qrcode');
const crypto = require('crypto');

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

const auth = require('../middleware/auth');

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

// Criar projeto (upload com suporte a múltiplos arquivos)
router.post('/', auth, upload.array('files', 20), async (req, res) => {
  try {
    const { name, description } = req.body;
    const files = req.files;

    if (!name) return res.status(400).json({ error: 'Nome é obrigatório' });
    if (!files || files.length === 0) {
      return res.status(400).json({ error: 'Pelo menos um arquivo é obrigatório' });
    }

    const slug = crypto.randomBytes(4).toString('hex');
    const baseUrl = process.env.BASE_URL || `${req.protocol}://${req.get('host')}`;

    // ── Verifica se é um conjunto GLTF + BIN ──────────────────────────────────
    const gltfFile  = files.find(f => f.originalname.toLowerCase().endsWith('.gltf'));
    const binFile   = files.find(f => f.originalname.toLowerCase().endsWith('.bin'));
    const textureFiles = files.filter(f => {
      const ext = f.originalname.toLowerCase().split('.').pop();
      return ['png', 'jpg', 'jpeg', 'webp', 'gif', 'tga', 'bmp'].includes(ext);
    });

    // ── GLTF + BIN: tenta converter para GLB, ou serve os arquivos separados ──
    if (gltfFile && binFile) {
      const jobId = crypto.randomBytes(6).toString('hex');
      await createJob(jobId);

      res.status(202).json({ jobId, converting: true });

      setImmediate(async () => {
        try {
          console.log(`[job:${jobId}] Convertendo GLTF+BIN para GLB...`);
          const { gltfBinToGlb } = require('../services/converter');

          const textureBuffers = {};
          for (const tex of textureFiles) {
            textureBuffers[tex.originalname] = tex.buffer;
          }

          const glbBuffer = await gltfBinToGlb(
            gltfFile.buffer,
            binFile.buffer,
            textureBuffers
          );

          const fileName = `${slug}.glb`;
          const fileKey = await uploadFile(glbBuffer, fileName, 'model/gltf-binary');

          const viewerUrl = `${baseUrl}/v/${slug}`;
          const qrUrl = await QRCode.toDataURL(viewerUrl);

          const db = await getDb();
          db.run(
            `INSERT INTO projects (slug, name, description, file_name, file_size, file_type, file_key, qr_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [slug, name, description, gltfFile.originalname, glbBuffer.length, 'glb', fileKey, qrUrl]
          );
          saveDb();
          await updateJob(jobId, { status: 'done', slug, viewer_url: viewerUrl, qr_url: qrUrl });
          console.log(`[job:${jobId}] GLB criado: /v/${slug}`);
        } catch (convErr) {
          // ── Fallback: salva GLTF + auxiliares separados ──────────────────────
          console.warn(`[job:${jobId}] Conversão GLB falhou (${convErr.message}), salvando GLTF + auxiliares...`);
          try {
            // Salva o GLTF principal com fileKey = "SLUG.gltf"
            const gltfKey = await uploadFile(gltfFile.buffer, `${slug}.gltf`, 'model/gltf+json');

            // Salva o .bin com fileKey = "SLUG_ORIGINALNAME"
            await uploadFile(binFile.buffer, `${slug}_${binFile.originalname}`, 'application/octet-stream');

            // Salva texturas
            for (const tex of textureFiles) {
              const ext = tex.originalname.split('.').pop().toLowerCase();
              const mime = ext === 'png' ? 'image/png'
                : (ext === 'jpg' || ext === 'jpeg') ? 'image/jpeg'
                : ext === 'webp' ? 'image/webp'
                : 'application/octet-stream';
              await uploadFile(tex.buffer, `${slug}_${tex.originalname}`, mime);
            }

            const viewerUrl = `${baseUrl}/v/${slug}`;
            const qrUrl = await QRCode.toDataURL(viewerUrl);

            const db = await getDb();
            db.run(
              `INSERT INTO projects (slug, name, description, file_name, file_size, file_type, file_key, qr_url)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
              [slug, name, description, gltfFile.originalname, gltfFile.buffer.length, 'gltf', gltfKey, qrUrl]
            );
            saveDb();
            await updateJob(jobId, { status: 'done', slug, viewer_url: viewerUrl, qr_url: qrUrl });
            console.log(`[job:${jobId}] Projeto GLTF+BIN salvo separado: /v/${slug}`);
          } catch (fallbackErr) {
            console.error(`[job:${jobId}] Fallback também falhou:`, fallbackErr.message);
            await updateJob(jobId, { status: 'error', error: fallbackErr.message });
          }
        }
      });

      return;
    }

    // ── IFC → conversão assíncrona ────────────────────────────────────────────
    const mainFile = files[0];
    const ext = mainFile.originalname.split('.').pop().toLowerCase();

    if (ext === 'ifc') {
      const jobId = crypto.randomBytes(6).toString('hex');
      await createJob(jobId);

      res.status(202).json({ jobId, converting: true });

      setImmediate(async () => {
        try {
          console.log(`[job:${jobId}] Convertendo IFC para GLB...`);
          const { ifcToGlb } = require('../services/converter');
          const glbBuffer = await ifcToGlb(mainFile.buffer);

          const fileName = `${slug}.glb`;
          const fileKey = await uploadFile(glbBuffer, fileName, 'model/gltf-binary');

          const viewerUrl = `${baseUrl}/v/${slug}`;
          const qrUrl = await QRCode.toDataURL(viewerUrl);

          const db = await getDb();
          db.run(
            `INSERT INTO projects (slug, name, description, file_name, file_size, file_type, file_key, qr_url)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [slug, name, description, mainFile.originalname, glbBuffer.length, 'glb', fileKey, qrUrl]
          );
          saveDb();
          await updateJob(jobId, { status: 'done', slug, viewer_url: viewerUrl, qr_url: qrUrl });
          console.log(`[job:${jobId}] Projeto criado: /v/${slug}`);
        } catch (err) {
          console.error(`[job:${jobId}] Erro:`, err.message);
          await updateJob(jobId, { status: 'error', error: err.message });
        }
      });

      return;
    }

    // ── GLB, GLTF (autocontido), OBJ, FBX → sobe direto ──────────────────────
    const allowedExts = ['glb', 'gltf', 'obj', 'fbx'];
    if (!allowedExts.includes(ext)) {
      return res.status(400).json({
        error: `Formato .${ext} não suportado. Use: GLB, GLTF (autocontido), IFC, OBJ ou FBX.`
      });
    }

    // Para GLTF: verifica se tem referência a .bin externo
    // Se tiver, salva os auxiliares separados (não rejeita mais)
    if (ext === 'gltf') {
      const text = mainFile.buffer.toString('utf8', 0, Math.min(mainFile.buffer.length, 8192));
      const hasExternalBin = /"uri"\s*:\s*"(?!data:)[^"]+\.bin"/i.test(text);

      if (hasExternalBin) {
        // Verifica se o .bin foi enviado junto
        const binAttached = files.find(f => f.originalname.toLowerCase().endsWith('.bin'));
        if (!binAttached) {
          return res.status(400).json({
            error: 'Este GLTF depende de arquivo .bin externo. Selecione o .gltf e o .bin juntos no upload.',
          });
        }

        // Salva ambos com prefixo do slug para o proxy encontrar
        const gltfKey = await uploadFile(mainFile.buffer, `${slug}.gltf`, 'model/gltf+json');
        await uploadFile(binAttached.buffer, `${slug}_${binAttached.originalname}`, 'application/octet-stream');

        // Salva texturas extras se houver
        const extras = files.filter(f =>
          f !== mainFile && f !== binAttached
        );
        for (const extra of extras) {
          const eext = extra.originalname.split('.').pop().toLowerCase();
          const mime = eext === 'png' ? 'image/png'
            : (eext === 'jpg' || eext === 'jpeg') ? 'image/jpeg'
            : eext === 'webp' ? 'image/webp'
            : 'application/octet-stream';
          await uploadFile(extra.buffer, `${slug}_${extra.originalname}`, mime);
        }

        const viewerUrl = `${baseUrl}/v/${slug}`;
        const qrUrl = await QRCode.toDataURL(viewerUrl);

        const db = await getDb();
        db.run(
          `INSERT INTO projects (slug, name, description, file_name, file_size, file_type, file_key, qr_url)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [slug, name, description, mainFile.originalname, mainFile.buffer.length, 'gltf', gltfKey, qrUrl]
        );
        saveDb();

        return res.status(201).json({
          id: db.exec('SELECT last_insert_rowid()')[0].values[0][0],
          slug, viewerUrl, qrUrl,
        });
      }
    }

    const mimeMap = {
      gltf: 'model/gltf+json',
      glb: 'model/gltf-binary',
      obj: 'text/plain',
      fbx: 'application/octet-stream',
    };

    const fileName = `${slug}.${ext}`;
    const fileKey = await uploadFile(mainFile.buffer, fileName, mimeMap[ext] || 'application/octet-stream');

    const viewerUrl = `${baseUrl}/v/${slug}`;
    const qrUrl = await QRCode.toDataURL(viewerUrl);

    const db = await getDb();
    db.run(
      `INSERT INTO projects (slug, name, description, file_name, file_size, file_type, file_key, qr_url)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [slug, name, description, mainFile.originalname, mainFile.buffer.length, ext, fileKey, qrUrl]
    );
    saveDb();

    res.status(201).json({
      id: db.exec('SELECT last_insert_rowid()')[0].values[0][0],
      slug, viewerUrl, qrUrl,
    });

  } catch (err) {
    console.error('[projects] Erro no upload:', err);
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
