// main.js - orquestracao do app

import { dataSource } from "./data.js";
import { authenticateParticipant } from "./auth.js";
import { getAllowedParticipants } from "./access.js";
import { formatNumberBR, normalizeText } from "./utils.js";
import { renderCompetencias, renderEntrevista, renderFacet, renderCarreira } from "./charts.js";

const loading = document.getElementById("loading-overlay");
const loginView = document.getElementById("login-view");
const dashboardView = document.getElementById("dashboard-view");

let manifest = null;
let access = [];
let interviews = [];
let facet = [];
let career = [];

let session = null;          // { row, allowedParticipants }
let activeFocus = [];        // [] = todos os permitidos
let activeDirector = "";     // "" = qualquer diretor
let activeCompetency = "";   // "" = todas as competencias

async function boot() {
  try {
    const data = await dataSource.loadAll();
    manifest = data.manifest;
    access = data.access || [];
    interviews = data.interviews || [];
    facet = data.facet || [];
    career = data.career || [];
    initLogin();
  } catch (err) {
    alert("Erro ao carregar dados: " + err.message);
    console.error(err);
  } finally {
    loading.hidden = true;
  }
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

  // Helper: lista só PARTICIPANTES de fato (Acesso 3) dentre os permitidos.
  // Niveis 1 e 2 sao consumidores do app, nao aparecem como opcoes.
  const realParticipants = session.allowedParticipants.filter((name) => {
    const r = access.find((a) => a.PARTICIPANTE === name);
    return r && Number(r.__access_level__) === 3;
  });

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

  // Filtro Diretor (Acesso 1 e 2)
  const dirGroup = document.getElementById("director-filter-group");
  const dirSelect = document.getElementById("director-filter");
  if (level === 1) {
    const diretores = Array.from(
      new Set(access.map((r) => r.DIRETOR).filter((v) => v && String(v).trim() !== ""))
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
  if (level === 1) {
    dirSelect.addEventListener("change", () => {
      activeDirector = dirSelect.value;
      // ao escolher diretor: zera selecao e repopula com a equipe dele
      activeFocus = [];
      repopulateParticipants(activeDirector);
      rerenderActiveTab();
    });
  }

  function syncDirectorFromParticipants() {
    if (level !== 1) return;
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
  // 1) restringe pelo nivel (allowedParticipants), apenas Acesso 3
  const realParticipants = session.allowedParticipants.filter((name) => {
    const r = access.find((a) => a.PARTICIPANTE === name);
    return r && Number(r.__access_level__) === 3;
  });
  let allowedSet = new Set(realParticipants.map(normalizeText));

  // 2) filtro por diretor (intersecao)
  if (activeDirector) {
    const dirAllowed = new Set(
      access
        .filter((r) => String(r.DIRETOR || "").trim() === activeDirector)
        .map((r) => normalizeText(r.PARTICIPANTE))
    );
    allowedSet = new Set([...allowedSet].filter((x) => dirAllowed.has(x)));
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
  } else if (active === "facet") {
    renderFacet(document.getElementById("facet-content"), facetAllowed, focusName);
  } else if (active === "carreira") {
    renderCarreira(document.getElementById("carreira-content"), careerAllowed, focusName);
  }
}

boot();
