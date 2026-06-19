# PerfecAire Viewer 3D

Visualizador 3D para arquivos **IFC, GLTF/GLB, OBJ e FBX** — com painel admin, upload, QR Code e deploy automático no Railway.

---

## Stack

| Camada | Tecnologia |
|--------|-----------|
| Servidor | Node.js + Express |
| Viewer 3D | Three.js + web-ifc-three |
| Bundler | esbuild |
| Auth | JWT + bcrypt |
| Banco | SQLite (better-sqlite3) |
| Storage | Cloudflare R2 (S3-compatível) |
| Deploy | Railway (via GitHub) |

---

## Rodando local

```bash
# 1. Clone o projeto
git clone https://github.com/SEU_USUARIO/perfecaire-viewer
cd perfecaire-viewer

# 2. Configure variáveis
cp .env.example .env
# edite .env com suas chaves R2

# 3. Instale dependências do servidor
npm install

# 4. Instale e builde o cliente
cd client && npm install && cd ..
npm run build:client

# 5. Inicie
npm run dev
```

Acesse: http://localhost:3000/admin

---

## Deploy Railway + GitHub

### 1. Crie o repositório no GitHub

```bash
git init
git add .
git commit -m "feat: visualizador 3D PerfecAire"
git remote add origin https://github.com/SEU_USUARIO/perfecaire-viewer.git
git push -u origin main
```

### 2. Configure no Railway

1. Acesse [railway.app](https://railway.app) → New Project → Deploy from GitHub
2. Selecione o repositório `perfecaire-viewer`
3. Railway detecta o `railway.json` automaticamente

### 3. Variáveis de ambiente no Railway

No painel Railway → seu serviço → Variables, adicione:

```
NODE_ENV=production
BASE_URL=https://SEU-PROJETO.up.railway.app
JWT_SECRET=<gere com: openssl rand -hex 32>
ADMIN_PASSWORD=sua-senha-forte
R2_ENDPOINT=https://SEU_ACCOUNT_ID.r2.cloudflarestorage.com
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET_NAME=perfecaire-models
```

> **DB no Railway**: O Railway tem disco efêmero por padrão.
> Para persistência do SQLite, adicione um Volume no painel Railway montado em `/app/data`.
> Ou migre para Postgres (Railway oferece Postgres gratuito) — abra uma issue se precisar.

### 4. Deploy automático

A partir daí, todo `git push origin main` faz deploy automático. ✓

---

## Cloudflare R2 — configuração

1. Painel Cloudflare → R2 → Create bucket → nome: `perfecaire-models`
2. R2 → Manage R2 API Tokens → Create Token → permissão: Object Read & Write
3. Copie: Account ID, Access Key ID, Secret Access Key
4. (Opcional) Configure domínio customizado no bucket para URL pública

---

## Uso

- **Admin**: `https://seu-dominio.com/admin`
  - Login com usuário `admin` e a senha definida em `ADMIN_PASSWORD`
  - Upload de arquivos IFC/GLTF/OBJ/FBX
  - QR Code gerado automaticamente para cada projeto

- **Viewer público**: `https://seu-dominio.com/v/nome-do-projeto`
  - Acessível via QR Code sem login
  - Controles: orbitar, zoom, centralizar, wireframe, tela cheia

---

## Estrutura do projeto

```
perfecaire-viewer/
├── src/
│   ├── server.js              # Entry point Express
│   ├── middleware/
│   │   └── auth.js            # JWT middleware
│   ├── routes/
│   │   ├── auth.js            # Login / me / change-password
│   │   ├── projects.js        # CRUD projetos + upload R2
│   │   └── viewer.js          # Rota pública /v/:slug
│   └── services/
│       ├── db.js              # SQLite + init
│       └── storage.js         # Cloudflare R2
├── client/
│   ├── src/
│   │   └── viewer.js          # Three.js viewer (bundlado)
│   ├── public/
│   │   ├── admin.html         # Painel admin
│   │   ├── viewer.html        # Viewer público
│   │   └── viewer.bundle.js   # Gerado pelo esbuild
│   └── package.json
├── .env.example
├── .gitignore
├── railway.json
└── package.json
```
