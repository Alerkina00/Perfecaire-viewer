/**
 * converter.js — Converte IFC para GLTF no servidor usando web-ifc
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
  const modelID = api.OpenModel(new Uint8Array(ifcBuffer));

  const meshes = [];

  api.StreamAllMeshes(modelID, (flatMesh) => {
    const geoms = flatMesh.geometries;
    for (let i = 0; i < geoms.size(); i++) {
      const pg = geoms.get(i);
      const geom = api.GetGeometry(modelID, pg.geometryExpressID);

      const vertPtr  = geom.GetVertexData();
      const vertSize = geom.GetVertexDataSize();
      const idxPtr   = geom.GetIndexData();
      const idxSize  = geom.GetIndexDataSize();

      if (vertSize === 0 || idxSize === 0) { geom.delete(); continue; }

      // Copia os dados antes do delete
      const rawVerts = api.GetVertexArray(vertPtr, vertSize);
      const rawIdx   = api.GetIndexArray(idxPtr, idxSize);

      const verts   = Float32Array.from(rawVerts);
      const indices = Uint32Array.from(rawIdx);

      const color = pg.color;
      const transform = Array.from(pg.flatTransformation);

      geom.delete();

      if (verts.length > 0 && indices.length > 0) {
        meshes.push({ verts, indices, color, transform });
      }
    }
  });

  api.CloseModel(modelID);

  console.log('Total de meshes extraídas:', meshes.length);

  if (meshes.length === 0) {
    throw new Error('Nenhuma geometria encontrada no arquivo IFC');
  }

  return Buffer.from(JSON.stringify(buildGltf(meshes)));
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
    // stride = 6 floats: x,y,z, nx,ny,nz
    const stride = 6;
    const vertCount = mesh.verts.length / stride;
    const positions = new Float32Array(vertCount * 3);
    const normals   = new Float32Array(vertCount * 3);

    for (let i = 0; i < vertCount; i++) {
      positions[i*3]   = mesh.verts[i*stride];
      positions[i*3+1] = mesh.verts[i*stride+1];
      positions[i*3+2] = mesh.verts[i*stride+2];
      normals[i*3]     = mesh.verts[i*stride+3];
      normals[i*3+1]   = mesh.verts[i*stride+4];
      normals[i*3+2]   = mesh.verts[i*stride+5];
    }

    const posMin = [Infinity,Infinity,Infinity];
    const posMax = [-Infinity,-Infinity,-Infinity];
    for (let i = 0; i < vertCount; i++) {
      for (let j = 0; j < 3; j++) {
        if (positions[i*3+j] < posMin[j]) posMin[j] = positions[i*3+j];
        if (positions[i*3+j] > posMax[j]) posMax[j] = positions[i*3+j];
      }
    }

    const posBytes  = Buffer.from(positions.buffer);
    const normBytes = Buffer.from(normals.buffer);
    const idxBytes  = Buffer.from(mesh.indices.buffer);

    const bvPos = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength: posBytes.length,  target: 34962 });
    byteOffset += posBytes.length;
    chunks.push(posBytes);

    const bvNorm = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength: normBytes.length, target: 34962 });
    byteOffset += normBytes.length;
    chunks.push(normBytes);

    const bvIdx = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength: idxBytes.length,  target: 34963 });
    byteOffset += idxBytes.length;
    chunks.push(idxBytes);

    const accPos  = gltf.accessors.length;
    gltf.accessors.push({ bufferView: bvPos,  byteOffset: 0, componentType: 5126, count: vertCount,          type: 'VEC3', min: posMin, max: posMax });
    const accNorm = gltf.accessors.length;
    gltf.accessors.push({ bufferView: bvNorm, byteOffset: 0, componentType: 5126, count: vertCount,          type: 'VEC3' });
    const accIdx  = gltf.accessors.length;
    gltf.accessors.push({ bufferView: bvIdx,  byteOffset: 0, componentType: 5125, count: mesh.indices.length, type: 'SCALAR' });

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
      primitives: [{ attributes: { POSITION: accPos, NORMAL: accNorm }, indices: accIdx, material: matIdx }],
    });

    const nodeIdx = gltf.nodes.length;
    gltf.nodes.push({ mesh: meshIdx, matrix: mesh.transform });
    gltf.scenes[0].nodes.push(nodeIdx);
  }

  const allData = Buffer.concat(chunks);
  gltf.buffers.push({
    byteLength: allData.length,
    uri: 'data:application/octet-stream;base64,' + allData.toString('base64'),
  });

  return gltf;
}

module.exports = { ifcToGltf };
