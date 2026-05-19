// charts.js — renderiza as 4 abas: Competências, Entrevista, FACET5, Questionário

import {
  normalizeText,
  findBestMatch,
  mean,
  formatNumberBR,
  escapeHtml,
} from "./utils.js";

const PLOT_LAYOUT = {
  margin: { l: 60, r: 24, t: 24, b: 60, autoexpand: true },
  font: { family: "Manrope, system-ui, sans-serif", size: 12, color: "#1F1B8E" },
  paper_bgcolor: "white",
  plot_bgcolor: "white",
  colorway: ["#1F1B8E", "#00B7F5", "#80D8C2", "#F1E08A", "#76DAFF"],
};
const PLOT_CONFIG = { responsive: true, displaylogo: false };
const UNI_BLUE = "#1F1B8E";
const UNI_CYAN = "#00B7F5";
const UNI_GREEN = "#80D8C2";

/**
 * Wrapper para Plotly que garante redimensionamento correto:
 * 1. Renderiza o gráfico
 * 2. Após o layout estabilizar, força um resize
 * 3. Observa mudanças do container (ex: zoom, redimensionar janela) e replica
 */
function plotResponsive(target, traces, layout, config = PLOT_CONFIG) {
  Plotly.newPlot(target, traces, layout, config);
  // primeiro frame: força resize já que o tamanho real do container só é
  // estável depois que o navegador termina o layout pass.
  requestAnimationFrame(() => {
    try { Plotly.Plots.resize(target); } catch {}
  });
  // observador de mudanças (zoom, sidebar abrindo, etc.)
  if (window.ResizeObserver && !target.__ro__) {
    const ro = new ResizeObserver(() => {
      try { Plotly.Plots.resize(target); } catch {}
    });
    ro.observe(target);
    target.__ro__ = ro;
  }
}

const FACET_FACTORS = [
  "Determinação",
  "Energia",
  "Afetividade",
  "Controle",
  "Emocionalidade",
];

function infoMsg(container, text) {
  const div = document.createElement("div");
  div.className = "info-msg";
  div.textContent = text;
  container.appendChild(div);
}

function makeCard(title) {
  const el = document.createElement("div");
  el.className = "chart-card";
  el.innerHTML = `<h3>${escapeHtml(title)}</h3><div class="plot-target"></div>`;
  return el;
}

function sectionTitle(text) {
  const el = document.createElement("h3");
  el.className = "section-title";
  el.textContent = text;
  return el;
}

// ===========================================================
// Aba Competências
// ===========================================================
export function renderCompetencias(container, interviews, focusName) {
  container.innerHTML = "";

  const records = focusName
    ? interviews.filter((r) => normalizeText(r.Participante) === normalizeText(focusName))
    : interviews;

  if (!records.length) {
    infoMsg(container, "Sem dados de entrevista para os filtros atuais.");
    return;
  }

  // KPI único: Participantes
  const kpiRow = document.createElement("div");
  kpiRow.className = "kpi-row";
  const numParticipantes = new Set(records.map((r) => r.Participante)).size;
  kpiRow.innerHTML = `
    <div class="kpi"><div class="kpi-label">Participantes</div><div class="kpi-value">${formatNumberBR(numParticipantes)}</div></div>
  `;
  container.appendChild(kpiRow);

  const haveNotes = records.some((r) => typeof r.Nota === "number");
  const haveAverages = records.some((r) => typeof r.MediaCompetencia === "number");

  if (!haveNotes && !haveAverages) {
    container.appendChild(sectionTitle("Competências avaliadas"));
    const list = document.createElement("ul");
    list.className = "info-list";
    for (const c of new Set(records.map((r) => r.Competencia).filter(Boolean))) {
      const li = document.createElement("li");
      li.textContent = c;
      list.appendChild(li);
    }
    container.appendChild(list);
    infoMsg(container, "A planilha de Entrevistas ainda não tem notas preenchidas.");
    return;
  }

  // Gráfico 1: barras (média por competência) - sempre util, modo "todos" ou "1 pessoa"
  const chartRow = document.createElement("div");
  chartRow.className = "chart-row";

  const card1 = makeCard(focusName ? `Notas por competência — ${focusName}` : "Média por competência");
  chartRow.appendChild(card1);

  const byComp = new Map();
  for (const r of records) {
    if (!r.Competencia) continue;
    const list = byComp.get(r.Competencia) || [];
    const v = typeof r.Nota === "number" ? r.Nota : (typeof r.MediaCompetencia === "number" ? r.MediaCompetencia : null);
    if (v !== null) list.push(v);
    byComp.set(r.Competencia, list);
  }

  const competencias = Array.from(byComp.keys());
  const valores = competencias.map((c) => mean(byComp.get(c)) ?? 0);

  plotResponsive(
    card1.querySelector(".plot-target"),
    [{
      type: "bar",
      x: competencias,
      y: valores,
      marker: { color: UNI_BLUE },
      text: valores.map((v) => v.toFixed(2)),
      textposition: "outside",
      cliponaxis: false,
      hovertemplate: "<b>%{x}</b><br>Média: %{y:.2f}<extra></extra>",
    }],
    {
      ...PLOT_LAYOUT,
      margin: { l: 60, r: 24, t: 24, b: 120, autoexpand: true },
      xaxis: { automargin: true, tickangle: 0 },
      yaxis: { title: "Nota", range: [0, Math.max(5, ...valores) + 0.8], automargin: true },
    },
    PLOT_CONFIG
  );

  container.appendChild(chartRow);

  // Modo "todos": gráfico comparativo + tabela com ordenação
  if (!focusName) {
    const partsList = Array.from(new Set(records.map((r) => r.Participante).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, "pt-BR"));

    // Helper que calcula a média da pessoa naquela competência
    const noteOf = (p, c) => {
      const rs = records.filter((r) => r.Participante === p && r.Competencia === c);
      let v = rs.find((x) => typeof x.MediaCompetencia === "number")?.MediaCompetencia;
      if (typeof v !== "number") {
        const notas = rs.map((x) => x.Nota).filter((n) => typeof n === "number");
        v = notas.length ? mean(notas) : null;
      }
      return v;
    };

    // Controle de ordenação
    const sortBar = document.createElement("div");
    sortBar.className = "sort-bar";
    const compOpts = competencias.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    sortBar.innerHTML = `
      <label>Ordenar por:</label>
      <select id="sort-comp"><option value="">Alfabética</option>${compOpts}</select>
      <select id="sort-dir">
        <option value="desc">Maior → menor</option>
        <option value="asc">Menor → maior</option>
      </select>
    `;
    container.appendChild(sortBar);

    // Container do gráfico
    const card2 = makeCard("Comparativo por participante");
    const chartRow2 = document.createElement("div");
    chartRow2.className = "chart-row";
    chartRow2.appendChild(card2);
    container.appendChild(chartRow2);

    container.appendChild(sectionTitle("Tabela de notas"));
    const tableWrap = document.createElement("div");
    tableWrap.className = "table-wrap";
    container.appendChild(tableWrap);

    // Gera cor única por participante via HSL distribuído em 360°
    const COLORS = partsList.map((_, i) => {
      const hue = Math.round((i * 360) / partsList.length);
      return `hsl(${hue}, 70%, 45%)`;
    });

    const target = card2.querySelector(".plot-target");
    const h = Math.min(700, Math.max(420, 380 + Math.ceil(partsList.length / 4) * 22));
    target.style.height = h + "px";
    target.style.minHeight = h + "px";

    function renderComparativo() {
      const sortComp = document.getElementById("sort-comp").value;
      const sortDir = document.getElementById("sort-dir").value; // asc | desc

      // Ordena a lista de participantes
      let ordered = [...partsList];
      if (sortComp) {
        ordered.sort((a, b) => {
          const va = noteOf(a, sortComp);
          const vb = noteOf(b, sortComp);
          const aVal = va === null ? -Infinity : va;
          const bVal = vb === null ? -Infinity : vb;
          return sortDir === "desc" ? bVal - aVal : aVal - bVal;
        });
      }

      // Mapeia cor preservando uma cor por nome (sem cambiar quando reordena)
      const colorByName = new Map(partsList.map((n, i) => [n, COLORS[i]]));

      // Se ordenando por competência específica: mostra só essa competência no x.
      // Caso contrário (alfabética): mostra todas.
      const xCols = sortComp ? [sortComp] : competencias;

      const traces = ordered.map((p) => {
        const ys = xCols.map((c) => noteOf(p, c));
        return {
          type: "bar",
          name: p,
          x: xCols,
          y: ys,
          marker: { color: colorByName.get(p) },
          text: ys.map((v) => v === null ? "" : v.toFixed(1)),
          textposition: "outside",
          textfont: { size: 10 },
          cliponaxis: false,
          hovertemplate: "<b>%{x}</b><br>" + escapeHtml(p) + ": %{y:.2f}<extra></extra>",
        };
      });

      const legendRows = Math.ceil(ordered.length / 4);
      const legendBottomSpace = 50 + legendRows * 22;
      plotResponsive(
        target,
        traces,
        {
          ...PLOT_LAYOUT,
          barmode: "group",
          margin: { l: 60, r: 24, t: 24, b: legendBottomSpace, autoexpand: true },
          xaxis: { automargin: true, tickangle: 0 },
          yaxis: { title: "Nota", range: [0, 10], automargin: true },
          legend: { orientation: "h", y: -0.25, x: 0, xanchor: "left", yanchor: "top", font: { size: 11 } },
        },
        PLOT_CONFIG
      );

      // Tabela: mesmas colunas que o gráfico
      let html = `<table><thead><tr><th>Participante</th>${xCols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead><tbody>`;
      for (const p of ordered) {
        const cells = xCols.map((c) => {
          const v = noteOf(p, c);
          return `<td>${typeof v === "number" ? v.toFixed(1) : "—"}</td>`;
        });
        html += `<tr><td><strong>${escapeHtml(p)}</strong></td>${cells.join("")}</tr>`;
      }
      html += "</tbody></table>";
      tableWrap.innerHTML = html;
    }

    sortBar.querySelector("#sort-comp").addEventListener("change", renderComparativo);
    sortBar.querySelector("#sort-dir").addEventListener("change", renderComparativo);
    renderComparativo();
  }
}

// ===========================================================
// Aba Entrevista
// ===========================================================
export function renderEntrevista(container, interviews, focusName, competencyFilter) {
  container.innerHTML = "";

  let records = interviews;
  if (focusName) {
    records = records.filter((r) => normalizeText(r.Participante) === normalizeText(focusName));
  }
  if (competencyFilter) {
    records = records.filter((r) => r.Competencia === competencyFilter);
  }

  if (!records.length) {
    infoMsg(container, "Sem entrevistas para os filtros atuais.");
    return;
  }

  // Agrupa por participante > competencia > [linhas com perguntas/respostas/notas]
  const byParticipant = new Map();
  for (const r of records) {
    if (!byParticipant.has(r.Participante)) byParticipant.set(r.Participante, new Map());
    const compMap = byParticipant.get(r.Participante);
    const key = r.Competencia || "—";
    if (!compMap.has(key)) compMap.set(key, []);
    compMap.get(key).push(r);
  }

  // Ordena participantes alfabeticamente (mesma ordem do filtro de Pessoas)
  const orderedNames = Array.from(byParticipant.keys())
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  for (const participante of orderedNames) {
    const compMap = byParticipant.get(participante);
    const block = document.createElement("div");
    block.className = "entrevista-block";

    const header = document.createElement("h3");
    header.className = "section-title";
    header.textContent = participante;
    const sample = compMap.values().next().value?.[0];
    if (sample?.Diretoria) {
      const dir = document.createElement("span");
      dir.className = "subtle";
      dir.textContent = ` • ${sample.Diretoria}`;
      header.appendChild(dir);
    }
    block.appendChild(header);

    for (const [competencia, rows] of compMap.entries()) {
      const compBlock = document.createElement("div");
      compBlock.className = "entrevista-item";

      const first = rows[0];
      const media = first?.MediaCompetencia;
      let mediaHtml = "";
      if (typeof media === "number") {
        const lvl = mapMediaToLevel(media);
        const color = lvl ? LEVEL_INFO[lvl].color : "#9CA3AF";
        mediaHtml = `<span class="badge" style="background:${color}">Média ${media.toFixed(2)}</span>`;
      }

      const title = document.createElement("div");
      title.className = "entrevista-comp";
      title.innerHTML = `<strong>${escapeHtml(competencia)}</strong>${mediaHtml}`;
      compBlock.appendChild(title);

      if (first?.Descricao) {
        const desc = document.createElement("p");
        desc.className = "entrevista-text muted";
        desc.textContent = first.Descricao;
        compBlock.appendChild(desc);
      }
      if (first?.Indicadores) {
        const ind = document.createElement("div");
        ind.className = "entrevista-field";
        ind.innerHTML = `<div class="field-label">Indicadores</div><div class="field-value">${escapeHtml(first.Indicadores).replace(/\n/g, "<br>")}</div>`;
        compBlock.appendChild(ind);
      }

      // Conclusões gerais sobre o participante (por competência)
      const conclusao = rows.map((r) => r.Conclusoes).find((v) => v);
      const c = document.createElement("div");
      c.className = "entrevista-field";
      if (conclusao) {
        c.innerHTML = `<div class="field-label">Conclusões gerais sobre o participante</div><div class="field-value">${escapeHtml(conclusao).replace(/\n/g, "<br>")}</div>`;
      } else {
        c.innerHTML = `<div class="field-label">Conclusões gerais sobre o participante</div><div class="field-value muted">— ainda sem conclusões registradas —</div>`;
      }
      compBlock.appendChild(c);

      block.appendChild(compBlock);
    }

    container.appendChild(block);
  }
}

// ===========================================================
// Aba Desenvolvimento — Cardápio de Ações por competência baseado na média
// ===========================================================

// Faixas oficiais da escala de avaliação (4 níveis):
//   1,00 — 1,75  → Abaixo do esperado
//   1,76 — 2,51  → Atende parcialmente
//   2,52 — 3,27  → Atende plenamente
//   3,28 — 4,00  → Supera o padrão esperado
//
// O cardápio de ações agrupa "Abaixo" e "Atende parcialmente" em uma só
// coluna (3 níveis na planilha), mas a legenda mostrada ao usuário é a do
// nível real (4 níveis).

const LEVEL_INFO = {
  abaixo: {
    label: "Abaixo do esperado",
    color: "#DC2626",
    bucket: "abaixo_atende_parcialmente",
  },
  parcialmente: {
    label: "Atende parcialmente",
    color: "#F59E0B",
    bucket: "abaixo_atende_parcialmente",
  },
  plenamente: {
    label: "Atende plenamente",
    color: "#10B981",
    bucket: "atende_plenamente",
  },
  supera: {
    label: "Supera o padrão esperado",
    color: "#1F1B8E",
    bucket: "supera",
  },
};

/** Mapeia média numérica para um dos 4 níveis. NÃO arredonda a média. */
function mapMediaToLevel(media) {
  if (typeof media !== "number" || Number.isNaN(media)) return null;
  if (media <= 1.75) return "abaixo";
  if (media <= 2.51) return "parcialmente";
  if (media <= 3.27) return "plenamente";
  return "supera";
}

export function renderDesenvolvimento(container, interviews, actions, focusName) {
  container.innerHTML = "";

  if (!actions || !Object.keys(actions).length) {
    infoMsg(container, "Cardápio de Ações de Desenvolvimento ainda não foi carregado.");
    return;
  }

  let records = interviews;
  if (focusName) {
    records = records.filter((r) => normalizeText(r.Participante) === normalizeText(focusName));
  }
  if (!records.length) {
    infoMsg(container, "Sem dados de entrevista para os filtros atuais.");
    return;
  }

  // Agrupa por participante > competencia (pega a media unica por competencia)
  const byParticipant = new Map();
  for (const r of records) {
    if (!r.Competencia) continue;
    if (!byParticipant.has(r.Participante)) byParticipant.set(r.Participante, new Map());
    const compMap = byParticipant.get(r.Participante);
    if (!compMap.has(r.Competencia)) {
      compMap.set(r.Competencia, {
        media: typeof r.MediaCompetencia === "number" ? r.MediaCompetencia : null,
        notas: [],
      });
    }
    if (typeof r.Nota === "number") compMap.get(r.Competencia).notas.push(r.Nota);
  }

  // Se nao houver media salva, calcula a partir das notas individuais
  for (const compMap of byParticipant.values()) {
    for (const data of compMap.values()) {
      if (data.media === null && data.notas.length) data.media = mean(data.notas);
    }
  }

  for (const [participante, compMap] of byParticipant.entries()) {
    const block = document.createElement("div");
    block.className = "entrevista-block";

    const header = document.createElement("h3");
    header.className = "section-title";
    header.textContent = participante;
    block.appendChild(header);

    for (const [competencia, data] of compMap.entries()) {
      const compBlock = document.createElement("div");
      compBlock.className = "entrevista-item";

      const level = mapMediaToLevel(data.media);
      const mediaTxt = data.media === null ? "—" : data.media.toFixed(2).replace(".", ",");
      const levelLbl = level ? LEVEL_INFO[level].label : "Sem média ainda";
      const levelColor = level ? LEVEL_INFO[level].color : "#9CA3AF";

      const title = document.createElement("div");
      title.className = "entrevista-comp";
      title.innerHTML = `<strong>${escapeHtml(competencia)}</strong>` +
        `<span class="badge" style="background:${levelColor}">Média ${escapeHtml(mediaTxt)} · ${escapeHtml(levelLbl)}</span>`;
      compBlock.appendChild(title);

      const compMeta = actions[competencia];
      if (!compMeta) {
        const warn = document.createElement("div");
        warn.className = "info-msg";
        warn.textContent = `Competência "${competencia}" não está mapeada no cardápio.`;
        compBlock.appendChild(warn);
        block.appendChild(compBlock);
        continue;
      }

      if (!level) {
        const m = document.createElement("div");
        m.className = "info-msg";
        m.textContent = "A média desta competência ainda não foi registrada — sem sugestão de desenvolvimento por enquanto.";
        compBlock.appendChild(m);
        block.appendChild(compBlock);
        continue;
      }

      const bucket = LEVEL_INFO[level].bucket;
      const blk = compMeta.niveis[bucket] || {};
      const cardsRow = document.createElement("div");
      cardsRow.className = "actions-cards";

      const order = ["Como Desenvolver", "Como ir Além", "Materiais de Apoio"];
      for (const k of order) {
        const v = blk[k];
        const card = document.createElement("div");
        card.className = "action-card";
        card.innerHTML = `<div class="action-card-title">${escapeHtml(k)}</div>` +
          (v
            ? `<div class="action-card-body">${escapeHtml(v).replace(/\n/g, "<br>")}</div>`
            : `<div class="action-card-body muted">— sem conteúdo cadastrado —</div>`);
        cardsRow.appendChild(card);
      }
      compBlock.appendChild(cardsRow);
      block.appendChild(compBlock);
    }
    container.appendChild(block);
  }
}

// ===========================================================
// Aba FACET5
// ===========================================================
export function renderFacet(container, facetRecords, focusName) {
  container.innerHTML = "";

  if (!facetRecords.length) {
    infoMsg(container, "Os relatórios FACET5 ainda não foram processados. Rode scripts/pdf_to_xlsx.py e em seguida scripts/build.py.");
    return;
  }

  // Foco em 1 participante: usa fuzzy match
  const records = focusName
    ? [findBestMatch(focusName, facetRecords, (r) => r.Participante).rec].filter(Boolean)
    : facetRecords;

  if (!records.length) {
    infoMsg(container, `Não encontrei o relatório FACET5 para "${focusName}".`);
    return;
  }

  if (records.length === 1) {
    const r = records[0];
    const card = document.createElement("div");
    card.className = "facet-summary";
    card.innerHTML = `
      <div class="facet-header">
        <div>
          <h3>${escapeHtml(r.Participante)}</h3>
          <p class="muted">Família de Referência: <strong>${escapeHtml(r.Familia || "—")}</strong></p>
        </div>
      </div>
      ${r.Perfil ? `<div class="facet-perfil"><h4>Perfil (Quadro Geral)</h4><ul>${
        r.Perfil.split("|").map((b) => `<li>${escapeHtml(b.trim())}</li>`).join("")
      }</ul></div>` : ""}
    `;
    container.appendChild(card);

    const radar = makeCard("Perfil dos 5 fatores");
    container.appendChild(radar);
    plotResponsive(
      radar.querySelector(".plot-target"),
      [{
        type: "scatterpolar",
        r: FACET_FACTORS.map((f) => r[f]),
        theta: FACET_FACTORS,
        fill: "toself",
        marker: { color: UNI_BLUE },
        line: { color: UNI_BLUE },
        name: r.Participante,
      }],
      { ...PLOT_LAYOUT, polar: { radialaxis: { visible: true, range: [0, 10] } } },
      PLOT_CONFIG
    );

    // KPIs dos 5 fatores com descricao individual abaixo
    const grid = document.createElement("div");
    grid.className = "facet-factors-grid";
    for (const f of FACET_FACTORS) {
      const v = r[f];
      const desc = r[`${f}_desc`];
      const card = document.createElement("div");
      card.className = "facet-factor-card";
      card.innerHTML = `
        <div class="facet-factor-head">
          <span class="facet-factor-name">${escapeHtml(f)}</span>
          <span class="facet-factor-score">${typeof v === "number" ? v.toFixed(1) : "—"}</span>
        </div>
        <div class="facet-factor-desc">${desc ? escapeHtml(desc) : "<span class='muted'>— sem descrição extraída deste PDF —</span>"}</div>
      `;
      grid.appendChild(card);
    }
    container.appendChild(grid);
    return;
  }

  // Multi: radar comparativo + tabela. Sem KPIs de "média" porque não faz sentido
  // misturar pontuações de participantes diferentes em uma média única.
  const radar = makeCard(`Comparativo FACET5 (${records.length} participantes)`);
  // Altura maior pra acomodar legenda com muitos nomes
  const radarTarget = radar.querySelector(".plot-target");
  const h = Math.min(720, Math.max(440, 400 + Math.ceil(records.length / 3) * 18));
  radarTarget.style.height = h + "px";
  radarTarget.style.minHeight = h + "px";
  container.appendChild(radar);

  const RADAR_PALETTE = [
    "#1F1B8E", "#00B7F5", "#10B981", "#F59E0B", "#DC2626",
    "#7C3AED", "#0EA5E9", "#16A34A", "#EA580C", "#DB2777",
    "#0891B2", "#84CC16", "#F97316", "#9333EA", "#0284C7",
    "#65A30D", "#EF4444", "#A21CAF", "#0D9488", "#CA8A04",
    "#1D4ED8", "#059669", "#B91C1C", "#6D28D9", "#0E7490",
  ];
  const traces = records.map((r, idx) => {
    const color = RADAR_PALETTE[idx % RADAR_PALETTE.length];
    return {
      type: "scatterpolar",
      r: FACET_FACTORS.map((f) => r[f]),
      theta: FACET_FACTORS,
      fill: "toself",
      fillcolor: color + "26", // ~15% alpha (hex 26 = 38/255)
      opacity: 0.85,
      line: { color, width: 2 },
      marker: { color, size: 6 },
      name: r.Participante,
    };
  });
  plotResponsive(
    radarTarget,
    traces,
    {
      ...PLOT_LAYOUT,
      polar: { radialaxis: { visible: true, range: [0, 10] } },
      legend: { orientation: "v", x: 1.05, xanchor: "left", y: 1, yanchor: "top", font: { size: 11 } },
    },
    PLOT_CONFIG
  );

  // Tabela
  const wrap = document.createElement("div");
  wrap.className = "table-wrap";
  const cols = ["Participante", "Familia", ...FACET_FACTORS];
  let html = `<table><thead><tr>${cols.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead><tbody>`;
  for (const r of records) {
    html += "<tr>" + cols.map((c) => {
      const v = r[c];
      const fmt = typeof v === "number" ? v.toFixed(1) : (v ?? "—");
      return `<td>${escapeHtml(fmt)}</td>`;
    }).join("") + "</tr>";
  }
  html += "</tbody></table>";
  wrap.innerHTML = html;
  container.appendChild(wrap);
}

// ===========================================================
// Aba Questionário de Carreira
// ===========================================================
export function renderCarreira(container, careerRecords, focusName) {
  container.innerHTML = "";

  if (!careerRecords.length) {
    infoMsg(container, "Os Questionários de Carreira ainda não foram processados.");
    return;
  }

  // Coleta os participantes que aparecem nos dados ja filtrados (allowed)
  const participantesNaBase = Array.from(new Set(careerRecords.map((r) => r.Participante)));

  let participantes;
  if (focusName) {
    // resolve via fuzzy
    const m = findBestMatch(focusName, careerRecords, (r) => r.Participante);
    participantes = m.rec ? [m.rec.Participante] : [];
  } else {
    participantes = participantesNaBase;
  }

  if (!participantes.length) {
    infoMsg(container, focusName
      ? `Não encontrei questionário para "${focusName}".`
      : "Nenhum questionário disponível para os filtros atuais.");
    return;
  }

  for (const p of participantes) {
    const rows = careerRecords.filter((r) => r.Participante === p);
    if (!rows.length) continue;

    const block = document.createElement("div");
    block.className = "carreira-block";

    const header = document.createElement("h3");
    header.className = "section-title";
    header.textContent = p;
    block.appendChild(header);

    for (const r of rows) {
      const div = document.createElement("div");
      div.className = "carreira-item";
      div.innerHTML = `
        <div class="field-label">${escapeHtml(r.Pergunta)}</div>
        <div class="field-value">${escapeHtml(r.Resposta).replace(/\n/g, "<br>")}</div>
      `;
      block.appendChild(div);
    }

    container.appendChild(block);
  }
}
