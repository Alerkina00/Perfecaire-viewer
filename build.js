// build.js — esbuild customizado para resolver imports do three/examples sem extensão .js
// Necessário porque web-ifc-three@0.0.115 importa 'three/examples/jsm/...' sem .js
// e o esbuild não consegue resolver via package.json exports sozinho.

const esbuild = require('esbuild');
const path = require('path');

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

esbuild.build({
  entryPoints: ['client/src/viewer.js'],
  bundle: true,
  outfile: 'client/public/viewer.bundle.js',
  platform: 'browser',
  format: 'iife',
  loader: { '.wasm': 'file' },
  publicPath: '/',
  plugins: [threeExamplesPlugin],
}).then(() => {
  console.log('✓ viewer.bundle.js gerado com sucesso');
}).catch(err => {
  console.error('✘ Build falhou:', err.message);
  process.exit(1);
});
