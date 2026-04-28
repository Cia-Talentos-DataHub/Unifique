// utils.js — funções auxiliares de string, números e fuzzy matching de nomes

export function normalizeText(value) {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // remove acentos
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Fuzzy: tokens em comum / total de tokens (Jaccard)
export function nameSimilarity(a, b) {
  const ta = new Set(normalizeText(a).split(/\s+/).filter(Boolean));
  const tb = new Set(normalizeText(b).split(/\s+/).filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  const inter = [...ta].filter((x) => tb.has(x)).length;
  const union = new Set([...ta, ...tb]).size;
  return inter / union;
}

export function findBestMatch(targetName, records, getName) {
  let best = { rec: null, score: 0 };
  const target = normalizeText(targetName);
  for (const r of records) {
    const candidate = normalizeText(getName(r));
    if (!candidate) continue;
    if (candidate === target) return { rec: r, score: 1 };
    const score = nameSimilarity(targetName, getName(r));
    if (score > best.score) best = { rec: r, score };
  }
  // limiar de aceitação: 0.5 (pelo menos metade dos tokens em comum)
  return best.score >= 0.5 ? best : { rec: null, score: best.score };
}

export function mean(nums) {
  const arr = nums.filter((x) => typeof x === "number" && !Number.isNaN(x));
  if (!arr.length) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

export function formatNumberBR(n, decimals = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function uniqueValues(records, key) {
  return Array.from(
    new Set(records.map((r) => r[key]).filter((v) => v !== null && v !== undefined && v !== ""))
  );
}
