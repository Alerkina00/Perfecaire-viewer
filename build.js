// build.js — PerfecAire
//
// O viewer 3D usa ES Modules inline no viewer.html, carregados do CDN.
// Não há nada para bundlar. Este script apenas garante que o viewer.bundle.js
// antigo seja removido caso ainda exista no servidor, para evitar que o
// Express o sirva como arquivo estático e cause conflito.

const fs   = require('fs');
const path = require('path');

const bundlePath = path.resolve(__dirname, 'client/public/viewer.bundle.js');

if (fs.existsSync(bundlePath)) {
  fs.unlinkSync(bundlePath);
  console.log('✓ viewer.bundle.js antigo removido — o viewer agora usa CDN direto.');
} else {
  console.log('✓ Nenhum bundle antigo encontrado. Tudo limpo.');
}
