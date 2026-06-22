// src/config.js
// Configuração central. Centraliza o segredo do JWT (antes estava duplicado e
// com fallback público em dois arquivos) e impede o app de subir em produção
// com um segredo conhecido.
'use strict';

const isProd = process.env.NODE_ENV === 'production';

let JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (isProd) {
    console.error('FATAL: JWT_SECRET não definido em produção.');
    console.error('Gere um e configure no ambiente:  openssl rand -hex 32');
    process.exit(1);
  }
  // Em desenvolvimento apenas, um segredo local com aviso. Nunca em produção.
  JWT_SECRET = 'dev-only-insecure-secret-do-not-use-in-production';
  console.warn('[config] JWT_SECRET ausente — usando segredo de DESENVOLVIMENTO. Defina JWT_SECRET em produção.');
}

module.exports = { JWT_SECRET, isProd };
