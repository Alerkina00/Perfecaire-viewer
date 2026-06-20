// build.js — PerfecAire
//
// O viewer usa ES Modules inline no viewer.html, carregados do CDN.
// Este script apenas remove o viewer.bundle.js antigo caso ainda exista,
// evitando que o Express o sirva como estático e cause o erro de WASM/Three.js.

const fs   = require('fs');
const path = require('path');

const toRemove = [
  path.resolve(__dirname, 'client/public/viewer.bundle.js'),
  path.resolve(__dirname, 'client/public/IFC.wasm'),
];

let removed = 0;
for (const p of toRemove) {
  if (fs.existsSync(p)) {
    fs.unlinkSync(p);
    console.log(`✓ Removido: ${path.basename(p)}`);
    removed++;
  }
}

if (removed === 0) {
  console.log('✓ Nenhum arquivo antigo encontrado. Tudo limpo.');
}
