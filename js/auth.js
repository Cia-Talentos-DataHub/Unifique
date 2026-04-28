// auth.js - validacao de senha contra hash PBKDF2

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function bytesToHex(buf) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyPassword(password, spec) {
  if (!spec || !spec.salt || !spec.hash || !spec.iterations) return false;
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: hexToBytes(spec.salt),
      iterations: spec.iterations,
      hash: "SHA-256",
    },
    keyMaterial,
    256
  );
  return bytesToHex(bits) === spec.hash.toLowerCase();
}

/**
 * Login pelo PARTICIPANTE: encontra o registro pelo nome selecionado e valida senha.
 * Retorna o registro de acesso se OK, senão null.
 */
export async function authenticateParticipant(accessRecords, selectedParticipant, typedPassword) {
  const pwd = String(typedPassword || "").trim();
  if (!pwd) return null;

  const target = String(selectedParticipant || "").trim();
  const row = accessRecords.find((r) => String(r.PARTICIPANTE || "").trim() === target);

  if (!row) {
    console.warn("[auth] participante nao encontrado:", target);
    return null;
  }

  if (!crypto || !crypto.subtle) {
    alert(
      "Seu navegador nao expoe crypto.subtle. Acesse o site via http://localhost ou https://."
    );
    return null;
  }

  if (!row.__password_hash__) {
    console.warn("[auth] participante sem senha cadastrada:", target);
    return null;
  }

  const ok = await verifyPassword(pwd, row.__password_hash__);
  console.log(`[auth] participante=${target}  match=${ok}  nivel=${row.__access_level__}`);
  return ok ? row : null;
}
