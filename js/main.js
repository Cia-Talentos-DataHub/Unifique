// main.js - orquestracao do app

import { dataSource } from "./data.js";
import { authenticateParticipant } from "./auth.js";
import { getAllowedParticipants } from "./access.js";
import { formatNumberBR, normalizeText, findBestMatch } from "./utils.js";
import { renderCompetencias, renderEntrevista, renderDesenvolvimento, renderFacet, renderCarreira } from "./charts.js";
import { GITHUB } from "./config.js";

const loading = document.getElementById("loading-overlay");
const loginView = document.getElementById("login-view");
const dashboardView = document.getElementById("dashboard-view");

let manifest = null;
let access = [];
let interviews = [];
let facet = [];
let career = [];
let actions = {};

let session = null;          // { row, allowedParticipants }
let activeFocus = [];        // [] = todos os permitidos
let activeDirector = "";     // "" = qualquer diretor
let activeCargos = [];       // [] = todos os cargos
let activeCompetency = "";   // "" = todas as competencias

/** Dispara o workflow via Cloudflare Worker (que repassa pro GitHub usando PAT). */
async function dispatchSyncWorkflow() {
  const url = GITHUB.workerUrl.replace(/\/$/, "") + "/trigger";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Trigger-Key": GITHUB.triggerKey || "",
    },
    body: "{}",
  });
  if (!res.ok && res.status !== 204) {
    const txt = await res.text();
    throw new Error(`Worker respondeu ${res.status}: ${txt.slice(0, 200)}`);
  }
}

/** Polla manifest.json até detectar mudança no generated_at, ou desiste em 5 min. */
async function waitForSyncToFinish(originalTimestamp) {
  const start = Date.now();
  const timeout = 5 * 60 * 1000;
  while (Date.now() - start < timeout) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      // cache-buster para evitar que o navegador devolva manifest antigo
      const res = await fetch(`./data/manifest.json?t=${Date.now()}`, { cache: "no-store" });
      if (res.ok) {
        const m = await res.json();
        if (m.generated_at && m.generated_at !== originalTimestamp) {
          return m;
        }
      }
    } catch {}
  }
  return null;
}

function setupSyncBox(level) {
  const box = document.getElementById("sync-box");
  if (!box) return;
  // Botão só aparece para Acesso 1
  if (level !== 1) {
    box.hidden = true;
    return;
  }
  box.hidden = false;

  const btn = document.getElementById("sync-btn");
  const hint = document.getElementById("sync-hint");

  // Sem Worker configurado: cai no fallback de link pro GitHub (Opção A).
  if (!GITHUB.workerUrl || !GITHUB.triggerKey) {
    btn.outerHTML = `<a id="sync-btn" class="btn-secondary sync-btn" target="_blank" rel="noopener"
        href="https://github.com/${GITHUB.owner}/${GITHUB.repo}/actions/workflows/${GITHUB.workflow_file}">
        ↻ Atualizar agora
      </a>`;
    hint.textContent = "Worker ainda não configurado — abre o GitHub para disparar manualmente.";
    return;
  }

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const originalLabel = btn.textContent;
    btn.textContent = "Sincronizando…";
    hint.textContent = "Pedindo atualização ao servidor…";
    const original = manifest && manifest.generated_at;

    // Tenta disparar. Mesmo se der "Failed to fetch", o request pode ter
    // chegado no Worker (CORS preflight pode falhar em ler a resposta).
    // Vamos seguir pro polling em ambos os casos.
    let dispatchError = null;
    try {
      await dispatchSyncWorkflow();
    } catch (err) {
      console.warn("[sync] dispatch retornou erro, mas vou monitorar:", err.message);
      dispatchError = err;
    }

    hint.textContent = "Aguarde ~1 minuto. A página recarrega sozinha quando terminar.";

    // Faz polling do manifest. Se atualizar = realmente funcionou.
    const newManifest = await waitForSyncToFinish(original);
    if (newManifest) {
      btn.textContent = "Atualizado!";
      hint.textContent = "Pronto. Recarregando…";
      // Hard refresh: muda a URL com timestamp para forçar recarregar tudo do zero,
      // ignorando cache do navegador (equivalente a Ctrl+Shift+R).
      setTimeout(() => {
        const u = new URL(location.href);
        u.searchParams.set("t", Date.now().toString());
        location.replace(u.toString());
      }, 1200);
      return;
    }

    btn.textContent = originalLabel;
    btn.disabled = false;
    if (dispatchError) {
      hint.innerHTML = `Não consegui confirmar a sincronização. ` +
        `Veja em <a href="https://github.com/${GITHUB.owner}/${GITHUB.repo}/actions" target="_blank">GitHub Actions</a> ` +
        `ou tente de novo em alguns instantes.`;
    } else {
      hint.innerHTML = `Pedido enviado, mas a atualização ainda não veio. ` +
        `Acompanhe em <a href="https://github.com/${GITHUB.owner}/${GITHUB.repo}/actions" target="_blank">GitHub Actions</a> ` +
        `e recarregue esta página quando terminar.`;
    }
  });
}

function renderSyncStatus() {
  const el = document.getElementById("sync-when");
  if (!el) return;
  const ts = manifest && manifest.generated_at;
  if (!ts) { el.textContent = "—"; return; }
  try {
    const dt = new Date(ts);
    const now = new Date();
    const diffMs = now - dt;
    const diffMin = Math.round(diffMs / 60000);
    let rel;
    if (diffMin < 1) rel = "agora há pouco";
    else if (diffMin < 60) rel = `há ${diffMin} min`;
    else if (diffMin < 60 * 24) rel = `há ${Math.round(diffMin / 60)} h`;
    else rel = `há ${Math.round(diffMin / 60 / 24)} dia(s)`;
    const local = dt.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    el.textContent = `${local} — ${rel}`;
  } catch {
    el.textContent = ts;
  }
}

async function boot() {
  try {
    const data = await dataSource.loadAll();
    manifest = data.manifest;
    access = data.access || [];
    interviews = data.interviews || [];
    facet = data.facet || [];
    career = data.career || [];
    actions = data.actions || {};

    // Normaliza nomes: alinha "Participante" nos dados ao nome canônico da
    // planilha de Acessos via fuzzy matching. Resolve casos como
    // "Luiz Bogo Junior" no PDF FACET ↔ "Luiz Bogo Jr" na planilha.
    normalizeParticipantNames();

    initLogin();
  } catch (err) {
    alert("Erro ao carregar dados: " + err.message);
    console.error(err);
  } finally {
    loading.hidden = true;
  }
}

function normalizeParticipantNames() {
  if (!access.length) return;
  const accessRecords = access.map((r) => ({ Participante: r.PARTICIPANTE }));

  // Coleta nomes únicos vindos dos datasets de dados
  const dataNames = new Set();
  for (const r of interviews) if (r.Participante) dataNames.add(r.Participante);
  for (const r of facet) if (r.Participante) dataNames.add(r.Participante);
  for (const r of career) if (r.Participante) dataNames.add(r.Participante);

  // Mapeia cada nome de dataset → nome canônico em access (se houver fuzzy match)
  const map = new Map();
  for (const dn of dataNames) {
    // Se já existe exato em access, mantém
    const exact = access.find((a) => normalizeText(a.PARTICIPANTE) === normalizeText(dn));
    if (exact) {
      map.set(dn, exact.PARTICIPANTE);
      continue;
    }
    const best = findBestMatch(dn, accessRecords, (r) => r.Participante);
    if (best.rec) map.set(dn, best.rec.Participante);
    else map.set(dn, dn); // sem match → mantém como está
  }

  // Aplica o mapeamento nos datasets
  for (const r of interviews) if (map.has(r.Participante)) r.Participante = map.get(r.Participante);
  for (const r of facet) if (map.has(r.Participante)) r.Participante = map.get(r.Participante);
  for (const r of career) if (map.has(r.Participante)) r.Participante = map.get(r.Participante);
}

function initLogin() {
  const sel = document.getElementById("participant-select");
  const participantes = access
    .map((r) => r.PARTICIPANTE)
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "pt-BR"));
  for (const p of participantes) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    sel.appendChild(opt);
  }

  document.getElementById("login-form").addEventListener("submit", handleLogin);
}

async function handleLogin(ev) {
  ev.preventDefault();
  const sel = document.getElementById("participant-select").value;
  const pwd = document.getElementById("password-input").value;
  const err = document.getElementById("login-error");
  err.hidden = true;
  err.textContent = "";

  if (!sel) {
    err.textContent = "Selecione um participante.";
    err.hidden = false;
    return;
  }

  loading.hidden = false;
  const submitBtn = ev.target.querySelector("button[type=submit]");
  submitBtn.disabled = true;

  try {
    const row = await authenticateParticipant(access, sel, pwd);
    if (!row) {
      err.textContent = "Senha inválida.";
      err.hidden = false;
      return;
    }
    const allowed = getAllowedParticipants(access, row);
    session = { row, allowedParticipants: allowed };
    enterDashboard();
  } finally {
    submitBtn.disabled = false;
    loading.hidden = true;
  }
}

function enterDashboard() {
  loginView.hidden = true;
  dashboardView.hidden = false;

  const me = session.row.PARTICIPANTE;
  const level = Number(session.row.__access_level__ || 0);

  document.getElementById("user-caption").textContent = me;
  renderSyncStatus();
  setupSyncBox(level);

  // Helper: lista os participantes que possuem dados de fato (entrevista,
  // FACET5 ou questionário) dentre os permitidos pelo nível de acesso.
  // Antes filtrávamos por __access_level__ === 3, mas isso excluía Acesso 4
  // (que também é participante). Agora vai por presença real de dados.
  const peopleWithData = new Set();
  for (const r of interviews) peopleWithData.add(normalizeText(r.Participante));
  for (const r of facet) peopleWithData.add(normalizeText(r.Participante));
  for (const r of career) peopleWithData.add(normalizeText(r.Participante));

  const realParticipants = session.allowedParticipants.filter((name) =>
    peopleWithData.has(normalizeText(name))
  );

  // Filtro Participante (multi-select)
  const partSelect = document.getElementById("participant-filter");
  partSelect.multiple = true;

  // Repopula o select de participantes - filtra pelo diretor se houver
  function repopulateParticipants(directorFilter) {
    let list = realParticipants;
    if (directorFilter) {
      list = realParticipants.filter((p) => {
        const r = access.find((a) => a.PARTICIPANTE === p);
        return r && String(r.DIRETOR || "").trim() === directorFilter;
      });
    }
    partSelect.innerHTML = "";
    partSelect.size = Math.min(Math.max(list.length, 4), 10);
    for (const p of list) {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      // mantem a selecao se o nome continua na nova lista
      if (activeFocus.includes(p)) opt.selected = true;
      partSelect.appendChild(opt);
    }
    // se algum nome saiu da lista, atualiza activeFocus
    activeFocus = activeFocus.filter((p) => list.includes(p));
  }

  repopulateParticipants("");

  // Default por nível: Acesso 3 = ele mesmo selecionado; Acesso 1/2 = nada selecionado (todos)
  if (level === 3) {
    activeFocus = [me];
    Array.from(partSelect.options).forEach((o) => { o.selected = (o.value === me); });
  } else {
    activeFocus = [];
  }

  // Filtro Diretor (Acesso 1, 2 e 4)
  const dirGroup = document.getElementById("director-filter-group");
  const dirSelect = document.getElementById("director-filter");
  if (level === 1 || level === 4) {
    // Lista todos os diretores presentes nos participantes que esse usuário pode ver
    const visibleSet = new Set(realParticipants);
    const diretores = Array.from(
      new Set(
        access
          .filter((r) => visibleSet.has(r.PARTICIPANTE))
          .map((r) => r.DIRETOR)
          .filter((v) => v && String(v).trim() !== "")
      )
    ).sort((a, b) => a.localeCompare(b, "pt-BR"));
    dirSelect.innerHTML = '<option value="">Todos</option>' +
      diretores.map((d) => `<option value="${d}">${d}</option>`).join("");
    dirGroup.hidden = false;
  } else if (level === 2) {
    // Para Acesso 2 mostra so o proprio (deixa claro de quem é a equipe)
    dirSelect.innerHTML = `<option value="${me}" selected>${me}</option>`;
    dirGroup.hidden = false;
    activeDirector = me;
  } else {
    dirGroup.hidden = true;
  }

  // Listeners (depois de configurar opcoes)
  partSelect.addEventListener("change", () => {
    activeFocus = Array.from(partSelect.selectedOptions).map((o) => o.value);
    syncDirectorFromParticipants();
    rerenderActiveTab();
  });
  if (level === 1 || level === 4) {
    dirSelect.addEventListener("change", () => {
      activeDirector = dirSelect.value;
      // ao escolher diretor: zera selecao e repopula com a equipe dele
      activeFocus = [];
      repopulateParticipants(activeDirector);
      rerenderActiveTab();
    });
  }

  function syncDirectorFromParticipants() {
    if (level !== 1 && level !== 4) return;
    if (!activeFocus.length) {
      dirSelect.value = "";
      activeDirector = "";
      return;
    }
    // Pega o(s) diretor(es) das pessoas selecionadas
    const dirs = new Set(
      activeFocus.map((p) => {
        const r = access.find((a) => a.PARTICIPANTE === p);
        return r ? (r.DIRETOR || "") : "";
      }).filter(Boolean)
    );
    if (dirs.size === 1) {
      const d = [...dirs][0];
      dirSelect.value = d;
      activeDirector = d;
    } else {
      dirSelect.value = "";
      activeDirector = "";
    }
  }

  // Filtro Cargo (multi-select). Popula com os cargos dos participantes visíveis
  // (acompanha mudanças do filtro de diretor).
  const cargoSelect = document.getElementById("cargo-filter");
  cargoSelect.multiple = true;

  function repopulateCargos(visibleNames) {
    const set = new Set();
    for (const name of visibleNames) {
      const r = access.find((a) => a.PARTICIPANTE === name);
      const c = r && r.CARGO ? String(r.CARGO).trim() : "";
      if (c) set.add(c);
    }
    const cargos = Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
    cargoSelect.innerHTML = "";
    cargoSelect.size = Math.min(Math.max(cargos.length, 4), 8);
    for (const c of cargos) {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      if (activeCargos.includes(c)) opt.selected = true;
      cargoSelect.appendChild(opt);
    }
    // remove da seleção cargos que não existem mais
    activeCargos = activeCargos.filter((c) => cargos.includes(c));
  }
  repopulateCargos(realParticipants);

  cargoSelect.addEventListener("change", () => {
    activeCargos = Array.from(cargoSelect.selectedOptions).map((o) => o.value);
    rerenderActiveTab();
  });

  // Hook: quando o filtro de Diretor muda, repopula cargos com a equipe nova
  const originalDirHandler = dirSelect.onchange;
  if (level === 1 || level === 4) {
    dirSelect.addEventListener("change", () => {
      // O handler principal já zera activeFocus e repopula participants;
      // aqui sincronizamos os cargos com a nova lista visível.
      const visible = Array.from(partSelect.options).map((o) => o.value);
      repopulateCargos(visible);
    });
  }

  // Hook: quando muda Pessoas, também repopula cargos (mantendo seleção)
  partSelect.addEventListener("change", () => {
    const visible = Array.from(partSelect.options).map((o) => o.value);
    repopulateCargos(visible);
  });

  // Filtro Competência (Entrevista)
  const compFilter = document.getElementById("competency-filter");
  const compsList = Array.from(
    new Set(interviews.map((r) => r.Competencia).filter(Boolean))
  ).sort();
  compFilter.innerHTML =
    '<option value="">Todas</option>' +
    compsList.map((c) => `<option value="${c}">${c}</option>`).join("");
  compFilter.addEventListener("change", () => {
    activeCompetency = compFilter.value || "";
    rerenderActiveTab();
  });

  // Tabs
  document.querySelectorAll(".tab-btn").forEach((btn) =>
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const id = btn.dataset.tab;
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
      document.getElementById(`tab-${id}`).classList.add("active");
      document.getElementById("competency-filter-group").hidden = id !== "entrevista";
      rerenderActiveTab();
    })
  );

  document.getElementById("logout-btn").addEventListener("click", () => {
    session = null;
    activeFocus = [];
    activeDirector = "";
    activeCargos = [];
    activeCompetency = "";
    dashboardView.hidden = true;
    loginView.hidden = false;
    document.getElementById("password-input").value = "";
  });

  rerenderActiveTab();
}

/**
 * Aplica o filtro completo (allowed + diretor + foco) e devolve as 3 listas filtradas.
 */
function getFilteredData() {
  // 1) restringe pelos permitidos (allowedParticipants) E que tenham dados de fato.
  const peopleWithData = new Set();
  for (const r of interviews) peopleWithData.add(normalizeText(r.Participante));
  for (const r of facet) peopleWithData.add(normalizeText(r.Participante));
  for (const r of career) peopleWithData.add(normalizeText(r.Participante));

  const realParticipants = session.allowedParticipants.filter((name) =>
    peopleWithData.has(normalizeText(name))
  );
  let allowedSet = new Set(realParticipants.map(normalizeText));

  // 2) filtro por diretor (intersecao). Inclui o próprio diretor junto
  //    com sua equipe — ele não tem DIRETOR=ele mesmo, então é tratado à parte.
  if (activeDirector) {
    const dirAllowed = new Set(
      access
        .filter((r) =>
          String(r.DIRETOR || "").trim() === activeDirector ||
          String(r.PARTICIPANTE || "").trim() === activeDirector
        )
        .map((r) => normalizeText(r.PARTICIPANTE))
    );
    allowedSet = new Set([...allowedSet].filter((x) => dirAllowed.has(x)));
  }

  // 2.5) filtro por cargo (intersecao)
  if (activeCargos && activeCargos.length) {
    const cargoSet = new Set(activeCargos.map((c) => normalizeText(c)));
    const namesWithCargo = new Set(
      access
        .filter((r) => cargoSet.has(normalizeText(r.CARGO || "")))
        .map((r) => normalizeText(r.PARTICIPANTE))
    );
    allowedSet = new Set([...allowedSet].filter((x) => namesWithCargo.has(x)));
  }

  // 3) Foco em participantes selecionados (multi)
  if (activeFocus && activeFocus.length) {
    const focusKeys = new Set(activeFocus.map(normalizeText));
    allowedSet = new Set([...allowedSet].filter((x) => focusKeys.has(x)));
  }

  // focusName: se exatamente 1 -> nome dele (modo "individual"); senao -> null (modo "todos")
  const focusName = (activeFocus && activeFocus.length === 1) ? activeFocus[0] : null;

  return {
    interviewsAllowed: interviews.filter((r) => allowedSet.has(normalizeText(r.Participante))),
    facetAllowed: facet.filter((r) => allowedSet.has(normalizeText(r.Participante))),
    careerAllowed: career.filter((r) => allowedSet.has(normalizeText(r.Participante))),
    focusName,
  };
}

function rerenderActiveTab() {
  if (!session) return;
  const { interviewsAllowed, facetAllowed, careerAllowed, focusName } = getFilteredData();
  const active = document.querySelector(".tab-btn.active").dataset.tab;

  if (active === "competencias") {
    renderCompetencias(document.getElementById("competencias-content"), interviewsAllowed, focusName);
  } else if (active === "entrevista") {
    renderEntrevista(document.getElementById("entrevista-content"), interviewsAllowed, focusName, activeCompetency);
  } else if (active === "desenvolvimento") {
    renderDesenvolvimento(document.getElementById("desenvolvimento-content"), interviewsAllowed, actions, focusName);
  } else if (active === "facet") {
    renderFacet(document.getElementById("facet-content"), facetAllowed, focusName);
  } else if (active === "carreira") {
    renderCarreira(document.getElementById("carreira-content"), careerAllowed, focusName);
  }
}

boot();
