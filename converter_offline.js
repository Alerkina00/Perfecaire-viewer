#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// converter_offline.js — converte um IFC (mesmo grande, do Revit) em GLB leve,
// na SUA máquina, sem passar pelo servidor. Sobe-se depois só o .glb pronto.
//
// USO:
//   node --max-old-space-size=8192 converter_offline.js entrada.ifc [saida.glb]
//
//   O --max-old-space-size dá mais RAM ao Node (8192 = 8 GB). Necessário para
//   IFC grande — sem isso o Node trava com "heap out of memory".
//
// OPÇÕES (variáveis de ambiente):
//   COMPRESSAO=draco|meshopt|none   compressão de geometria        (padrão: draco)
//   SIMPLIFY=0.0..1.0               reduz nº de triângulos          (padrão: 0 = desligado)
//                                   ex.: 0.5 = mira em metade dos triângulos.
//                                   LIGA só se o modelo pesar no viewer — degrada um pouco.
//   SIMPLIFY_ERROR=0.01             erro máx. do simplify (1%)      (padrão: 0.01)
//                                   maior = corta mais triângulos, degrada mais.
//   QUANT_POS=14                    bits de posição (modo meshopt)  (padrão: 14)
//
// PUBLICAÇÃO AUTOMÁTICA NA NUVEM (opcional):
//   Se VIEWER_URL e ADMIN_PASSWORD forem definidos, o script sobe o GLB pronto
//   pro viewer logo após converter — o servidor só armazena (não converte nada).
//   VIEWER_URL=https://seu-viewer.up.railway.app   endereço do seu viewer
//   ADMIN_USER=admin                               usuário admin (padrão: admin)
//   ADMIN_PASSWORD=sua-senha                        senha do admin
//   PROJ_NOME="HVAC Bloco A"                        nome do projeto (padrão: nome do arquivo)
//   PROJ_DESC="Piso 2 - rev.3"                      descrição (opcional)
//
// EXEMPLO COMPLETO (converte E publica num comando):
//   VIEWER_URL=https://seu-viewer.up.railway.app ADMIN_PASSWORD=senha \
//     node --max-old-space-size=8192 converter_offline.js modelo.ifc
//
// EXEMPLOS:
//   node --max-old-space-size=8192 converter_offline.js modelo.ifc
//   SIMPLIFY=0.6 node --max-old-space-size=8192 converter_offline.js modelo.ifc leve.glb
//   COMPRESSAO=meshopt node --max-old-space-size=8192 converter_offline.js modelo.ifc
//
// Dependências: as mesmas do projeto (npm install já as instalou):
//   web-ifc, @gltf-transform/core|extensions|functions, draco3dgltf, meshoptimizer
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const fs = require('fs');
const path = require('path');

const ENTRADA    = process.argv[2];
const SAIDA      = process.argv[3] || (ENTRADA ? ENTRADA.replace(/\.ifc$/i, '') + '.glb' : null);
const COMPRESSAO = process.env.COMPRESSAO || 'draco';
const SIMPLIFY   = parseFloat(process.env.SIMPLIFY || '0');
const SIMP_ERROR = parseFloat(process.env.SIMPLIFY_ERROR || '0.01'); // 1% — afrouxe p/ reduzir mais
const QUANT_POS  = parseInt(process.env.QUANT_POS || '14', 10);

// Publicação automática (opcional): ativa se VIEWER_URL e ADMIN_PASSWORD existirem.
const VIEWER_URL     = (process.env.VIEWER_URL || '').replace(/\/+$/, '');
const ADMIN_USER     = process.env.ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const PROJ_NOME      = process.env.PROJ_NOME || '';
const PROJ_DESC      = process.env.PROJ_DESC || '';
const PUBLICAR       = !!(VIEWER_URL && ADMIN_PASSWORD);

if (!ENTRADA) {
  console.error('Uso: node --max-old-space-size=8192 converter_offline.js entrada.ifc [saida.glb]');
  process.exit(1);
}
if (!fs.existsSync(ENTRADA)) {
  console.error(`Arquivo não encontrado: ${ENTRADA}`);
  process.exit(1);
}

const fmt  = b => b > 1048576 ? (b/1048576).toFixed(1)+' MB' : b > 1024 ? (b/1024).toFixed(0)+' KB' : b+' B';
const fmtN = n => Math.round(n).toLocaleString('pt-BR');

// Sobe o GLB já pronto pro viewer: faz login e envia o arquivo. O servidor só
// armazena (GLB é formato direto — não dispara conversão nenhuma no servidor).
// Requer Node 18+ (fetch/FormData/Blob nativos).
async function publicarNaNuvem(glb, filename, nome, desc) {
  const r1 = await fetch(VIEWER_URL + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASSWORD }),
  });
  if (!r1.ok) throw new Error(`login falhou (HTTP ${r1.status}) — confira VIEWER_URL, ADMIN_USER e ADMIN_PASSWORD`);
  const { token } = await r1.json();

  const form = new FormData();
  form.append('name', nome);
  form.append('description', desc || '');
  form.append('files', new Blob([glb], { type: 'model/gltf-binary' }), filename);
  const r2 = await fetch(VIEWER_URL + '/api/projects', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token },
    body: form,
  });
  const data = await r2.json().catch(() => ({}));
  if (!r2.ok) throw new Error(`upload falhou (HTTP ${r2.status}): ${data.error || JSON.stringify(data)}`);
  return data; // { slug, viewerUrl, qrUrl }
}

(async () => {
  const t0 = Date.now();

  console.log(`\n▶ Lendo ${path.basename(ENTRADA)} ...`);
  const ifcBuffer = fs.readFileSync(ENTRADA);
  console.log(`  IFC de entrada: ${fmt(ifcBuffer.length)}`);

  const WebIFC = require('web-ifc');
  const core = await import('@gltf-transform/core');
  const ext  = await import('@gltf-transform/extensions');
  const fns  = await import('@gltf-transform/functions');

  console.log('▶ Inicializando web-ifc (carrega o WASM)...');
  const api = new WebIFC.IfcAPI();
  await api.Init();

  console.log('▶ Abrindo modelo e extraindo geometria (recentrando na origem)...');
  // COORDINATE_TO_ORIGIN é importante em modelo do Revit: o ponto de levantamento
  // costuma ficar longe da origem, e isso causa tremulação/z-fighting com float32.
  const modelID = api.OpenModel(new Uint8Array(ifcBuffer), {
    COORDINATE_TO_ORIGIN: true,
    USE_FAST_BOOLS: true,
  });

  // Constrói o Document DURANTE o stream — não acumula um array de malhas em
  // paralelo, o que reduz o pico de RAM em modelo grande.
  const doc = new core.Document();
  const buffer = doc.createBuffer();
  const scene  = doc.createScene();
  let nMalhas = 0, nTris = 0, skipped = 0;

  try {
    api.StreamAllMeshes(modelID, (flatMesh) => {
      const geoms = flatMesh.geometries;
      for (let i = 0; i < geoms.size(); i++) {
        const pg = geoms.get(i);
        const geom = api.GetGeometry(modelID, pg.geometryExpressID);
        const vsz = geom.GetVertexDataSize();
        const isz = geom.GetIndexDataSize();
        if (vsz === 0 || isz === 0) { geom.delete(); skipped++; continue; }

        const rawV = api.GetVertexArray(geom.GetVertexData(), vsz); // [px,py,pz,nx,ny,nz]
        const rawI = api.GetIndexArray(geom.GetIndexData(), isz);
        const n = rawV.length / 6;
        const pos = new Float32Array(n * 3);
        const nor = new Float32Array(n * 3);
        for (let k = 0; k < n; k++) {
          const s = k * 6;
          pos[k*3] = rawV[s];   pos[k*3+1] = rawV[s+1]; pos[k*3+2] = rawV[s+2];
          nor[k*3] = rawV[s+3]; nor[k*3+1] = rawV[s+4]; nor[k*3+2] = rawV[s+5];
        }
        const idx = new Uint32Array(rawI.length); idx.set(rawI);

        const c = pg.color;
        const mat = doc.createMaterial()
          .setBaseColorFactor([c.x, c.y, c.z, c.w])
          .setMetallicFactor(0.1).setRoughnessFactor(0.8)
          .setDoubleSided(true)
          .setAlphaMode(c.w < 1 ? 'BLEND' : 'OPAQUE');

        const prim = doc.createPrimitive()
          .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
          .setAttribute('NORMAL',   doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buffer))
          .setIndices(doc.createAccessor().setType('SCALAR').setArray(idx).setBuffer(buffer))
          .setMaterial(mat);

        const node = doc.createNode()
          .setMesh(doc.createMesh().addPrimitive(prim))
          .setMatrix(Array.from(pg.flatTransformation));
        scene.addChild(node);

        nMalhas++; nTris += idx.length / 3;
        geom.delete(); // libera a geometria WASM assim que copiada
        if (nMalhas % 2000 === 0) process.stdout.write(`\r  ${fmtN(nMalhas)} malhas processadas...`);
      }
    });
  } finally {
    api.CloseModel(modelID); // sempre fecha — não vaza memória WASM
  }

  process.stdout.write('\r');
  console.log(`  ${fmtN(nMalhas)} malhas, ${fmtN(nTris)} triângulos extraídos (${skipped} vazias ignoradas)`);
  if (nMalhas === 0) throw new Error('Nenhuma geometria encontrada no IFC.');

  // ── Limpeza lossless: funde material/malha repetidos, solda vértices ──────────
  console.log('▶ Otimizando malha (dedup → flatten → join → weld → prune)...');
  const passos = [fns.dedup(), fns.flatten(), fns.join(), fns.weld(), fns.prune()];

  // ── Simplify opcional (lossy): reduz a CONTAGEM de triângulos ────────────────
  if (SIMPLIFY > 0 && SIMPLIFY < 1) {
    const { MeshoptSimplifier } = await import('meshoptimizer');
    await MeshoptSimplifier.ready;
    passos.push(fns.simplify({ simplifier: MeshoptSimplifier, ratio: SIMPLIFY, error: SIMP_ERROR }));
    console.log(`  simplify LIGADO: alvo ${(SIMPLIFY*100).toFixed(0)}% dos triângulos (erro máx. ${(SIMP_ERROR*100).toFixed(1)}%)`);
  }
  await doc.transform(...passos);

  const trisFinal = doc.getRoot().listAccessors()
    .filter(a => a.getType() === 'SCALAR')
    .reduce((a, x) => a + x.getCount() / 3, 0);
  const drawCalls = doc.getRoot().listMeshes()
    .reduce((a, m) => a + m.listPrimitives().length, 0);

  // ── Compressão de geometria + escrita do GLB ─────────────────────────────────
  console.log(`▶ Comprimindo (${COMPRESSAO}) e gravando GLB...`);
  let io;
  if (COMPRESSAO === 'draco') {
    const draco3d = await import('draco3dgltf');
    io = new core.NodeIO()
      .registerExtensions([ext.KHRDracoMeshCompression])
      .registerDependencies({ 'draco3d.encoder': await draco3d.createEncoderModule() });
    await doc.transform(fns.draco({ method: 'edgebreaker' }));
  } else if (COMPRESSAO === 'meshopt') {
    const { MeshoptEncoder } = await import('meshoptimizer');
    await MeshoptEncoder.ready;
    io = new core.NodeIO()
      .registerExtensions([ext.EXTMeshoptCompression])
      .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
    await doc.transform(
      fns.quantize({ quantizePosition: QUANT_POS, quantizeNormal: 10, quantizeTexcoord: 12 }),
      fns.meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
    );
  } else {
    io = new core.NodeIO();
  }

  const glb = Buffer.from(await io.writeBinary(doc));
  fs.writeFileSync(SAIDA, glb);

  const seg = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n✓ Convertido em ${seg}s`);
  console.log(`  ${path.basename(ENTRADA)} (${fmt(ifcBuffer.length)})  →  ${path.basename(SAIDA)} (${fmt(glb.length)})`);
  console.log(`  Redução de tamanho : ${((1 - glb.length / ifcBuffer.length) * 100).toFixed(0)}%`);
  console.log(`  Triângulos         : ${fmtN(nTris)} → ${fmtN(trisFinal)}`);
  console.log(`  Draw calls         : ${fmtN(drawCalls)}`);

  // ── Publicação automática na nuvem (se VIEWER_URL + ADMIN_PASSWORD) ──────────
  if (PUBLICAR) {
    const nome = PROJ_NOME || path.basename(SAIDA, '.glb');
    console.log(`\n▶ Publicando "${nome}" em ${VIEWER_URL} ...`);
    try {
      const res = await publicarNaNuvem(glb, path.basename(SAIDA), nome, PROJ_DESC);
      const url = res.viewerUrl || (res.slug ? `${VIEWER_URL}/v/${res.slug}` : VIEWER_URL);
      console.log(`✓ No ar: ${url}`);
      console.log(`  (QR Code gerado automaticamente no painel admin)`);
    } catch (e) {
      console.error(`✗ Publicação falhou: ${e.message}`);
      console.error(`  O GLB ficou salvo em ${SAIDA} — dá pra subir manualmente no viewer.`);
      process.exitCode = 2;
    }
  } else {
    console.log(`\n  GLB salvo em ${SAIDA}. Suba pela opção GLB do viewer (carrega Draco direto).`);
    console.log(`  Para publicar sozinho, rode com VIEWER_URL=... ADMIN_PASSWORD=... (ver cabeçalho).`);
  }
})().catch(err => {
  console.error('\n✗ FALHOU:', err.message);
  if (/heap|memory|allocation|bounds|abort/i.test(err.message)) {
    console.error('  → Provável falta de memória num modelo grande. Tente:');
    console.error('    • aumentar o heap: node --max-old-space-size=16384 converter_offline.js ...');
    console.error('    • reduzir triângulos: SIMPLIFY=0.5 node --max-old-space-size=16384 converter_offline.js ...');
  }
  process.exit(1);
});
