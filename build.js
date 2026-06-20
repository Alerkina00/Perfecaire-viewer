// build.js — esbuild customizado
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

// Plugin para resolver imports do Three.js examples
const threeExamplesPlugin = {
  name: 'three-examples-fix',
  setup(build) {
    build.onResolve({ filter: /^three\/examples\/jsm\// }, args => {
      const withExt = args.path.endsWith('.js') ? args.path : args.path + '.js';
      return {
        path: path.resolve(
          __dirname,
          'node_modules',
          withExt.replace(/^three\//, 'three/')
        )
      };
    });
  }
};

// Plugin para copiar o arquivo WASM do web-ifc
const copyWasmPlugin = {
  name: 'copy-wasm',
  setup(build) {
    build.onEnd(() => {
      // Procura o WASM em diferentes locais possíveis
      const possiblePaths = [
        path.resolve(__dirname, 'node_modules/web-ifc/IFC.wasm'),
        path.resolve(__dirname, 'node_modules/web-ifc/dist/IFC.wasm'),
        path.resolve(__dirname, 'node_modules/web-ifc/wasm/IFC.wasm')
      ];
      
      let wasmSource = null;
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          wasmSource = p;
          break;
        }
      }
      
      if (wasmSource) {
        const wasmDest = path.resolve(__dirname, 'client/public/IFC.wasm');
        // Cria a pasta se não existir
        const destDir = path.dirname(wasmDest);
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        fs.copyFileSync(wasmSource, wasmDest);
        console.log('✓ IFC.wasm copiado para client/public/');
      } else {
        console.warn('⚠ IFC.wasm não encontrado. Baixando da internet...');
        // Fallback: tenta baixar do CDN
        const https = require('https');
        const wasmDest = path.resolve(__dirname, 'client/public/IFC.wasm');
        const file = fs.createWriteStream(wasmDest);
        https.get('https://cdn.jsdelivr.net/npm/web-ifc@0.0.58/IFC.wasm', (response) => {
          response.pipe(file);
          file.on('finish', () => {
            file.close();
            console.log('✓ IFC.wasm baixado do CDN para client/public/');
          });
        }).on('error', (err) => {
          console.warn('⚠ Não foi possível baixar IFC.wasm:', err.message);
        });
      }
    });
  }
};

esbuild.build({
  entryPoints: ['client/src/viewer.js'],
  bundle: true,
  outfile: 'client/public/viewer.bundle.js',
  platform: 'browser',
  format: 'iife',
  loader: { 
    '.wasm': 'file'
  },
  publicPath: '/',
  plugins: [threeExamplesPlugin, copyWasmPlugin],
  define: {
    'process.env.NODE_ENV': '"production"'
  }
}).then(() => {
  console.log('✓ viewer.bundle.js gerado com sucesso');
}).catch(err => {
  console.error('✘ Build falhou:', err.message);
  process.exit(1);
});
