/**
 * converter.js — Converte IFC para GLTF no servidor (Node.js)
 * Roda durante o upload, salva o GLTF em vez do arquivo original.
 */

const WebIFC = require('web-ifc');

let ifcApi = null;

async function getIfcApi() {
  if (ifcApi) return ifcApi;
  ifcApi = new WebIFC.IfcAPI();
  await ifcApi.Init();
  return ifcApi;
}

/**
 * Converte buffer IFC para GLTF (retorna Buffer)
 */
async function ifcToGltf(ifcBuffer) {
  const api = await getIfcApi();

  const modelID = api.OpenModel(new Uint8Array(ifcBuffer));

  // Coleta todas as geometrias
  const meshes = [];
  api.StreamAllMeshes(modelID, (mesh) => {
    const placedGeometries = mesh.geometries;
    for (let i = 0; i < placedGeometries.size(); i++) {
      const placedGeom = placedGeometries.get(i);
      const geom = api.GetGeometry(modelID, placedGeom.geometryExpressID);
      const verts = api.GetRawLineData ? null : api.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
      const indices = api.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
      const transform = placedGeom.flatTransformation;
      const color = placedGeom.color;

      if (verts && verts.length > 0) {
        meshes.push({ verts, indices, transform, color });
      }
      geom.delete();
    }
  });

  api.CloseModel(modelID);

  // Monta GLTF mínimo válido com as geometrias
  const gltf = buildGltf(meshes);
  return Buffer.from(JSON.stringify(gltf));
}

function buildGltf(meshes) {
  // GLTF mínimo funcional
  const gltf = {
    asset: { version: '2.0', generator: 'PerfecAire IFC Converter' },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
    materials: [],
  };

  const bufferData = [];
  let byteOffset = 0;

  meshes.forEach((mesh, idx) => {
    if (!mesh.verts || mesh.verts.length === 0) return;

    // Extrai posições (stride de 6 floats: x,y,z,nx,ny,nz)
    const stride = 6;
    const posCount = mesh.verts.length / stride;
    const positions = new Float32Array(posCount * 3);
    const normals = new Float32Array(posCount * 3);

    for (let i = 0; i < posCount; i++) {
      positions[i * 3]     = mesh.verts[i * stride];
      positions[i * 3 + 1] = mesh.verts[i * stride + 1];
      positions[i * 3 + 2] = mesh.verts[i * stride + 2];
      normals[i * 3]       = mesh.verts[i * stride + 3];
      normals[i * 3 + 1]   = mesh.verts[i * stride + 4];
      normals[i * 3 + 2]   = mesh.verts[i * stride + 5];
    }

    const indices = new Uint32Array(mesh.indices);

    // Adiciona material
    const matIdx = gltf.materials.length;
    gltf.materials.push({
      pbrMetallicRoughness: {
        baseColorFactor: [
          mesh.color ? mesh.color.x : 0.7,
          mesh.color ? mesh.color.y : 0.7,
          mesh.color ? mesh.color.z : 0.7,
          mesh.color ? mesh.color.w : 1.0,
        ],
        metallicFactor: 0.1,
        roughnessFactor: 0.8,
      },
      doubleSided: true,
    });

    // BufferViews e accessors
    const posBytes  = Buffer.from(positions.buffer);
    const normBytes = Buffer.from(normals.buffer);
    const idxBytes  = Buffer.from(indices.buffer);

    const bvPos  = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength: posBytes.length, target: 34962 });
    byteOffset += posBytes.length;
    bufferData.push(posBytes);

    const bvNorm = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength: normBytes.length, target: 34962 });
    byteOffset += normBytes.length;
    bufferData.push(normBytes);

    const bvIdx  = gltf.bufferViews.length;
    gltf.bufferViews.push({ buffer: 0, byteOffset, byteLength: idxBytes.length, target: 34963 });
    byteOffset += idxBytes.length;
    bufferData.push(idxBytes);

    // Calcula min/max das posições
    let minPos = [Infinity, Infinity, Infinity];
    let maxPos = [-Infinity, -Infinity, -Infinity];
    for (let i = 0; i < posCount; i++) {
      for (let j = 0; j < 3; j++) {
        if (positions[i*3+j] < minPos[j]) minPos[j] = positions[i*3+j];
        if (positions[i*3+j] > maxPos[j]) maxPos[j] = positions[i*3+j];
      }
    }

    const accPos  = gltf.accessors.length;
    gltf.accessors.push({ bufferView: bvPos,  byteOffset: 0, componentType: 5126, count: posCount,           type: 'VEC3', min: minPos, max: maxPos });
    const accNorm = gltf.accessors.length;
    gltf.accessors.push({ bufferView: bvNorm, byteOffset: 0, componentType: 5126, count: posCount,           type: 'VEC3' });
    const accIdx  = gltf.accessors.length;
    gltf.accessors.push({ bufferView: bvIdx,  byteOffset: 0, componentType: 5125, count: indices.length,     type: 'SCALAR' });

    const meshIdx = gltf.meshes.length;
    gltf.meshes.push({
      primitives: [{
        attributes: { POSITION: accPos, NORMAL: accNorm },
        indices: accIdx,
        material: matIdx,
      }],
    });

    const nodeIdx = gltf.nodes.length;
    gltf.nodes.push({
      mesh: meshIdx,
      matrix: Array.from(mesh.transform),
    });
    gltf.scenes[0].nodes.push(nodeIdx);
  });

  // Buffer único em base64
  const allData = Buffer.concat(bufferData);
  gltf.buffers.push({
    byteLength: allData.length,
    uri: 'data:application/octet-stream;base64,' + allData.toString('base64'),
  });

  return gltf;
}

module.exports = { ifcToGltf };
