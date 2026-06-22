// src/services/converter.js
// ─────────────────────────────────────────────────────────────────────────────
// Converte IFC e GLTF+BIN em GLB binário COMPRIMIDO, pronto para visualização.
//
// O que mudou em relação à versão anterior:
//   • A saída é sempre GLB binário (chunk BIN nativo) — acabou o JSON + base64,
//     que inchava o arquivo em ~33% e deixava o parse lento.
//   • Aplica um pipeline gltf-transform que descarta o que não é geometria visual
//     (o "I" do BIM), funde materiais/malhas repetidos (menos draw calls) e
//     comprime a geometria com Draco (padrão) ou Meshopt.
//
// Carregamento sob demanda (dynamic import / require lazy) porque:
//   • @gltf-transform/* é ESM puro e este projeto é CommonJS;
//   • o WASM do web-ifc é pesado e só deve subir quando há IFC de fato.
// Com isso o módulo carrega instantâneo no boot do servidor.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const path = require('path');

// ── Configuração ─────────────────────────────────────────────────────────────
// 'draco'   → menor arquivo no fio. O viewer JÁ tem DRACOLoader pronto: zero
//             mudança no cliente. Decodificação tem leve latência (não afeta FPS).
// 'meshopt' → arquivo um pouco maior, mas decodifica quase instantâneo no celular.
//             EXIGE registrar o MeshoptDecoder no viewer.html (1 linha — ver README).
// 'none'    → sem compressão, mas ainda GLB binário limpo (já resolve o base64).
const COMPRESSAO = process.env.GLB_COMPRESSION || 'draco';

// Bits de quantização (usado no modo meshopt). 14 bits de posição ≈ erro
// sub-milimétrico em modelo de obra: visualmente imperceptível. Caia para 12 se
// quiser ainda menor. (No Draco a quantização é interna ao encoder.)
const QUANT = { quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8 };

// ── Caches lazy ──────────────────────────────────────────────────────────────
let _gltf = null;   // módulos do gltf-transform
let _ifcApi = null; // instância web-ifc

async function loadGltfTransform() {
  if (_gltf) return _gltf;
  const [core, ext, fns] = await Promise.all([
    import('@gltf-transform/core'),
    import('@gltf-transform/extensions'),
    import('@gltf-transform/functions'),
  ]);
  _gltf = { core, ext, fns };
  return _gltf;
}

async function getIfcApi() {
  if (_ifcApi) return _ifcApi;
  const WebIFC = require('web-ifc'); // lazy: só carrega o WASM quando há IFC
  _ifcApi = new WebIFC.IfcAPI();
  await _ifcApi.Init();
  return _ifcApi;
}

// ── Util ─────────────────────────────────────────────────────────────────────
function fmt(b) {
  if (b > 1048576) return (b / 1048576).toFixed(1) + ' MB';
  if (b > 1024)    return (b / 1024).toFixed(0) + ' KB';
  return b + ' B';
}

// ── IFC → malhas (web-ifc) ───────────────────────────────────────────────────
async function extrairMeshesDoIfc(ifcBuffer) {
  const api = await getIfcApi();
  const modelID = api.OpenModel(new Uint8Array(ifcBuffer), {
    COORDINATE_TO_ORIGIN: true,
    USE_FAST_BOOLS: true,
  });

  const meshes = [];
  let skipped = 0;
  try {
    api.StreamAllMeshes(modelID, (flatMesh) => {
      const geoms = flatMesh.geometries;
      for (let i = 0; i < geoms.size(); i++) {
        const pg = geoms.get(i);
        const geom = api.GetGeometry(modelID, pg.geometryExpressID);
        const vertSize = geom.GetVertexDataSize();
        const idxSize  = geom.GetIndexDataSize();
        if (vertSize === 0 || idxSize === 0) { geom.delete(); skipped++; continue; }

        const rawVerts = api.GetVertexArray(geom.GetVertexData(), vertSize);
        const rawIdx   = api.GetIndexArray(geom.GetIndexData(), idxSize);
        const verts = new Float32Array(rawVerts.length); verts.set(rawVerts);
        const indices = new Uint32Array(rawIdx.length);   indices.set(rawIdx);
        const color = { x: pg.color.x, y: pg.color.y, z: pg.color.z, w: pg.color.w };
        const transform = Array.from(pg.flatTransformation);
        geom.delete();
        meshes.push({ verts, indices, color, transform });
      }
    });
  } finally {
    api.CloseModel(modelID); // sempre fecha — não vaza memória WASM nem em erro
  }

  console.log(`[converter] IFC: ${meshes.length} malhas extraídas, ${skipped} vazias ignoradas`);
  if (meshes.length === 0) throw new Error('Nenhuma geometria encontrada no arquivo IFC');
  return meshes;
}

// ── Malhas → Document gltf-transform ─────────────────────────────────────────
// web-ifc entrega vértices intercalados [px,py,pz,nx,ny,nz] (stride 6).
async function documentDeMeshes(meshes) {
  const { core } = await loadGltfTransform();
  const doc = new core.Document();
  const buffer = doc.createBuffer();
  const scene = doc.createScene();

  for (const m of meshes) {
    const stride = 6;
    const n = m.verts.length / stride;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const s = i * stride;
      pos[i*3] = m.verts[s];   pos[i*3+1] = m.verts[s+1]; pos[i*3+2] = m.verts[s+2];
      nor[i*3] = m.verts[s+3]; nor[i*3+1] = m.verts[s+4]; nor[i*3+2] = m.verts[s+5];
    }

    const aPos = doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer);
    const aNor = doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buffer);
    const aIdx = doc.createAccessor().setType('SCALAR').setArray(m.indices).setBuffer(buffer);

    const c = m.color || { x: 0.7, y: 0.7, z: 0.7, w: 1.0 };
    const mat = doc.createMaterial()
      .setBaseColorFactor([c.x, c.y, c.z, c.w])
      .setMetallicFactor(0.1).setRoughnessFactor(0.8)
      .setDoubleSided(true)
      .setAlphaMode(c.w < 1 ? 'BLEND' : 'OPAQUE');

    const prim = doc.createPrimitive()
      .setAttribute('POSITION', aPos)
      .setAttribute('NORMAL', aNor)
      .setIndices(aIdx)
      .setMaterial(mat);

    const mesh = doc.createMesh().addPrimitive(prim);
    const node = doc.createNode().setMesh(mesh).setMatrix(m.transform);
    scene.addChild(node);
  }
  return doc;
}

// ── Document → GLB comprimido (pipeline compartilhado) ───────────────────────
async function otimizarParaGlb(doc) {
  const { core, ext, fns } = await loadGltfTransform();

  // 1) Limpeza lossless — sempre aplicada, uma única vez.
  //    dedup  : funde materiais/acessores idênticos (IFC repete muito)
  //    flatten: achata a hierarquia de nós (prepara o join)
  //    join   : funde malhas de mesmo material → MENOS draw calls (ganho real no IFC)
  //    weld   : solda vértices coincidentes
  //    prune  : remove o que ficou sem referência
  await doc.transform(fns.dedup(), fns.flatten(), fns.join(), fns.weld(), fns.prune());

  // 2) Compressão — degrada com elegância: se o encoder não estiver instalado,
  //    ainda entrega GLB binário limpo (que já é melhor que o base64 antigo).
  try {
    if (COMPRESSAO === 'draco') {
      const draco3d = await import('draco3dgltf');
      const io = new core.NodeIO()
        .registerExtensions([ext.KHRDracoMeshCompression])
        .registerDependencies({ 'draco3d.encoder': await draco3d.createEncoderModule() });
      await doc.transform(fns.draco({ method: 'edgebreaker' }));
      const out = Buffer.from(await io.writeBinary(doc));
      console.log(`[converter] GLB draco gerado: ${fmt(out.length)}`);
      return out;
    }

    if (COMPRESSAO === 'meshopt') {
      const { MeshoptEncoder } = await import('meshoptimizer');
      await MeshoptEncoder.ready;
      const io = new core.NodeIO()
        .registerExtensions([ext.EXTMeshoptCompression])
        .registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
      await doc.transform(
        fns.quantize(QUANT),
        fns.meshopt({ encoder: MeshoptEncoder, level: 'medium' }),
      );
      const out = Buffer.from(await io.writeBinary(doc));
      console.log(`[converter] GLB meshopt gerado: ${fmt(out.length)}`);
      return out;
    }

    const out = Buffer.from(await new core.NodeIO().writeBinary(doc));
    console.log(`[converter] GLB sem compressão gerado: ${fmt(out.length)}`);
    return out;
  } catch (err) {
    console.warn(`[converter] Compressão "${COMPRESSAO}" indisponível (${err.message}); entregando GLB sem compressão.`);
    return Buffer.from(await new core.NodeIO().writeBinary(doc));
  }
}

// ── API pública ──────────────────────────────────────────────────────────────

/** IFC → GLB binário comprimido. */
async function ifcToGlb(ifcBuffer) {
  const meshes = await extrairMeshesDoIfc(ifcBuffer);
  const doc = await documentDeMeshes(meshes);
  return otimizarParaGlb(doc);
}

/**
 * GLTF + BIN externo (+ texturas) → GLB binário comprimido.
 * binBuffer e texturas chegam como Buffers do upload, mapeados como recursos
 * do glTF antes da leitura. path.basename casa nomes de textura com segurança.
 */
async function gltfBinToGlb(gltfBuffer, binBuffer, textureBuffers = {}) {
  const { core } = await loadGltfTransform();
  const json = JSON.parse(gltfBuffer.toString('utf8'));

  const resources = {};
  for (const buf of (json.buffers || [])) {
    if (buf.uri && !buf.uri.startsWith('data:') && binBuffer) {
      resources[buf.uri] = new Uint8Array(binBuffer);
    }
  }
  for (const img of (json.images || [])) {
    if (img.uri && !img.uri.startsWith('data:')) {
      const fname = path.basename(img.uri);
      const tex = textureBuffers[fname] || textureBuffers[img.uri];
      if (tex) resources[img.uri] = new Uint8Array(tex);
    }
  }

  // Leitura sem extensões registradas atende o caso comum (glTF+BIN não comprimido,
  // exportado por Revit/Navisworks/Blender). Se o glTF de entrada já usar uma
  // extensão desconhecida, o erro sobe e o projects.js cai no fallback de salvar
  // os arquivos separados.
  const doc = await new core.NodeIO().readJSON({ json, resources });
  return otimizarParaGlb(doc);
}

module.exports = { ifcToGlb, gltfBinToGlb };
