// access.js - aplica filtro de visibilidade conforme nivel de acesso

import { normalizeText } from "./utils.js";

/**
 * Acesso 1: ve todos os participantes
 * Acesso 2: ve quem tem DIRETORIA == nome do logado (com fallback DIRETOR == nome)
 * Acesso 3: ve apenas o proprio
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
