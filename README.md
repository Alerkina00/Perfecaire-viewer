# perfect aire Viewer 3D

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
```

Acesse `http://localhost:3000/admin`. Na primeira execução, se `ADMIN_PASSWORD` estiver vazio, a senha do admin é gerada e mostrada no log uma vez.

---

## Variáveis de ambiente

Veja `.env.example`. As principais:

- `JWT_SECRET` — **obrigatório em produção** (`openssl rand -hex 32`).
- `ADMIN_PASSWORD` — senha inicial do admin (ou é gerada e logada).
- `GLB_COMPRESSION` — `draco` (padrão), `meshopt` ou `none`.
- `WORKER_MAX_MB` — RAM do worker de conversão (padrão 8192).
- `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` — Cloudflare R2. Sem elas, grava em disco local (efêmero no Railway).

---

## Deploy Railway

1. `git push` para o GitHub; no Railway, "Deploy from GitHub".
2. Configure as variáveis acima em Variables (incluindo as do R2).
3. Para conversão de IFC grande no servidor, ajuste o plano para ter RAM suficiente.

A persistência de verdade vem do R2. Sem ele, o disco do Railway é efêmero e os modelos somem a cada deploy.

---

## Estrutura

```
src/
  server.js                  Entry point Express
  config.js                  JWT_SECRET central (aborta em produção se ausente)
  middleware/auth.js         JWT
  routes/
    auth.js                  login / me / change-password (+ rate limit)
    projects.js              upload, conversão (worker p/ IFC), CRUD
    proxy.js                 serve o modelo do storage (R2 ou local)
  services/
    db.js                    SQLite (sql.js)
    storage.js               Cloudflare R2 + fallback local
    converter.js             IFC/GLTF+BIN → GLB comprimido
    conversion_worker.js     roda a conversão fora do event loop
client/public/
  admin.html                 painel admin
  viewer.html                viewer Three.js
converter_offline.js         conversão IFC→GLB na sua máquina (modelos grandes)
```
