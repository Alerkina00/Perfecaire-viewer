// build.js — esbuild customizado para resolver imports do three/examples sem extensão .js
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
      const wasmSource = path.resolve(__dirname, 'node_modules/web-ifc/IFC.wasm');
      const wasmDest = path.resolve(__dirname, 'client/public/IFC.wasm');
      
      if (fs.existsSync(wasmSource)) {
        fs.copyFileSync(wasmSource, wasmDest);
        console.log('✓ IFC.wasm copiado para client/public/');
      } else {
        console.warn('⚠ IFC.wasm não encontrado em node_modules/web-ifc/');
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
    '.wasm': 'file'  // Mudamos de 'empty' para 'file'
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
