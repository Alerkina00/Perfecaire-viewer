const { S3Client, PutObjectCommand, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { v4: uuidv4 } = require('crypto');

// Cloudflare R2 usa endpoint customizado
const r2 = new S3Client({
  region: 'auto',
  endpoint: process.env.R2_ENDPOINT, // https://<account_id>.r2.cloudflarestorage.com
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
});

const BUCKET = process.env.R2_BUCKET_NAME || 'perfecaire-models';

/**
 * Faz upload de um arquivo para o R2
 * @param {Buffer} buffer - conteúdo do arquivo
 * @param {string} originalName - nome original para manter extensão
 * @param {string} mimeType
 * @returns {string} key do arquivo no bucket
 */
async function uploadFile(buffer, originalName, mimeType) {
  const ext = originalName.split('.').pop().toLowerCase();
  const key = `models/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  await r2.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: buffer,
    ContentType: mimeType || 'application/octet-stream',
    Metadata: {
      originalName,
    },
  }));

  return key;
}

/**
 * Gera URL assinada (válida por 1h) para o viewer carregar o arquivo
 */
async function getSignedFileUrl(key, expiresIn = 3600) {
  const command = new GetObjectCommand({ Bucket: BUCKET, Key: key });
  return getSignedUrl(r2, command, { expiresIn });
}

/**
 * URL pública — só use se o bucket for público
 */
function getPublicUrl(key) {
  const base = process.env.R2_PUBLIC_URL; // ex: https://models.perfecaire.com.br
  if (!base) return null;
  return `${base}/${key}`;
}

/**
 * Remove arquivo do bucket
 */
async function deleteFile(key) {
  await r2.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
}

module.exports = { uploadFile, getSignedFileUrl, getPublicUrl, deleteFile };
