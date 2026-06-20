const fs = require('fs');
const path = require('path');

// Armazenamento local (fallback sem S3)
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads');

// Cria pasta se não existir
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

async function uploadFile(buffer, fileName, mimeType) {
  const filePath = path.join(UPLOAD_DIR, fileName);
  fs.writeFileSync(filePath, buffer);
  return fileName; // Retorna o nome do arquivo como key
}

async function getFileUrl(fileKey) {
  // Serve o arquivo localmente
  return `/uploads/${fileKey}`;
}

async function getFileStream(fileKey) {
  const filePath = path.join(UPLOAD_DIR, fileKey);
  if (!fs.existsSync(filePath)) {
    throw new Error('Arquivo não encontrado');
  }
  return fs.createReadStream(filePath);
}

module.exports = { uploadFile, getFileUrl, getFileStream };
