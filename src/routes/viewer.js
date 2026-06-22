/**
 * viewer.js — perfect aire Viewer 3D
 *
 * ATENÇÃO: Este arquivo é mantido apenas como referência / fallback.
 * O viewer real funciona via <script type="module"> inline no viewer.html,
 * carregando Three.js e web-ifc-three direto do CDN (jsDelivr).
 *
 * Por que não bundlamos com esbuild?
 *
 * 1. web-ifc usa Emscripten/WASM. O WASM espera imports do runtime Emscripten
 *    no formato  WebAssembly.instantiate(bytes, { "a": { "a": fn } }).
 *    Quando o esbuild bundla o módulo, ele renomeia/move essas funções e o
 *    vínculo se perde → LinkError: Import #0 "a" "a": function import requires
 *    a callable.
 *
 * 2. Bundlar Three.js junto com web-ifc-three cria duas instâncias separadas
 *    da lib → aviso "Multiple instances of Three.js being imported" e
 *    comportamentos inesperados.
 *
 * A solução correta é carregar via ES Modules do CDN, que preserva o ambiente
 * Emscripten e garante uma única instância do Three.js.
 *
 * Se precisar do bundle (ex: para outro contexto), configure o esbuild com:
 *   external: ['three', 'web-ifc', 'web-ifc-three']
 * e inclua as libs via <script> CDN antes do bundle no HTML.
 */

// Este arquivo intencionalmente vazio de lógica.
// Toda a lógica do viewer está em client/public/viewer.html.
