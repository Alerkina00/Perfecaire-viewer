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
    console.log('✓ Removido: ' + path.basename(p));
    removed++;
  }
}

if (removed === 0) {
  console.log('✓ Nenhum arquivo antigo encontrado. Tudo limpo.');
}
