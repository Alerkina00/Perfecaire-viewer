# Perfect Aire Viewer 3D

Visualizador 3D para modelos **IFC, GLB, GLTF+BIN, OBJ e FBX** — com painel admin, upload, QR Code e armazenamento na nuvem (Cloudflare R2).

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Servidor | Node.js + Express |
| Viewer 3D | Three.js + loaders (GLTF/Draco/OBJ/FBX) via CDN |
| Conversão IFC→GLB | web-ifc + gltf-transform (Draco), em **worker thread** |
| Auth | JWT + bcrypt (com rate limit no login) |
| Banco | SQLite via sql.js (em memória, persistido em arquivo) |
| Storage | Cloudflare R2 (S3-compatível) — fallback em disco local |
| Deploy | Railway (via GitHub) |

---

## Dois jeitos de colocar um modelo

**1. Recomendado — exportar GLB do Revit com o plugin Leia (e-verse):**
No Revit, exporte a vista 3D como **GLB** com **compressão Draco**, dados mínimos e materiais ligados (marque "flip YZ-axis" e "relocate to 0,0,0"). Suba o `.glb` no painel — o servidor não converte nada, só armazena e serve. É o caminho mais leve e estável, com melhor qualidade de material.

**2. Subir o IFC e deixar o servidor converter:**
Suba o `.ifc` no painel. A conversão roda num **worker thread** (não trava o servidor) e o resultado vai pra nuvem. Funciona bem para modelos pequenos/médios; modelos muito grandes (>100 MB) exigem um plano Railway com RAM suficiente (vários GB).

> Para um IFC **muito grande**, prefira converter offline na sua máquina:
> ```bash
> node --max-old-space-size=8192 converter_offline.js modelo.ifc
> ```
> e suba o `.glb` gerado.

---

## Rodando local

```bash
cp .env.example .env      # edite conforme necessário
npm install
npm run dev               # ou: npm start
