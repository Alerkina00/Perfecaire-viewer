// src/services/conversion_worker.js
// ─────────────────────────────────────────────────────────────────────────────
// Roda a conversão pesada (web-ifc + compressão) numa THREAD SEPARADA, para o
// processo principal continuar respondendo o healthcheck do Railway. É isso que
// elimina o 502: sem worker, a conversão bloqueia o event loop por minutos, o
// /health para de responder e o Railway reinicia o container no meio do trabalho.
//
// Recebe via workerData o CAMINHO do IFC (não o buffer) para não duplicar o
// arquivo entre as threads. Reaproveita a mesma lógica de ifcToGlb do converter.
// ─────────────────────────────────────────────────────────────────────────────
'use strict';
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');
const path = require('path');

(async () => {
  try {
    const { ifcPath, compressao } = workerData;
    if (compressao) process.env.GLB_COMPRESSION = compressao;

    const { ifcToGlb } = require('./converter');

    const ifcBuffer = fs.readFileSync(ifcPath);
    const glb = await ifcToGlb(ifcBuffer);

    // Escreve o GLB ao lado do IFC temporário; o processo principal lê e envia
    // para a nuvem, depois limpa os dois.
    const glbPath = ifcPath.replace(/\.ifc$/i, '') + '.glb';
    fs.writeFileSync(glbPath, glb);

    parentPort.postMessage({ ok: true, glbPath, size: glb.length });
  } catch (err) {
    parentPort.postMessage({ ok: false, error: err && err.message ? err.message : String(err) });
  }
})();
