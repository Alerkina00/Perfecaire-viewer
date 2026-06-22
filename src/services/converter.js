// src/services/converter.js
// NOTA: @gltf-transform é ESM puro — não usar require() no topo.
// A conversão GLTF+BIN→GLB usa método manual (sem dependência ESM).

const WebIFC = require('web-ifc');

let ifcApi = null;

async function getIfcApi() {
  if (ifcApi) return ifcApi;
  ifcApi = new WebIFC.IfcAPI();
  await ifcApi.Init();
  return ifcApi;
}

/**
 * Converte IFC para GLTF usando web-ifc
 */
async function ifcToGltf(ifcBuffer) {
  const api = await getIfcApi();
  console.log('[converter] Abrindo modelo IFC...');

  const modelID = api.OpenModel(new Uint8Array(ifcBuffer), {
    COORDINATE_TO_ORIGIN: true,
    USE_FAST_BOOLS: true,
  });

  const meshes = [];
  let skipped = 0;

  api.StreamAllMeshes(modelID, (flatMesh) => {
    const geoms = flatMesh.geometries;
    for (let i = 0; i < geoms.size(); i++) {
      const pg = geoms.get(i);
      const geom = api.GetGeometry(modelID, pg.geometryExpressID);

      const vertSize = geom.GetVertexDataSize();
      const idxSize  = geom.GetIndexDataSize();

      if (vertSize === 0 || idxSize === 0) {
        geom.delete();
        skipped++;
        continue;
      }

      const rawVerts   = api.GetVertexArray(geom.GetVertexData(), vertSize);
      const rawIdx     = api.GetIndexArray(geom.GetIndexData(), idxSize);

      const verts   = new Float32Array(rawVerts.length);
      verts.set(rawVerts);
      const indices = new Uint32Array(rawIdx.length);
      indices.set(rawIdx);

      const color = { x: pg.color.x, y: pg.color.y, z: pg.color.z, w: pg.color.w };
      const transform = Array.from(pg.flatTransformation);

      geom.delete();
      meshes.push({ verts, indices, color, transform });
    }
  });

  api.CloseModel(modelID);
  console.log(`[converter] Meshes extraídas: ${meshes.length}, ignoradas: ${skipped}`);

  if (meshes.length === 0) {
    throw new Error('Nenhuma geometria encontrada no arquivo IFC');
  }

  return buildGltfFromMeshes(meshes);
}

/**
 * Constrói GLTF a partir de meshes extraídas do IFC.
 * Retorna Buffer JSON com dados embutidos em data URI (sem arquivo .bin externo).
 */
function buildGltfFromMeshes(meshes) {
  const gltf = {
    asset: { version: '2.0', generator: 'PerfecAire Converter' },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
    materials: [],
  };

  const chunks = [];
  let byteOffset = 0;

  for (const mesh of meshes) {
    const stride    = 6;
    const vertCount = mesh.verts.length / stride;

    const positions = new Float32Array(vertCount * 3);
    const normals   = new Float32Array(vertCount * 3);

    for (let i = 0; i < vertCount; i++) {
      const s = i * stride;
      positions[i * 3]     = mesh.verts[s];
      positions[i * 3 + 1] = mesh.verts[s + 1];
      positions[i * 3 + 2] = mesh.verts[s + 2];
      normals[i * 3]       = mesh.verts[s + 3];
      normals[i * 3 + 1]   = mesh.verts[s + 4];
      normals[i * 3 + 2]   = mesh.verts[s + 5];
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < vertCount; i++) {
      const x = positions[i*3], y = positions[i*3+1], z = positions[i*3+2];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }

    const posBytes  = Buffer.from(positions.buffer);
    const normBytes = Buffer.from(normals.buffer);
    const idxBytes  = Buffer.from(mesh.indices.buffer);

    const bvPos = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength: posBytes.length, target: 34962 });
    byteOffset += posBytes.length;
    chunks.push(posBytes);

    const bvNorm = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength: normBytes.length, target: 34962 });
    byteOffset += normBytes.length;
    chunks.push(normBytes);

    const bvIdx = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength: idxBytes.length, target: 34963 });
    byteOffset += idxBytes.length;
    chunks.push(idxBytes);

    const accPos = gltf.accessors.length;
    gltf.accessors.push({
      bufferView: bvPos, byteOffset: 0, componentType: 5126,
      count: vertCount, type: 'VEC3', min: [minX,minY,minZ], max: [maxX,maxY,maxZ],
    });
    const accNorm = gltf.accessors.length;
    gltf.accessors.push({
      bufferView: bvNorm, byteOffset: 0, componentType: 5126,
      count: vertCount, type: 'VEC3',
    });
    const accIdx = gltf.accessors.length;
    gltf.accessors.push({
      bufferView: bvIdx, byteOffset: 0, componentType: 5125,
      count: mesh.indices.length, type: 'SCALAR',
    });

    const c = mesh.color || { x: 0.7, y: 0.7, z: 0.7, w: 1.0 };
    const matIdx = gltf.materials.length;
    gltf.materials.push({
      pbrMetallicRoughness: {
        baseColorFactor: [c.x, c.y, c.z, c.w],
        metallicFactor: 0.1,
        roughnessFactor: 0.8,
      },
      doubleSided: true,
      alphaMode: c.w < 1 ? 'BLEND' : 'OPAQUE',
    });

    const meshIdx = gltf.meshes.length;
    gltf.meshes.push({
      primitives: [{
        attributes: { POSITION: accPos, NORMAL: accNorm },
        indices: accIdx,
        material: matIdx,
      }],
    });

    gltf.nodes.push({ mesh: meshIdx, matrix: mesh.transform });
    gltf.scenes[0].nodes.push(gltf.nodes.length - 1);
  }

  const allData = Buffer.concat(chunks);
  // Dados embutidos: sem arquivo .bin externo, zero problemas no proxy
  gltf.buffers.push({
    byteLength: allData.length,
    uri: 'data:application/octet-stream;base64,' + allData.toString('base64'),
  });

  return Buffer.from(JSON.stringify(gltf));
}

/**
 * Converte GLTF + BIN externo para GLB autocontido (método manual, sem ESM).
 * Suporta também texturas externas via textureBuffers map.
 */
async function gltfBinToGlb(gltfBuffer, binBuffer, textureBuffers = {}) {
  console.log('[converter] Convertendo GLTF+BIN → GLB (método manual)...');
  const json = JSON.parse(gltfBuffer.toString('utf8'));

  // Substitui buffers externos (.bin) por data URI
  if (json.buffers) {
    for (const buffer of json.buffers) {
      if (buffer.uri && !buffer.uri.startsWith('data:')) {
        const fname = path.basename(buffer.uri);
        if (fname.toLowerCase().endsWith('.bin') && binBuffer) {
          buffer.uri = 'data:application/octet-stream;base64,' + binBuffer.toString('base64');
          console.log(`[converter] Buffer substituído: ${fname}`);
        }
      }
    }
  }

  // Substitui imagens externas por data URI
  if (json.images) {
    for (const img of json.images) {
      if (img.uri && !img.uri.startsWith('data:')) {
        const fname = path.basename(img.uri);
        const texBuf = textureBuffers[fname] || textureBuffers[img.uri];
        if (texBuf) {
          const ext = fname.split('.').pop().toLowerCase();
          const mimeType = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }[ext] || 'image/' + ext;
          img.uri = `data:${mimeType};base64,` + texBuf.toString('base64');
          console.log(`[converter] Textura embutida: ${fname}`);
        }
      }
    }
  }

  // Serializa JSON (alinhado a 4 bytes como exige o spec GLB)
  const jsonStr    = JSON.stringify(json);
  const jsonPad    = (4 - (jsonStr.length % 4)) % 4;
  const jsonBytes  = Buffer.from(jsonStr + ' '.repeat(jsonPad));

  // Chunk BIN (opcional — já embutimos via data URI, mas pode ter bin nativo)
  // Se todo o binário já foi embutido, o GLB não precisa do chunk BIN.
  const totalLen = 12 + 8 + jsonBytes.length;

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0); // 'glTF'
  header.writeUInt32LE(2, 4);           // version
  header.writeUInt32LE(totalLen, 8);    // total length

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBytes.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4E4F534A, 4); // 'JSON'

  return Buffer.concat([header, jsonChunkHeader, jsonBytes]);
}

// path é necessário para path.basename em gltfBinToGlb
const path = require('path');

module.exports = { ifcToGltf, gltfBinToGlb };
