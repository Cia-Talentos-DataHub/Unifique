# Cloudflare Worker — Sync proxy

Proxy minúsculo entre o app web e o GitHub Actions. Mantém o PAT seguro
no servidor da Cloudflare e expõe um endpoint que o frontend chama para
disparar o workflow.

## Por que isso existe

O JS do GitHub Pages é público. O Push Protection do GitHub bloqueia
qualquer tentativa de comitar PAT em arquivo. Esse Worker resolve:
o PAT fica armazenado nas variáveis encriptadas da Cloudflare.

## Deploy — caminho mais fácil (Dashboard)

1. **Criar conta Cloudflare** em https://dash.cloudflare.com (free tier
   inclui 100.000 requisições/dia ao Worker, mais que suficiente).

2. **Criar Worker:**
   - No dashboard, vai em `Workers & Pages` → `Create` → `Workers` → `Create Worker`.
   - Dá um nome, ex: `unifique-sync`.
   - Vai aparecer um editor com código de exemplo. Apaga tudo e cola o conteúdo
     de `worker.js` deste diretório.
   - Clica em `Save and deploy`.
   - Anota a URL pública que aparece (ex: `https://unifique-sync.SEU-USUARIO.workers.dev`).

3. **Configurar variáveis:** ainda no Worker:
   - Vai em `Settings` → `Variables` → `Environment Variables`.
   - Adiciona como **Plaintext**:
     - `GH_OWNER` = `lucasf-moreira`
     - `GH_REPO` = `Unifique`
     - `GH_WORKFLOW` = `sync-sharepoint.yml`
     - `GH_BRANCH` = `main`
     - `ALLOWED_ORIGIN` = `https://lucasf-moreira.github.io`
   - Adiciona como **Encrypted (secret)**:
     - `GH_PAT` = o fine-grained PAT do GitHub (Actions: Read and write no repo Unifique).
     - `TRIGGER_KEY` = qualquer string aleatória (ex: `unifique-2026-aleatoriozzz`).
       Essa string vai ficar visível no JS do app — não precisa ser segredo,
       só serve pra evitar que bots da internet disparem o Worker via curl.

4. **Atualiza o app** em `web/js/config.js`:
   ```js
   workerUrl: "https://unifique-sync.SEU-USUARIO.workers.dev",
   triggerKey: "a-mesma-string-que-você-pôs-em-TRIGGER_KEY",
   ```

5. **Commit + push** do `config.js`. Pronto: o botão "Atualizar agora" do app
   passa a chamar o Worker, que dispara a Action.

## Deploy alternativo (CLI wrangler)

```sh
npm install -g wrangler
wrangler login
cd web/worker

# Configura secrets
wrangler secret put GH_PAT       # cola o PAT
wrangler secret put TRIGGER_KEY  # cola a chave compartilhada

# Deploy
wrangler deploy
```

## Como rotacionar o PAT

Quando expirar (ou se quiser trocar):
1. Gera novo fine-grained PAT no GitHub.
2. No Worker, vai em `Settings` → `Variables` → edita `GH_PAT`.
3. Save. Em segundos está atualizado. Sem precisar republicar nada.
