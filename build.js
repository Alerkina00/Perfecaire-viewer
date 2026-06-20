// build.js — esbuild PerfecAire
//
// NOTA: O viewer 3D (Three.js + web-ifc) roda via ES Modules inline no
// viewer.html, carregado do CDN. Não é bundlado aqui para evitar:
//   - LinkError no WASM do web-ifc (Emscripten quebra quando bundlado)
//   - "Multiple instances of Three.js"
//
// Este build.js existe caso você adicione outros scripts JS para bundlar
// (ex: painel admin, utilitários). Se não houver nada a bundlar, pode
// simplesmente não chamar "npm run build:client" — o viewer.html funciona
// direto sem nenhum bundle.

const esbuild = require('esbuild');
const path    = require('path');
const fs      = require('fs');

// ─── Verifica se há algo para bundlar ────────────────────────────────────────

const ENTRY = path.resolve(__dirname, 'client/src/admin.js'); // ajuste se necessário

if (!fs.existsSync(ENTRY)) {
  console.log('ℹ Nenhum entry point encontrado em client/src/admin.js');
  console.log('  O viewer.html usa ES Modules inline — nenhum bundle necessário.');
  console.log('  Adicione client/src/admin.js se quiser bundlar o painel admin.');
  process.exit(0);
}

// ─── Bundle do admin (se existir) ────────────────────────────────────────────

esbuild.build({
  entryPoints: [ENTRY],
  bundle: true,
  outfile: 'client/public/admin.bundle.js',
  platform: 'browser',
  format: 'iife',
  define: {
    'process.env.NODE_ENV': '"production"'
  },
  target: ['es2020'],
  minify: true,
  sourcemap: false,
}).then(() => {
  console.log('✓ admin.bundle.js gerado com sucesso');
}).catch(err => {
  console.error('✘ Build falhou:', err.message);
  process.exit(1);
});
