// access.js - aplica filtro de visibilidade conforme nivel de acesso

import { normalizeText } from "./utils.js";

// Nivel 4: ve todos os participantes EXCETO esses nomes (lista bloqueada).
// Edite aqui quando quiser adicionar/remover quem fica fora do nivel 4.
const LEVEL_4_BLOCKLIST = new Set([
  "adriana joice sandri osti",
  "ana paula de oliveira caldas",
  "julio cesar conti",
].map((n) => normalizeText(n)));

/**
 * Acesso 1: ve todos os participantes
 * Acesso 2: ve quem tem DIRETORIA == nome do logado (com fallback DIRETOR == nome)
 * Acesso 3: ve apenas o proprio
 * Acesso 4: ve todos os participantes EXCETO os nomes em LEVEL_4_BLOCKLIST
 *
 * Retorna a lista de PARTICIPANTES (nomes originais) que o usuario logado pode ver.
 */
export function getAllowedParticipants(accessRecords, loggedRow) {
  const level = Number(loggedRow.__access_level__ || 0);
  const me = String(loggedRow.PARTICIPANTE || "").trim();
  const meKey = normalizeText(me);

  if (level === 1) {
    return accessRecords.map((r) => r.PARTICIPANTE).filter(Boolean);
  }

  if (level === 4) {
    const list = accessRecords
      .map((r) => r.PARTICIPANTE)
      .filter(Boolean)
      .filter((name) => !LEVEL_4_BLOCKLIST.has(normalizeText(name)));
    // Garante que o usuario logado sempre se ve, mesmo estando na blocklist
    if (me && !list.includes(me)) list.unshift(me);
    return list;
  }

  if (level === 3) {
    return [me];
  }

  // Acesso 2: tenta DIRETORIA == nome do logado
  let allowed = accessRecords
    .filter((r) => normalizeText(r.DIRETORIA) === meKey)
    .map((r) => r.PARTICIPANTE);

  // Fallback: DIRETOR == nome do logado (caso a planilha use DIRETOR para isso)
  if (!allowed.length) {
    allowed = accessRecords
      .filter((r) => normalizeText(r.DIRETOR) === meKey)
      .map((r) => r.PARTICIPANTE);
  }

  // Garante que o proprio diretor sempre aparece na lista
  if (!allowed.includes(me)) allowed = [me, ...allowed];

  return allowed;
}
