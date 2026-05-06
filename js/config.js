// config.js — configuração da integração com GitHub Actions.
//
// ATENÇÃO: este arquivo é PÚBLICO no repo. O token aqui pode ser visto por
// qualquer pessoa que abra o site. Use apenas Fine-grained PAT com escopo
// MÍNIMO: "Actions: Read and write" no repositório lucasf-moreira/Unifique.
// Nada além disso. Se vazar, o pior estrago é alguém disparar o workflow
// (não há acesso a código nem a outros repos).
//
// Como gerar:
//   1. https://github.com/settings/personal-access-tokens/new
//   2. Token type: Fine-grained
//   3. Repository access: "Only select repositories" → escolha `Unifique`
//   4. Permissions → Repository permissions → "Actions" = "Read and write"
//   5. Tudo o resto fica em "No access"
//   6. Expiração: 90 dias (depois você gera outro)
//   7. Cole o token na constante GITHUB_PAT abaixo e dê push.
//
// Se algum dia o token vazar, basta REVOGAR no GitHub e gerar outro.

export const GITHUB = {
  owner: "lucasf-moreira",
  repo: "Unifique",
  workflow_file: "sync-sharepoint.yml",
  branch: "main",
  // Cole o fine-grained PAT aqui. Deixe vazio se não quiser usar (botão fica
  // como link pra o GitHub, igual a Opção A).
  pat: "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",
};
