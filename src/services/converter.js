// src/services/converter.js - Versão atualizada
const WebIFC = require('web-ifc');
const { parse: parseGltf, encode: encodeGltf } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');

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
      const idxSize = geom.GetIndexDataSize();

      if (vertSize === 0 || idxSize === 0) {
        geom.delete();
        skipped++;
        continue;
      }

      const rawVerts = api.GetVertexArray(geom.GetVertexData(), vertSize);
      const rawIdx = api.GetIndexArray(geom.GetIndexData(), idxSize);

      const verts = new Float32Array(rawVerts.length);
      verts.set(rawVerts);
      const indices = new Uint32Array(rawIdx.length);
      indices.set(rawIdx);

      const color = {
        x: pg.color.x,
        y: pg.color.y,
        z: pg.color.z,
        w: pg.color.w,
      };
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
 * Constrói GLTF a partir de meshes extraídas do IFC
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
    const stride = 6;
    const vertCount = mesh.verts.length / stride;

    const positions = new Float32Array(vertCount * 3);
    const normals = new Float32Array(vertCount * 3);

    for (let i = 0; i < vertCount; i++) {
      const s = i * stride;
      positions[i * 3] = mesh.verts[s];
      positions[i * 3 + 1] = mesh.verts[s + 1];
      positions[i * 3 + 2] = mesh.verts[s + 2];
      normals[i * 3] = mesh.verts[s + 3];
      normals[i * 3 + 1] = mesh.verts[s + 4];
      normals[i * 3 + 2] = mesh.verts[s + 5];
    }

    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < vertCount; i++) {
      const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }

    const posBytes = Buffer.from(positions.buffer);
    const normBytes = Buffer.from(normals.buffer);
    const idxBytes = Buffer.from(mesh.indices.buffer);

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
      bufferView: bvPos,
      byteOffset: 0,
      componentType: 5126,
      count: vertCount,
      type: 'VEC3',
      min: [minX, minY, minZ],
      max: [maxX, maxY, maxZ]
    });
    const accNorm = gltf.accessors.length;
    gltf.accessors.push({
      bufferView: bvNorm,
      byteOffset: 0,
      componentType: 5126,
      count: vertCount,
      type: 'VEC3'
    });
    const accIdx = gltf.accessors.length;
    gltf.accessors.push({
      bufferView: bvIdx,
      byteOffset: 0,
      componentType: 5125,
      count: mesh.indices.length,
      type: 'SCALAR'
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
        material: matIdx
      }],
    });

    gltf.nodes.push({ mesh: meshIdx, matrix: mesh.transform });
    gltf.scenes[0].nodes.push(gltf.nodes.length - 1);
  }

  const allData = Buffer.concat(chunks);
  gltf.buffers.push({
    byteLength: allData.length,
    uri: 'data:application/octet-stream;base64,' + allData.toString('base64'),
  });

  return Buffer.from(JSON.stringify(gltf));
}

/**
 * Converte GLTF + BIN externo para GLB autocontido
 * Usa @gltf-transform para juntar tudo em um único arquivo
 */
async function gltfBinToGlb(gltfBuffer, binBuffer, textureBuffers = {}) {
  try {
    // Importa o gltf-transform dinamicamente (es module)
    const { NodeIO } = await import('@gltf-transform/core');
    const { ALL_EXTENSIONS } = await import('@gltf-transform/extensions');

    // Cria um IO para ler o GLTF
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS);

    // Faz o parse do GLTF
    const document = await io.readBinary(gltfBuffer);

    // Atualiza os buffers do documento com os dados reais
    // O documento pode ter referências externas, precisamos injetar os dados
    const root = document.getRoot();
    const buffers = root.listBuffers();

    // Se já tem buffer embutido, usa ele
    if (buffers.length > 0) {
      const existingBuffer = buffers[0];
      // Se o buffer estiver vazio ou for referência externa, atualiza com os dados do .bin
      if (existingBuffer.getByteLength() === 0 && binBuffer) {
        existingBuffer.setByteLength(binBuffer.length);
        const uri = existingBuffer.getURI();
        if (uri && !uri.startsWith('data:')) {
          // Substitui o buffer externo pelo dado real
          // O NodeIO não permite setar o conteúdo diretamente, então recriamos
          // Solução alternativa: criar um novo documento com os dados inline
          return await gltfToGlbInline(gltfBuffer, binBuffer, textureBuffers);
        }
      }
    } else if (binBuffer) {
      // Sem buffer definido, cria um novo
      const buffer = document.createBuffer(binBuffer);
      buffer.setByteLength(binBuffer.length);
      // Atualiza todas as bufferViews para apontar para o novo buffer
      const bufferViews = root.listBufferViews();
      for (const bv of bufferViews) {
        bv.setBuffer(buffer);
      }
    }

    // Converte para GLB
    const glbBuffer = await io.writeBinary(document);
    return glbBuffer;
  } catch (err) {
    console.error('[converter] Erro no gltf-transform:', err.message);
    // Fallback: tenta o método manual
    return await gltfToGlbManual(gltfBuffer, binBuffer);
  }
}

/**
 * Método manual para converter GLTF+BIN em GLB
 * (fallback quando @gltf-transform falha)
 */
async function gltfToGlbManual(gltfBuffer, binBuffer) {
  const json = JSON.parse(gltfBuffer.toString('utf8'));

  // Verifica se tem buffer externo
  if (json.buffers && json.buffers.length > 0) {
    const buffer = json.buffers[0];
    if (buffer.uri && !buffer.uri.startsWith('data:')) {
      // Substitui a referência externa por dados embutidos
      buffer.uri = 'data:application/octet-stream;base64,' + binBuffer.toString('base64');
    }
  } else if (binBuffer) {
    // Adiciona buffer se não existir
    json.buffers = [{
      byteLength: binBuffer.length,
      uri: 'data:application/octet-stream;base64,' + binBuffer.toString('base64')
    }];
  }

  // Converte para GLB: JSON + binário
  const jsonStr = JSON.stringify(json);
  const jsonBuffer = Buffer.from(jsonStr);

  // Formato GLB: cabeçalho + JSON chunk + Binary chunk
  // https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html#binary-file-format
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0); // magic 'glTF'
  header.writeUInt32LE(2, 4); // version
  header.writeUInt32LE(header.length + jsonBuffer.length + 8 + (binBuffer ? binBuffer.length + 8 : 0), 8); // total length

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBuffer.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4E4F534A, 4); // 'JSON'

  let result = Buffer.concat([header, jsonChunkHeader, jsonBuffer]);

  if (binBuffer) {
    const binChunkHeader = Buffer.alloc(8);
    binChunkHeader.writeUInt32LE(binBuffer.length, 0);
    binChunkHeader.writeUInt32LE(0x004E4942, 4); // 'BIN\x00'
    result = Buffer.concat([result, binChunkHeader, binBuffer]);
  }

  return result;
}

/**
 * Converte GLTF para GLB inline (alternativa)
 */
async function gltfToGlbInline(gltfBuffer, binBuffer, textureBuffers) {
  const json = JSON.parse(gltfBuffer.toString('utf8'));

  // Substitui buffers externos por data URIs
  if (json.buffers) {
    for (const buffer of json.buffers) {
      if (buffer.uri && !buffer.uri.startsWith('data:')) {
        const fileName = buffer.uri;
        if (fileName.endsWith('.bin') && binBuffer) {
          buffer.uri = 'data:application/octet-stream;base64,' + binBuffer.toString('base64');
        } else if (textureBuffers[fileName]) {
          const ext = fileName.split('.').pop().toLowerCase();
          const mimeType = ext === 'png' ? 'image/png' :
                          ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
                          ext === 'webp' ? 'image/webp' : 'image/' + ext;
          buffer.uri = 'data:' + mimeType + ';base64,' + textureBuffers[fileName].toString('base64');
        }
      }
    }
  }

  // Atualiza imagens para data URIs
  if (json.images) {
    for (const img of json.images) {
      if (img.uri && !img.uri.startsWith('data:')) {
        const fileName = img.uri;
        if (textureBuffers[fileName]) {
          const ext = fileName.split('.').pop().toLowerCase();
          const mimeType = ext === 'png' ? 'image/png' :
                          ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
                          ext === 'webp' ? 'image/webp' : 'image/' + ext;
          img.uri = 'data:' + mimeType + ';base64,' + textureBuffers[fileName].toString('base64');
        }
      }
    }
  }

  // Agora constrói o GLB
  const jsonStr = JSON.stringify(json);
  const jsonBuffer = Buffer.from(jsonStr);

  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546C67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(header.length + jsonBuffer.length + 8, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonBuffer.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4E4F534A, 4);

  return Buffer.concat([header, jsonChunkHeader, jsonBuffer]);
}

module.exports = { ifcToGltf, gltfBinToGlb };
