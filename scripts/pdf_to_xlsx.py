"""
Automacao que consolida os arquivos do SharePoint em dois Excels que o build.py consome:
  - PDFs FACET5 (1 por participante)               ->  facet.xlsx
  - XLSX Questionario de Carreira (1 por pessoa)   ->  questionarios.xlsx

Por padrao procura tudo dentro da pasta:
    C:/Users/lucas moreira/OneDrive - Grupo Cia de Talentos/Transferencia 2026/
    Materiais/Estudos e Projetos/C&D

Uso:
    python pdf_to_xlsx.py
        (auto-discovery: procura PDFs FACET5 e XLSX de questionarios em qualquer
         subpasta dentro do projeto)

    python pdf_to_xlsx.py --facet ./pdfs_facet5 --career ./questionarios_carreira
        (sobrescreve as pastas)

Dependencias:
    pip install pandas openpyxl pdfplumber
    Recomendado: poppler-utils no sistema (pdftotext) - Windows: choco install poppler.
"""

from __future__ import annotations

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

try:
    import pdfplumber
except ImportError:
    pdfplumber = None

import pandas as pd


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
DEFAULT_ROOT = PROJECT_DIR.parent
DEFAULT_OUTPUT_DIR = DEFAULT_ROOT

FACET_FACTORS = [
    "Determinação",
    "Energia",
    "Afetividade",
    "Controle",
    "Emocionalidade",
]

RE_FACTOR = re.compile(
    r"(Determinação|Energia|Afetividade|Controle|Emocionalidade)\s*:?\s+(\d+(?:[,\.]\d+)?)\b",
    re.IGNORECASE,
)
RE_FAMILY = re.compile(r"Família de Referência\s*:\s*(.+)", re.IGNORECASE)


SKIP_DIR_NAMES = {".git", "node_modules", "__pycache__", "data", "scripts", "css", "js", "web"}


def is_facet_pdf(path: Path) -> bool:
    return path.suffix.lower() == ".pdf" and "facet" in path.name.lower()


def is_career_xlsx(path: Path) -> bool:
    if path.suffix.lower() not in (".xlsx", ".xlsm"):
        return False
    parents_path = " ".join(p.name.lower() for p in path.parents)
    if "questionario" in parents_path or "carreira" in parents_path:
        return True
    return False


def is_career_xlsx_deep(path: Path) -> bool:
    try:
        xls = pd.ExcelFile(path)
        for s in xls.sheet_names:
            if "quest" in s.lower() and "carreira" in s.lower():
                return True
    except Exception:
        pass
    return False


def discover_files(root: Path) -> Tuple[List[Path], List[Path]]:
    facet_pdfs: List[Path] = []
    career_xlsxs: List[Path] = []
    skip_xlsx_names = {
        "acessos.xlsx",
        "entrevistas.xlsx",
        "facet.xlsx",
        "questionarios.xlsx",
        "participantes - assessment - com diretores.xlsx",
    }

    candidates_for_deep_check: List[Path] = []

    for p in root.rglob("*"):
        if any(part.lower() in SKIP_DIR_NAMES for part in p.parts):
            continue
        if not p.is_file():
            continue
        if is_facet_pdf(p):
            facet_pdfs.append(p)
        elif p.suffix.lower() in (".xlsx", ".xlsm"):
            if p.name.lower() in skip_xlsx_names:
                continue
            if "entrevistas" in p.name.lower() or "competencias" in p.name.lower():
                continue
            if is_career_xlsx(p):
                career_xlsxs.append(p)
            else:
                candidates_for_deep_check.append(p)

    for p in candidates_for_deep_check:
        if is_career_xlsx_deep(p):
            career_xlsxs.append(p)

    return sorted(set(facet_pdfs)), sorted(set(career_xlsxs))


def extract_pdf_text(pdf_path: Path) -> str:
    if shutil.which("pdftotext"):
        result = subprocess.run(
            ["pdftotext", "-layout", str(pdf_path), "-"],
            capture_output=True, text=True, check=False,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout

    if pdfplumber is None:
        raise RuntimeError(
            "Nem pdftotext (poppler-utils) nem pdfplumber estao disponiveis. "
            "Instale um deles:\n"
            "  Windows: choco install poppler  ou  pip install pdfplumber\n"
            "  Linux:   apt install poppler-utils"
        )
    parts = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            t = page.extract_text(x_tolerance=2) or ""
            parts.append(t)
    return "\n".join(parts)


def parse_facet_pdf(pdf_path: Path) -> Optional[Dict]:
    text = extract_pdf_text(pdf_path)
    if not text.strip():
        return None

    name = None
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    for i, line in enumerate(lines):
        if line.lower().startswith("perfil pessoal"):
            for j in range(i + 1, min(i + 4, len(lines))):
                cand = lines[j].strip()
                if cand and ":" not in cand and not any(c.isdigit() for c in cand):
                    name = cand
                    break
            if name:
                break

    if not name:
        m = re.search(r"-([A-Za-z][A-Za-z]+)-([A-Za-z][A-Za-zÀ-ÿ]+)\.pdf$", pdf_path.name)
        if m:
            name = f"{m.group(1)} {m.group(2)}"

    family = None
    m = RE_FAMILY.search(text)
    if m:
        family = re.split(r"\s{2,}|\n", m.group(1).strip())[0].strip()

    factor_scores: Dict[str, Optional[float]] = {f: None for f in FACET_FACTORS}
    for m in RE_FACTOR.finditer(text):
        f = m.group(1)
        for canon in FACET_FACTORS:
            if f.lower() == canon.lower():
                f = canon
                break
        score = float(m.group(2).replace(",", "."))
        if factor_scores[f] is None:
            factor_scores[f] = score

    quadro_geral = None
    if "Quadro Geral" in text:
        chunk = text.split("Quadro Geral", 1)[1].split("Como líder", 1)[0]
        bullets = re.findall(r"•\s*([^\n•]+)", chunk)
        if bullets:
            quadro_geral = " | ".join(b.strip() for b in bullets if b.strip())

    return {
        "Participante": name,
        "Familia": family,
        "Perfil": quadro_geral,
        **factor_scores,
        "_arquivo": pdf_path.name,
    }


CAREER_SHEET_CANDIDATES = ["Quest Carreira", "Questionário de Carreira", "Questionario", "Sheet1", "Planilha1"]
CAREER_NAME_HINTS = ["nome completo", "nome"]


def parse_career_xlsx(xlsx_path: Path) -> List[Dict]:
    xls = pd.ExcelFile(xlsx_path)
    sheet = None
    norm_to_orig = {s.strip().lower(): s for s in xls.sheet_names}
    for c in CAREER_SHEET_CANDIDATES:
        if c.lower() in norm_to_orig:
            sheet = norm_to_orig[c.lower()]
            break
    if sheet is None:
        sheet = xls.sheet_names[0]

    df = pd.read_excel(xlsx_path, sheet_name=sheet)
    if df.empty:
        return []

    row = None
    for _, r in df.iterrows():
        if r.notna().sum() > 1:
            row = r
            break
    if row is None:
        return []

    name = None
    for col in df.columns:
        col_l = str(col).lower()
        if any(h in col_l for h in CAREER_NAME_HINTS):
            v = row.get(col)
            if pd.notna(v):
                name = str(v).strip()
                break
    if not name:
        name = xlsx_path.stem

    rows = []
    for col in df.columns:
        question = str(col).strip()
        if not question or question.lower().startswith("unnamed"):
            continue
        v = row.get(col)
        answer = "" if pd.isna(v) else str(v).strip()
        if not answer:
            continue
        rows.append({"Participante": name, "Pergunta": question, "Resposta": answer})
    return rows


def process_facet_files(pdfs: List[Path]) -> pd.DataFrame:
    rows = []
    print(f"   {len(pdfs)} PDFs FACET5 encontrados")
    for pdf in pdfs:
        try:
            rec = parse_facet_pdf(pdf)
            if rec:
                rows.append(rec)
                print(f"   OK  {pdf.name}  ->  {rec['Participante']} | "
                      f"{rec.get('Familia')} | "
                      + ", ".join(f"{f}={rec[f]}" for f in FACET_FACTORS))
            else:
                print(f"   --  {pdf.name}  (sem texto extraido)")
        except Exception as e:
            print(f"   ERR {pdf.name}: {e}")
    return pd.DataFrame(rows)


def process_career_files(files: List[Path]) -> pd.DataFrame:
    rows = []
    print(f"   {len(files)} XLSX de Questionarios encontrados")
    for f in files:
        try:
            recs = parse_career_xlsx(f)
            rows.extend(recs)
            who = recs[0]["Participante"] if recs else "(?)"
            print(f"   OK  {f.name}  ->  {len(recs)} respostas  [{who}]")
        except Exception as e:
            print(f"   ERR {f.name}: {e}")
    return pd.DataFrame(rows)


def main():
    ap = argparse.ArgumentParser(description="Consolida PDFs FACET5 e XLSX de Questionarios em facet.xlsx + questionarios.xlsx")
    ap.add_argument("--root", type=Path, default=DEFAULT_ROOT,
                    help="Pasta raiz para auto-discovery (default: pasta C&D/)")
    ap.add_argument("--facet", type=Path, default=None,
                    help="Pasta especifica com PDFs FACET5 (sobrescreve auto-discovery)")
    ap.add_argument("--career", type=Path, default=None,
                    help="Pasta especifica com XLSX dos Questionarios (sobrescreve auto-discovery)")
    ap.add_argument("--out", type=Path, default=DEFAULT_OUTPUT_DIR,
                    help="Diretorio de saida (default: pasta C&D/)")
    args = ap.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)

    print(f"\n[root]   {args.root}")
    print(f"[output] {args.out}")

    if args.facet or args.career:
        facet_pdfs = sorted(args.facet.rglob("*.pdf")) if args.facet else []
        career_xlsxs = []
        if args.career:
            career_xlsxs = sorted(list(args.career.glob("*.xlsx")) + list(args.career.glob("*.xlsm")))
    else:
        if not args.root.is_dir():
            print(f"ERRO: pasta raiz nao existe: {args.root}")
            sys.exit(1)
        print("\nFazendo auto-discovery dentro do root...")
        facet_pdfs, career_xlsxs = discover_files(args.root)

    if facet_pdfs:
        print("\n=== FACET5 -> facet.xlsx ===")
        df = process_facet_files(facet_pdfs)
        if not df.empty:
            df.drop(columns=["_arquivo"], errors="ignore", inplace=True)
            out = args.out / "facet.xlsx"
            df.to_excel(out, index=False)
            print(f"\nGerado: {out} ({len(df)} linhas)")
        else:
            print("\nNenhum dado extraido dos PDFs FACET5.")
    else:
        print("\n[FACET5] Nenhum PDF encontrado.")

    if career_xlsxs:
        print("\n=== Questionarios -> questionarios.xlsx ===")
        df = process_career_files(career_xlsxs)
        if not df.empty:
            out = args.out / "questionarios.xlsx"
            df.to_excel(out, index=False)
            print(f"\nGerado: {out} ({len(df)} linhas)")
        else:
            print("\nNenhum dado extraido dos Questionarios.")
    else:
        print("\n[Questionarios] Nenhum XLSX encontrado.")

    if not facet_pdfs and not career_xlsxs:
        print("\nDicas:")
        print("  - PDFs FACET5 sao identificados pelo nome (precisam conter 'facet').")
        print("  - XLSX de Questionarios sao identificados por estarem em pasta com")
        print("    'questionario' ou 'carreira' no nome, OU por terem aba 'Quest Carreira'.")
        print("  - Voce tambem pode passar --facet e --career com os caminhos exatos.")



if __name__ == "__main__":
    main()
