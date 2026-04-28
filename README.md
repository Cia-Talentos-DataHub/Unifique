# Assessment Unifique — Dashboard Web

App estático servido pelo **GitHub Pages** que mostra:
- Notas de competências da entrevista (gráfico + tabela)
- Texto da entrevista (perguntas, respostas, conclusões)
- Resultados FACET5 (perfil, família e notas dos 5 fatores)
- Respostas do Questionário de Carreira

Login por **PARTICIPANTE** com 3 níveis:
- **Acesso 1**: vê todos.
- **Acesso 2**: vê os participantes da própria equipe (mesma DIRETORIA).
- **Acesso 3**: vê só o próprio relatório.

## Estrutura

```
web/
├── index.html
├── css/style.css
├── js/
│   ├── main.js          (orquestração)
│   ├── data.js          (carrega JSONs)
│   ├── auth.js          (login PBKDF2)
│   ├── access.js        (filtros por nível 1/2/3)
│   ├── charts.js        (4 abas: Competências, Entrevista, FACET5, Carreira)
│   └── utils.js         (normalize, fuzzy match, helpers)
├── data/                (gerado pelo build — JSONs)
│   ├── access.json      (com senhas hasheadas)
│   ├── interviews.json
│   ├── facet.json
│   ├── career.json
│   └── manifest.json
└── scripts/
    ├── pdf_to_xlsx.py   (PDFs FACET5 + XLSX Questionário → 2 xlsx consolidados)
    └── build.py         (todos os xlsx → JSONs em data/)
```

## Fluxo para atualizar dados

```
1. Baixe do SharePoint para a pasta C&D/:
   - Participantes - Assessment - com diretores.xlsx     (aba Acessos)
   - Planilha_Entrevistas_Competências POWER BI COMPLETO.xlsx  (aba Entrevistas)

2. Baixe a pasta inteira de PDFs FACET5 para:
   C&D/pdfs_facet5/

3. Baixe a pasta inteira de XLSX Questionários de Carreira para:
   C&D/questionarios_carreira/

4. Rode os 2 scripts (na pasta web/scripts):

   python pdf_to_xlsx.py --facet ../../pdfs_facet5 --career ../../questionarios_carreira
   python build.py

5. git add data/ ; git commit -m "atualiza dados" ; git push
```

## Rodar localmente

```
cd web
python -m http.server 8000
# abrir http://localhost:8000
```

(Não funciona via `file://` — fetch + módulos ES6 exigem servidor.)

## Decisões técnicas

- **PBKDF2-SHA256, 200k iterações + salt** nas senhas (não trafegam em texto claro nos JSONs).
- **Plotly.js via CDN** para gráficos.
- **Fuzzy matching** (Jaccard de tokens) entre nomes de participantes nas várias fontes — tolera variações de espaço/acento; limiar de aceitação 0,5.
- **Parser de PDF FACET5** via `pdftotext -layout` (poppler) → regex. Layout consistente (todos os relatórios da Facet5 são iguais).
- **Questionários de Carreira** vêm em XLSX (1 arquivo por participante, formato pergunta-em-coluna), consolidados em formato long.

## Atenção — dados sensíveis e repo público

Os JSONs em `data/` (especialmente `interviews.json`, `facet.json`, `career.json`) contêm informações pessoais de assessment.
**Em repo público qualquer pessoa com a URL pode baixar tudo isso.** O sistema de senha protege apenas a UI, não os dados em si.

Para uso real, recomendo migrar para **repo privado** com Pages privado (plano pago do GitHub) ou para uma fonte autenticada (SharePoint via MSAL/Graph). O stub de SharePoint está comentado em `js/data.js`.
