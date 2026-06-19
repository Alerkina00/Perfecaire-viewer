import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { IFCLoader } from 'web-ifc-three/IFCLoader';

// ─── Cena ────────────────────────────────────────────────────────────────────

const canvas = document.getElementById('viewer-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);
scene.fog = new THREE.Fog(0x1a1a2e, 50, 200);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.01, 1000);
camera.position.set(10, 10, 10);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.screenSpacePanning = true;
controls.minDistance = 0.5;
controls.maxDistance = 500;

// ─── Iluminação ──────────────────────────────────────────────────────────────

const ambient = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambient);

const sun = new THREE.DirectionalLight(0xffeedd, 1.2);
sun.position.set(20, 40, 20);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 0.5;
sun.shadow.camera.far = 200;
sun.shadow.camera.left = -50;
sun.shadow.camera.right = 50;
sun.shadow.camera.top = 50;
sun.shadow.camera.bottom = -50;
scene.add(sun);

const fill = new THREE.DirectionalLight(0xaaccff, 0.4);
fill.position.set(-20, 10, -20);
scene.add(fill);

// Grade de referência
const grid = new THREE.GridHelper(100, 50, 0x444466, 0x333355);
grid.material.opacity = 0.4;
grid.material.transparent = true;
scene.add(grid);

// ─── Loaders ─────────────────────────────────────────────────────────────────

let ifcLoader = null;

function getIFCLoader() {
  if (!ifcLoader) {
    ifcLoader = new IFCLoader();
  ifcLoader.ifcManager.setWasmPath('/');
    ifcLoader.ifcManager.useWebWorkers(false);
  }
  return ifcLoader;
}

async function loadModel(url, fileType) {
  setStatus('Carregando modelo…');

  // Remove modelo anterior
  const prev = scene.getObjectByName('__model__');
  if (prev) scene.remove(prev);

  let model;

  try {
    switch (fileType) {
      case 'ifc':
        model = await loadIFC(url);
        break;
      case 'gltf':
      case 'glb':
        model = await loadGLTF(url);
        break;
      case 'obj':
        model = await loadOBJ(url);
        break;
      case 'fbx':
        model = await loadFBX(url);
        break;
      default:
        throw new Error(`Formato não suportado: ${fileType}`);
    }

    model.name = '__model__';
    scene.add(model);
    fitCamera(model);
    setStatus('');
    showInfo(`✓ ${fileType.toUpperCase()} carregado`);

  } catch (err) {
    console.error('Erro ao carregar modelo:', err);
    setStatus(`Erro: ${err.message}`, true);
  }
}

function loadIFC(url) {
  return new Promise((resolve, reject) => {
    getIFCLoader().load(
      url,
      (model) => resolve(model),
      (e) => setStatus(`Carregando IFC… ${Math.round(e.loaded / e.total * 100)}%`),
      reject
    );
  });
}

function loadGLTF(url) {
  return new Promise((resolve, reject) => {
    new GLTFLoader().load(
      url,
      (gltf) => resolve(gltf.scene),
      (e) => e.total && setStatus(`Carregando… ${Math.round(e.loaded / e.total * 100)}%`),
      reject
    );
  });
}

function loadOBJ(url) {
  return new Promise((resolve, reject) => {
    new OBJLoader().load(
      url,
      (obj) => resolve(obj),
      null,
      reject
    );
  });
}

function loadFBX(url) {
  return new Promise((resolve, reject) => {
    new FBXLoader().load(
      url,
      (fbx) => {
        // Normaliza escala FBX (costuma vir em centímetros)
        fbx.scale.setScalar(0.01);
        resolve(fbx);
      },
      null,
      reject
    );
  });
}

// ─── Câmera fit ──────────────────────────────────────────────────────────────

function fitCamera(object) {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  controls.target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(maxDim, maxDim * 0.8, maxDim));
  camera.near = maxDim * 0.001;
  camera.far = maxDim * 100;
  camera.updateProjectionMatrix();
  controls.update();

  // Ajusta grade ao tamanho do modelo
  grid.position.y = box.min.y;
}

// ─── UI helpers ──────────────────────────────────────────────────────────────

function setStatus(msg, isError = false) {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
  el.style.color = isError ? '#ff6b6b' : '#aaaacc';
}

function showInfo(msg) {
  const el = document.getElementById('info-toast');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  setTimeout(() => { el.style.opacity = '0'; }, 3000);
}

// ─── Resize ──────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─── Loop ────────────────────────────────────────────────────────────────────

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// ─── Inicialização — carrega projeto da API ───────────────────────────────────

async function init() {
  // Pega slug da URL: /v/:slug
  const slug = window.location.pathname.split('/').pop();
  if (!slug) return setStatus('Nenhum projeto especificado', true);

  try {
    const res = await fetch(`/api/projects/${slug}`);
    if (!res.ok) throw new Error('Projeto não encontrado');
    const project = await res.json();

    document.title = `${project.name} — PerfecAire Viewer`;
    document.getElementById('project-name').textContent = project.name;
    if (project.description) {
      document.getElementById('project-desc').textContent = project.description;
    }

    // ← USA PROXY: evita CORS entre browser e R2
    await loadModel(`/api/proxy/${project.slug}`, project.file_type);

  } catch (err) {
    setStatus(err.message, true);
  }
}

init();

// Exporta loadModel para debug via console
window.loadModel = loadModel;
