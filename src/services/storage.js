// src/services/storage.js
// ─────────────────────────────────────────────────────────────────────────────
// Armazenamento dos modelos. Usa Cloudflare R2 (a "nuvem") quando as variáveis
// R2_* estão configuradas; caso contrário, cai para o disco local (bom em
// desenvolvimento, mas no Railway o disco é efêmero e some a cada deploy).
//
// R2 é compatível com a API do S3, então usamos o cliente oficial @aws-sdk/client-s3
// apontando para o endpoint do R2, com region 'auto'.
//
// Variáveis de ambiente (defina no painel do Railway):
//   R2_ENDPOINT           https://SEU_ACCOUNT_ID.r2.cloudflarestorage.com
//   R2_ACCESS_KEY_ID      (R2 → Manage API Tokens → Object Read & Write)
//   R2_SECRET_ACCESS_KEY
//   R2_BUCKET_NAME        ex.: perfecaire-models
//   R2_PUBLIC_URL         (opcional) domínio público do bucket, p/ servir direto
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');

const R2_ENDPOINT          = process.env.R2_ENDPOINT;
const R2_ACCESS_KEY_ID     = process.env.R2_ACCESS_KEY_ID;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY;
const R2_BUCKET            = process.env.R2_BUCKET_NAME;
const R2_PUBLIC_URL        = process.env.R2_PUBLIC_URL; // opcional

const USE_R2 = !!(R2_ENDPOINT && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY && R2_BUCKET);

// ── Cliente S3/R2 (lazy) ──────────────────────────────────────────────────────
let _s3 = null;
function getS3() {
  if (_s3) return _s3;
  const { S3Client } = require('@aws-sdk/client-s3');
  _s3 = new S3Client({
    region: 'auto',
    endpoint: R2_ENDPOINT,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });
  return _s3;
}

// ── Fallback local ────────────────────────────────────────────────────────────
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');
if (!USE_R2 && !fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

console.log(USE_R2
  ? `[storage] Cloudflare R2 ativo (bucket: ${R2_BUCKET})`
  : '[storage] R2 não configurado — usando disco local (efêmero no Railway)');

// ── API ───────────────────────────────────────────────────────────────────────

/** Envia um buffer e retorna a key (nome usado para recuperar depois). */
async function uploadFile(buffer, fileName, mimeType) {
  if (USE_R2) {
    const { PutObjectCommand } = require('@aws-sdk/client-s3');
    await getS3().send(new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: fileName,
      Body: buffer,
      ContentType: mimeType,
    }));
    return fileName;
  }
  fs.writeFileSync(path.join(UPLOAD_DIR, fileName), buffer);
  return fileName;
}

/** Stream para leitura do arquivo (usado pelo proxy ao servir ao viewer). */
async function getFileStream(fileKey) {
  if (USE_R2) {
    const { GetObjectCommand } = require('@aws-sdk/client-s3');
    const res = await getS3().send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: fileKey }));
    return res.Body; // Readable stream no Node
  }
  const filePath = path.join(UPLOAD_DIR, fileKey);
  if (!fs.existsSync(filePath)) throw new Error('Arquivo não encontrado');
  return fs.createReadStream(filePath);
}

/** Apaga o arquivo do storage (usado ao excluir um projeto — resolve a NC-07). */
async function deleteFile(fileKey) {
  if (USE_R2) {
    const { DeleteObjectCommand } = require('@aws-sdk/client-s3');
    await getS3().send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: fileKey }));
    return;
  }
  const filePath = path.join(UPLOAD_DIR, fileKey);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

/**
 * URL para o arquivo. Se houver domínio público do R2, devolve a URL direta
 * (mais rápido, sem passar pelo servidor). Senão, devolve a rota do proxy do app.
 */
async function getFileUrl(fileKey) {
  if (USE_R2 && R2_PUBLIC_URL) return `${R2_PUBLIC_URL.replace(/\/$/, '')}/${fileKey}`;
  return `/api/proxy/file/${encodeURIComponent(fileKey)}`;
}

function usingR2() { return USE_R2; }

module.exports = { uploadFile, getFileStream, deleteFile, getFileUrl, usingR2 };
