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

  // KPIs
  const kpiRow = document.createElement("div");
  kpiRow.className = "kpi-row";
  const numParticipantes = new Set(records.map((r) => r.Participante)).size;
  const numCompetencias = new Set(records.map((r) => r.Competencia).filter(Boolean)).size;
  const notas = records.map((r) => r.Nota).filter((n) => typeof n === "number");
  const mediaGeral = mean(notas);

  kpiRow.innerHTML = `
    <div class="kpi"><div class="kpi-label">Participantes</div><div class="kpi-value">${formatNumberBR(numParticipantes)}</div></div>
    <div class="kpi"><div class="kpi-label">Competências avaliadas</div><div class="kpi-value">${formatNumberBR(numCompetencias)}</div></div>
    <div class="kpi"><div class="kpi-label">Média geral</div><div class="kpi-value">${mediaGeral === null ? "—" : formatNumberBR(mediaGeral, 2)}</div></div>
    <div class="kpi"><div class="kpi-label">Linhas</div><div class="kpi-value">${formatNumberBR(records.length)}</div></div>
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

  Plotly.newPlot(
    card1.querySelector(".plot-target"),
    [{
      type: "bar",
      x: competencias,
      y: valores,
      marker: { color: UNI_BLUE },
      text: valores.map((v) => v.toFixed(2)),
      textposition: "outside",
      cliponaxis: false,
    }],
    {
      ...PLOT_LAYOUT,
      margin: { l: 60, r: 24, t: 24, b: 120, autoexpand: true },
      xaxis: { automargin: true, tickangle: -25 },
      yaxis: { title: "Nota", range: [0, Math.max(5, ...valores) + 0.8], automargin: true },
    },
    PLOT_CONFIG
  );

  // Modo "todos": gráfico 2 = ranking por participante
  if (!focusName) {
    const card2 = makeCard("Média geral por participante");
    chartRow.appendChild(card2);

    const byPart = new Map();
    for (const r of records) {
      const v = typeof r.Nota === "number" ? r.Nota : (typeof r.MediaCompetencia === "number" ? r.MediaCompetencia : null);
      if (v === null) continue;
      const list = byPart.get(r.Participante) || [];
      list.push(v);
      byPart.set(r.Participante, list);
    }

    const ranking = Array.from(byPart, ([nome, vs]) => ({ nome, m: mean(vs) }))
      .filter((x) => x.m !== null)
      .sort((a, b) => b.m - a.m);

    if (ranking.length) {
      ranking.reverse(); // pra ascending no gráfico horizontal
      // altura dinamica: 32px por barra, minimo 380, max 900
      const heightNeeded = Math.min(900, Math.max(380, ranking.length * 32 + 80));
      const target = card2.querySelector(".plot-target");
      target.style.height = heightNeeded + "px";
      target.style.minHeight = heightNeeded + "px";

      Plotly.newPlot(
        target,
        [{
          type: "bar",
          orientation: "h",
          x: ranking.map((r) => r.m),
          y: ranking.map((r) => r.nome),
          marker: { color: UNI_CYAN },
          text: ranking.map((r) => r.m.toFixed(2)),
          textposition: "outside",
          cliponaxis: false,
        }],
        {
          ...PLOT_LAYOUT,
          margin: { l: 220, r: 60, t: 24, b: 50, autoexpand: true },
          xaxis: { title: "Nota média", automargin: true, range: [0, Math.max(5, ...ranking.map((r) => r.m)) + 0.5] },
          yaxis: { automargin: true },
        },
        PLOT_CONFIG
      );
    }
  }
  container.appendChild(chartRow);

  // Tabela
  if (!focusName) {
    container.appendChild(sectionTitle("Tabela de notas"));
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    const compsList = Array.from(new Set(records.map((r) => r.Competencia).filter(Boolean)));
    const partsList = Array.from(new Set(records.map((r) => r.Participante).filter(Boolean))).sort();
    let html = `<table><thead><tr><th>Participante</th>${compsList.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}<th>Média</th></tr></thead><tbody>`;
    for (const p of partsList) {
      const cells = compsList.map((c) => {
        const r = records.find((x) => x.Participante === p && x.Competencia === c);
        const v = r ? (typeof r.Nota === "number" ? r.Nota : r.MediaCompetencia) : null;
        return `<td>${typeof v === "number" ? v.toFixed(1) : "—"}</td>`;
      });
      const ms = records.filter((x) => x.Participante === p)
        .map((x) => typeof x.Nota === "number" ? x.Nota : x.MediaCompetencia)
        .filter((v) => typeof v === "number");
      const m = mean(ms);
      html += `<tr><td><strong>${escapeHtml(p)}</strong></td>${cells.join("")}<td>${m === null ? "—" : m.toFixed(2)}</td></tr>`;
    }
    html += "</tbody></table>";
    wrap.innerHTML = html;
    container.appendChild(wrap);
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

  // Aviso se Respostas/Conclusoes estão vazias
  const haveAns = records.some((r) => r.Respostas);
  const haveConc = records.some((r) => r.Conclusoes);
  if (!haveAns && !haveConc) {
    const warn = document.createElement("div");
    warn.className = "banner warn";
    warn.textContent = "Esta planilha de Entrevista ainda está com Respostas/Conclusões em branco. As perguntas e indicadores são exibidos abaixo, mas o conteúdo das respostas só vai aparecer depois que a planilha for preenchida.";
    container.appendChild(warn);
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

  for (const [participante, compMap] of byParticipant.entries()) {
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
      const mediaHtml = (typeof media === "number")
        ? `<span class="badge">Média ${media.toFixed(2)}</span>` : "";

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

      // Conclusao geral da competencia (so 1 valor; pega o primeiro nao-nulo)
      const conclusao = rows.map((r) => r.Conclusoes).find((v) => v);
      if (conclusao) {
        const c = document.createElement("div");
        c.className = "entrevista-field";
        c.innerHTML = `<div class="field-label">Conclusões gerais</div><div class="field-value">${escapeHtml(conclusao).replace(/\n/g, "<br>")}</div>`;
        compBlock.appendChild(c);
      }

      // Cada pergunta com sua resposta + nota
      const qBlock = document.createElement("div");
      qBlock.className = "entrevista-questions";
      for (const r of rows) {
        if (!r.Perguntas) continue;
        const q = document.createElement("div");
        q.className = "entrevista-question";
        const note = (typeof r.Nota === "number")
          ? `<span class="badge small">Nota ${r.Nota.toFixed(1)}</span>` : "";
        q.innerHTML = `<div class="q-pergunta">${escapeHtml(r.Perguntas).replace(/\n/g, "<br>")} ${note}</div>` +
          (r.Respostas
            ? `<div class="q-resposta">${escapeHtml(r.Respostas).replace(/\n/g, "<br>")}</div>`
            : `<div class="q-resposta muted">— sem resposta cadastrada —</div>`);
        qBlock.appendChild(q);
      }
      compBlock.appendChild(qBlock);

      block.appendChild(compBlock);
    }

    container.appendChild(block);
  }
  return;

  // (codigo antigo abaixo nao executa mais)
  // eslint-disable-next-line no-unreachable
  for (const [participante, rows] of new Map()) {
    for (const r of rows) {
      const fields = [
        ["Indicadores", r.Indicadores],
        ["Perguntas", r.Perguntas],
        ["Respostas", r.Respostas],
        ["Conclusões gerais", r.Conclusoes],
      ];
      for (const [label, val] of fields) {
        if (!val) continue;
        const div = document.createElement("div");
        div.className = "entrevista-field";
        div.innerHTML = `<div class="field-label">${escapeHtml(label)}</div><div class="field-value">${escapeHtml(val).replace(/\n/g, "<br>")}</div>`;
        item.appendChild(div);
      }

      block.appendChild(item);
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
    Plotly.newPlot(
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

    const grid = document.createElement("div");
    grid.className = "kpi-row";
    for (const f of FACET_FACTORS) {
      const v = r[f];
      const kpi = document.createElement("div");
      kpi.className = "kpi";
      kpi.innerHTML = `<div class="kpi-label">${escapeHtml(f)}</div><div class="kpi-value">${typeof v === "number" ? v.toFixed(1) : "—"}</div>`;
      grid.appendChild(kpi);
    }
    container.appendChild(grid);
    return;
  }

  // Multi: comparativo
  const radar = makeCard(`Comparativo FACET5 (${records.length} participantes)`);
  container.appendChild(radar);
  const traces = records.map((r) => ({
    type: "scatterpolar",
    r: FACET_FACTORS.map((f) => r[f]),
    theta: FACET_FACTORS,
    fill: "toself",
    opacity: 0.35,
    name: r.Participante,
  }));
  Plotly.newPlot(
    radar.querySelector(".plot-target"),
    traces,
    { ...PLOT_LAYOUT, polar: { radialaxis: { visible: true, range: [0, 10] } } },
    PLOT_CONFIG
  );

  // Médias dos 5 fatores
  const meansRow = document.createElement("div");
  meansRow.className = "kpi-row";
  for (const f of FACET_FACTORS) {
    const m = mean(records.map((r) => r[f]));
    const kpi = document.createElement("div");
    kpi.className = "kpi";
    kpi.innerHTML = `<div class="kpi-label">Média de ${escapeHtml(f)}</div><div class="kpi-value">${m === null ? "—" : m.toFixed(2)}</div>`;
    meansRow.appendChild(kpi);
  }
  container.appendChild(meansRow);

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
