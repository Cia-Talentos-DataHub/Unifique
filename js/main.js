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
let activeFocus = "";        // "" = todos os permitidos
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

  // Filtro Participante
  const partSelect = document.getElementById("participant-filter");
  partSelect.innerHTML = "";
  if (session.allowedParticipants.length > 1) {
    const all = document.createElement("option");
    all.value = "";
    all.textContent = `Todos (${session.allowedParticipants.length})`;
    partSelect.appendChild(all);
  }
  for (const p of session.allowedParticipants) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    partSelect.appendChild(opt);
  }

  // Default por nível: 1 e 2 = "Todos", 3 = ele mesmo
  if (level === 3 || session.allowedParticipants.length === 1) {
    activeFocus = me;
    partSelect.value = me;
  } else {
    activeFocus = "";
    partSelect.value = "";
  }
  partSelect.addEventListener("change", () => {
    activeFocus = partSelect.value;
    rerenderActiveTab();
  });

  // Filtro Diretor (apenas Acesso 1)
  const dirGroup = document.getElementById("director-filter-group");
  const dirSelect = document.getElementById("director-filter");
  if (level === 1) {
    const diretores = Array.from(
      new Set(
        access
          .map((r) => r.DIRETOR)
          .filter((v) => v && String(v).trim() !== "")
      )
    ).sort((a, b) => a.localeCompare(b, "pt-BR"));
    dirSelect.innerHTML = '<option value="">Todos</option>' +
      diretores.map((d) => `<option value="${d}">${d}</option>`).join("");
    dirGroup.hidden = false;
    dirSelect.addEventListener("change", () => {
      activeDirector = dirSelect.value;
      rerenderActiveTab();
    });
  } else {
    dirGroup.hidden = true;
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
    activeFocus = "";
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
  // 1) restringe pelo nivel (allowedParticipants)
  let allowedSet = new Set(session.allowedParticipants.map(normalizeText));

  // 2) Acesso 1: pode filtrar por diretor adicional
  if (activeDirector) {
    const dirAllowed = new Set(
      access
        .filter((r) => String(r.DIRETOR || "").trim() === activeDirector)
        .map((r) => normalizeText(r.PARTICIPANTE))
    );
    // intersecao
    allowedSet = new Set([...allowedSet].filter((x) => dirAllowed.has(x)));
  }

  // 3) Foco em um participante (se houver)
  if (activeFocus) {
    const focus = normalizeText(activeFocus);
    if (allowedSet.has(focus)) {
      allowedSet = new Set([focus]);
    }
  }

  return {
    interviewsAllowed: interviews.filter((r) => allowedSet.has(normalizeText(r.Participante))),
    facetAllowed: facet.filter((r) => allowedSet.has(normalizeText(r.Participante))),
    careerAllowed: career.filter((r) => allowedSet.has(normalizeText(r.Participante))),
    focusName: activeFocus || null, // null = "todos"
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
