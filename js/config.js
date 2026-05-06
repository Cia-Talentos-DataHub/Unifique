// config.js — configuração da integração com o Cloudflare Worker.
//
// O Worker é o proxy seguro entre o app e o GitHub. O PAT fica armazenado
// nas variáveis do Worker, NUNCA aqui no JS público.
//
// Aqui vão APENAS:
//   - workerUrl:    URL pública do Worker (ex: https://unifique-sync.lucas.workers.dev)
//   - triggerKey:   chave compartilhada (sem segredo real). Só impede que alguém
//                   chame o Worker via curl sem saber dela. Como o Worker só faz UMA
//                   coisa (disparar o workflow), o impacto de vazamento é ZERO.

export const GITHUB = {
  // Identificação do repo (usados também para o link de fallback).
  owner: "cia-talentos-datahub",
  repo: "Unifique",
  workflow_file: "sync-sharepoint.yml",

  // ↓ preencha esses dois depois de fazer o deploy do Worker (ver worker/README.md)
  workerUrl: "https://unifique-sync.lucas-moreira.workers.dev/",
  triggerKey: "unifique-2026",
};
