/**
 * Cloudflare Worker — Proxy de dispatch para o workflow do Unifique.
 *
 * O frontend chama POST {workerUrl}/trigger com o header X-Trigger-Key.
 * O Worker valida a chave e dispara o workflow no GitHub usando o PAT armazenado
 * nas Environment Variables (NUNCA no código).
 *
 * Variáveis (definir no Cloudflare Dashboard ou via wrangler):
 *   GH_PAT       (secret) → fine-grained PAT com Actions write no repo Unifique
 *   GH_OWNER             → "lucasf-moreira"
 *   GH_REPO              → "Unifique"
 *   GH_WORKFLOW          → "sync-sharepoint.yml"
 *   GH_BRANCH            → "main"
 *   TRIGGER_KEY  (secret) → chave qualquer (ex: "unifique-2026"); o frontend usa a mesma
 *   ALLOWED_ORIGIN       → "https://lucasf-moreira.github.io"  (sem barra final)
 */

const corsHeaders = (origin) => ({
  "Access-Control-Allow-Origin": origin || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-Trigger-Key",
  "Access-Control-Max-Age": "86400",
});

export default {
  async fetch(request, env) {
    const origin = env.ALLOWED_ORIGIN || "*";

    // Preflight CORS
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== "POST") {
      return new Response("Use POST", { status: 405, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    if (!url.pathname.endsWith("/trigger")) {
      return new Response("Not found", { status: 404, headers: corsHeaders(origin) });
    }

    // Validação da chave
    const key = request.headers.get("X-Trigger-Key");
    if (!env.TRIGGER_KEY || key !== env.TRIGGER_KEY) {
      return new Response("Unauthorized", { status: 401, headers: corsHeaders(origin) });
    }

    if (!env.GH_PAT || !env.GH_OWNER || !env.GH_REPO || !env.GH_WORKFLOW) {
      return new Response("Worker mal configurado", { status: 500, headers: corsHeaders(origin) });
    }

    const ghUrl = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/actions/workflows/${env.GH_WORKFLOW}/dispatches`;
    const ghRes = await fetch(ghUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.GH_PAT}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        "User-Agent": "unifique-sync-worker",
      },
      body: JSON.stringify({ ref: env.GH_BRANCH || "main" }),
    });

    const body = ghRes.ok ? "ok" : await ghRes.text();
    return new Response(body, {
      status: ghRes.ok ? 204 : ghRes.status,
      headers: { ...corsHeaders(origin), "Content-Type": "text/plain" },
    });
  },
};
