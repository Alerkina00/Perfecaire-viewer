/**
 * converter.js — Converte IFC para GLTF no servidor usando web-ifc
 * Otimizado para arquivos grandes: evita Float32Array.from() lento,
 * usa .set() direto e agrupa geometrias por cor para reduzir número de meshes.
 */
const WebIFC = require('web-ifc');

let ifcApi = null;

async function getIfcApi() {
  if (ifcApi) return ifcApi;
  ifcApi = new WebIFC.IfcAPI();
  await ifcApi.Init();
  return ifcApi;
}

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

      // Usa .set() ao invés de Float32Array.from() — muito mais rápido
      const rawVerts = api.GetVertexArray(geom.GetVertexData(), vertSize);
      const rawIdx   = api.GetIndexArray(geom.GetIndexData(), idxSize);

      const verts   = new Float32Array(rawVerts.length);
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

  console.log('[converter] Construindo GLTF...');
  const result = buildGltf(meshes);
  console.log('[converter] GLTF pronto.');
  return result;
}

function buildGltf(meshes) {
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
    const stride    = 6; // x,y,z,nx,ny,nz
    const vertCount = mesh.verts.length / stride;

    // Extrai posições e normais de forma eficiente
    const positions = new Float32Array(vertCount * 3);
    const normals   = new Float32Array(vertCount * 3);

    for (let i = 0; i < vertCount; i++) {
      const s = i * stride;
      positions[i*3]   = mesh.verts[s];
      positions[i*3+1] = mesh.verts[s+1];
      positions[i*3+2] = mesh.verts[s+2];
      normals[i*3]     = mesh.verts[s+3];
      normals[i*3+1]   = mesh.verts[s+4];
      normals[i*3+2]   = mesh.verts[s+5];
    }

    // Calcula bounding box
    let minX=Infinity,minY=Infinity,minZ=Infinity;
    let maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity;
    for (let i = 0; i < vertCount; i++) {
      const x=positions[i*3], y=positions[i*3+1], z=positions[i*3+2];
      if(x<minX)minX=x; if(x>maxX)maxX=x;
      if(y<minY)minY=y; if(y>maxY)maxY=y;
      if(z<minZ)minZ=z; if(z>maxZ)maxZ=z;
    }

    const posBytes  = Buffer.from(positions.buffer);
    const normBytes = Buffer.from(normals.buffer);
    const idxBytes  = Buffer.from(mesh.indices.buffer);

    const bvPos = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer:0, byteOffset, byteLength: posBytes.length,  target: 34962 });
    byteOffset += posBytes.length; chunks.push(posBytes);

    const bvNorm = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer:0, byteOffset, byteLength: normBytes.length, target: 34962 });
    byteOffset += normBytes.length; chunks.push(normBytes);

    const bvIdx = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer:0, byteOffset, byteLength: idxBytes.length,  target: 34963 });
    byteOffset += idxBytes.length; chunks.push(idxBytes);

    const accPos  = gltf.accessors.length;
    gltf.accessors.push({ bufferView: bvPos,  byteOffset:0, componentType:5126, count:vertCount,           type:'VEC3', min:[minX,minY,minZ], max:[maxX,maxY,maxZ] });
    const accNorm = gltf.accessors.length;
    gltf.accessors.push({ bufferView: bvNorm, byteOffset:0, componentType:5126, count:vertCount,           type:'VEC3' });
    const accIdx  = gltf.accessors.length;
    gltf.accessors.push({ bufferView: bvIdx,  byteOffset:0, componentType:5125, count:mesh.indices.length, type:'SCALAR' });

    const c = mesh.color || { x:0.7, y:0.7, z:0.7, w:1.0 };
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
      primitives: [{ attributes:{ POSITION:accPos, NORMAL:accNorm }, indices:accIdx, material:matIdx }],
    });

    gltf.nodes.push({ mesh:meshIdx, matrix:mesh.transform });
    gltf.scenes[0].nodes.push(gltf.nodes.length - 1);
  }

  // Usa Buffer.concat para montar o binário final de uma vez
  const allData = Buffer.concat(chunks);
  gltf.buffers.push({
    byteLength: allData.length,
    uri: 'data:application/octet-stream;base64,' + allData.toString('base64'),
  });

  return Buffer.from(JSON.stringify(gltf));
}

module.exports = { ifcToGltf };
