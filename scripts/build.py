"""
Build script — converte os Excels de origem em JSONs prontos para o frontend.

Saídas em ../data/:
  - access.json       : login (PARTICIPANTE), senhas hasheadas (PBKDF2-SHA256), nível de acesso e mapeamento de visibilidade.
  - interviews.json   : notas, respostas e conclusões por participante x competência (aba "Entrevistas").
  - facet.json        : perfil/família/notas dos 5 fatores (gerado a partir de facet.xlsx, que vem do parser de PDFs).
  - career.json       : respostas dos questionários de carreira (gerado a partir de questionarios.xlsx, do parser de PDFs).
  - manifest.json     : metadados (colunas, contagens, iterações PBKDF2).
"""

from __future__ import annotations

import hashlib
import json
import os
import secrets
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import pandas as pd


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
DEFAULT_INPUT_DIR = PROJECT_DIR.parent
DEFAULT_OUTPUT_DIR = PROJECT_DIR / "data"

INPUT_DIR = Path(os.environ.get("BUILD_INPUT_DIR", DEFAULT_INPUT_DIR))
OUTPUT_DIR = Path(os.environ.get("BUILD_OUTPUT_DIR", DEFAULT_OUTPUT_DIR))

ACCESS_FILES = ["acessos.xlsx", "Participantes - Assessment - com diretores.xlsx"]
INTERVIEWS_FILES = ["entrevistas.xlsx", "Planilha_Entrevistas_Competências POWER BI COMPLETO.xlsx"]
FACET_FILES = ["facet.xlsx"]
CAREER_FILES = ["questionarios.xlsx"]

ACCESS_SHEET_CANDIDATES = ["Acessos", "Acesso", "Planilha1", "Sheet1"]
INTERVIEWS_SHEET_CANDIDATES = ["Entrevistas", "Entrevista", "Planilha1", "Sheet1"]

PARTICIPANT_COLUMN = "PARTICIPANTE"
EMAIL_COLUMN = "E-MAIL"
PASSWORD_COLUMN = "SENHA"
ACCESS_LEVEL_COLUMN = "Acesso_Relatório"
DIRETOR_COLUMN = "DIRETOR"
DIRETORIA_COLUMN = "DIRETORIA"
ROLE_COLUMN = "CARGO"

INTERVIEW_NAME_COLUMN = "Nome do Entrevistado"
INTERVIEW_DIRETORIA = "Diretoria"
INTERVIEW_COMPETENCY = "COMPETÊNCIA"
INTERVIEW_DESCRIPTION = "DESCRIÇÃO DA COMPETÊNCIA"
INTERVIEW_INDICATORS = "INDICADORES"
INTERVIEW_QUESTIONS = "PERGUNTAS PARA ENTREVISTA"
INTERVIEW_ANSWERS = "RESPOSTAS"
INTERVIEW_CONCLUSIONS = "CONCLUSÕES GERAIS SOBRE O PARTICIPANTE"
INTERVIEW_NOTES = "NOTAS"
INTERVIEW_AVERAGE = "MÉDIA GERAL DA COMPETÊNCIA"

FACET_GROUPS = [
    "Determinação",
    "Energia",
    "Afetividade",
    "Controle",
    "Emocionalidade",
]

PBKDF2_ITERATIONS = 200_000
SALT_BYTES = 16


def normalize_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and pd.isna(value):
        return ""
    text = str(value).strip()
    return " ".join(text.split()).casefold()


def find_column(df: pd.DataFrame, candidates: List[str], required: bool = False) -> Optional[str]:
    normalized = {normalize_text(col): col for col in df.columns}
    for candidate in candidates:
        if normalize_text(candidate) in normalized:
            return normalized[normalize_text(candidate)]
    if required:
        raise KeyError(f"Coluna obrigatória não encontrada: {candidates}")
    return None


def find_first_existing_file(base: Path, names: List[str]) -> Optional[Path]:
    for n in names:
        p = base / n
        if p.exists():
            return p
    return None


def find_first_sheet(xlsx_path: Path, candidates: List[str]) -> str:
    xls = pd.ExcelFile(xlsx_path)
    norm_to_orig = {normalize_text(s): s for s in xls.sheet_names}
    for c in candidates:
        if normalize_text(c) in norm_to_orig:
            return norm_to_orig[normalize_text(c)]
    return xls.sheet_names[0]


def clean_str(v):
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).strip()
    if not s or s.lower() in ("nan", "none"):
        return None
    return s


def df_to_records(df: pd.DataFrame) -> List[dict]:
    cleaned = df.where(pd.notnull(df), None)
    return json.loads(cleaned.to_json(orient="records", force_ascii=False, date_format="iso"))


def hash_password(password: str) -> dict:
    salt = secrets.token_bytes(SALT_BYTES)
    derived = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return {"salt": salt.hex(), "iterations": PBKDF2_ITERATIONS, "hash": derived.hex()}


def _to_number(v):
    if v is None:
        return None
    try:
        if pd.isna(v):
            return None
    except (TypeError, ValueError):
        pass
    try:
        return float(str(v).replace(",", ".").strip())
    except (ValueError, AttributeError):
        return None


# ----------------------- Acessos -----------------------

def build_access(input_dir: Path):
    path = find_first_existing_file(input_dir, ACCESS_FILES)
    if not path:
        raise FileNotFoundError(f"Acessos não encontrado em {input_dir}")

    sheet = find_first_sheet(path, ACCESS_SHEET_CANDIDATES)
    df = pd.read_excel(path, sheet_name=sheet)
    df.columns = [str(c).strip() for c in df.columns]
    df = df.dropna(how="all")

    part_col = find_column(df, [PARTICIPANT_COLUMN], required=True)
    pwd_col = find_column(df, [PASSWORD_COLUMN], required=True)
    level_col = find_column(df, [ACCESS_LEVEL_COLUMN], required=True)
    email_col = find_column(df, [EMAIL_COLUMN])
    role_col = find_column(df, [ROLE_COLUMN])
    dir_col = find_column(df, [DIRETOR_COLUMN])
    area_col = find_column(df, [DIRETORIA_COLUMN])

    records = []
    for _, row in df.iterrows():
        participant = clean_str(row.get(part_col))
        if not participant:
            continue
        password = clean_str(row.get(pwd_col))
        level_raw = row.get(level_col)
        level = int(level_raw) if pd.notna(level_raw) else 0

        rec = {
            "PARTICIPANTE": participant,
            "EMAIL": clean_str(row.get(email_col)) if email_col else None,
            "CARGO": clean_str(row.get(role_col)) if role_col else None,
            "DIRETOR": clean_str(row.get(dir_col)) if dir_col else None,
            "DIRETORIA": clean_str(row.get(area_col)) if area_col else None,
            "__access_level__": level,
            "__participant_key__": normalize_text(participant),
            "__password_hash__": hash_password(password) if password else None,
        }
        records.append(rec)

    metadata = {
        "participant_column": part_col,
        "email_column": email_col,
        "level_column": level_col,
        "diretor_column": dir_col,
        "diretoria_column": area_col,
        "source_file": path.name,
        "source_sheet": sheet,
    }
    return records, metadata


# ----------------------- Entrevistas -----------------------

def build_interviews(input_dir: Path):
    path = find_first_existing_file(input_dir, INTERVIEWS_FILES)
    if not path:
        raise FileNotFoundError(f"Entrevistas não encontrado em {input_dir}")

    sheet = find_first_sheet(path, INTERVIEWS_SHEET_CANDIDATES)
    df = pd.read_excel(path, sheet_name=sheet)
    df.columns = [str(c).strip() for c in df.columns]
    df = df.dropna(how="all")

    # Forward-fill colunas-cabecalho da competencia (so a 1a linha de cada
    # competencia traz Competencia/Descricao/Indicadores/Media; as demais ficam vazias)
    name_col = find_column(df, [INTERVIEW_NAME_COLUMN])
    if name_col:
        df[name_col] = df[name_col].ffill()
        for c in [INTERVIEW_COMPETENCY, INTERVIEW_DESCRIPTION, INTERVIEW_INDICATORS,
                  INTERVIEW_AVERAGE, INTERVIEW_DIRETORIA]:
            cc = find_column(df, [c])
            if cc:
                df[cc] = df.groupby(name_col, sort=False)[cc].ffill()

    name_col = find_column(df, [INTERVIEW_NAME_COLUMN], required=True)
    comp_col = find_column(df, [INTERVIEW_COMPETENCY])
    desc_col = find_column(df, [INTERVIEW_DESCRIPTION])
    ind_col = find_column(df, [INTERVIEW_INDICATORS])
    q_col = find_column(df, [INTERVIEW_QUESTIONS])
    ans_col = find_column(df, [INTERVIEW_ANSWERS])
    conc_col = find_column(df, [INTERVIEW_CONCLUSIONS])
    notes_col = find_column(df, [INTERVIEW_NOTES])
    avg_col = find_column(df, [INTERVIEW_AVERAGE])
    area_col = find_column(df, [INTERVIEW_DIRETORIA])

    records = []
    for _, row in df.iterrows():
        name = clean_str(row.get(name_col))
        if not name:
            continue
        rec = {
            "Participante": name,
            "Diretoria": clean_str(row.get(area_col)) if area_col else None,
            "Competencia": clean_str(row.get(comp_col)) if comp_col else None,
            "Descricao": clean_str(row.get(desc_col)) if desc_col else None,
            "Indicadores": clean_str(row.get(ind_col)) if ind_col else None,
            "Perguntas": clean_str(row.get(q_col)) if q_col else None,
            "Respostas": clean_str(row.get(ans_col)) if ans_col else None,
            "Conclusoes": clean_str(row.get(conc_col)) if conc_col else None,
            "Nota": _to_number(row.get(notes_col)) if notes_col else None,
            "MediaCompetencia": _to_number(row.get(avg_col)) if avg_col else None,
            "__participant_key__": normalize_text(name),
        }
        records.append(rec)

    metadata = {
        "name_column": name_col,
        "competency_column": comp_col,
        "notes_column": notes_col,
        "average_column": avg_col,
        "source_file": path.name,
        "source_sheet": sheet,
    }
    return records, metadata


# ----------------------- FACET -----------------------

def build_facet(input_dir: Path):
    path = find_first_existing_file(input_dir, FACET_FILES)
    if not path:
        return []

    df = pd.read_excel(path, sheet_name=0)
    df.columns = [str(c).strip() for c in df.columns]
    df = df.dropna(how="all")

    name_col = find_column(df, ["Participante", PARTICIPANT_COLUMN], required=True)
    fam_col = find_column(df, ["Familia", "Família"])
    perfil_col = find_column(df, ["Perfil"])

    records = []
    for _, row in df.iterrows():
        name = clean_str(row.get(name_col))
        if not name:
            continue
        rec = {
            "Participante": name,
            "Familia": clean_str(row.get(fam_col)) if fam_col else None,
            "Perfil": clean_str(row.get(perfil_col)) if perfil_col else None,
            "__participant_key__": normalize_text(name),
        }
        for g in FACET_GROUPS:
            col = find_column(df, [g])
            rec[g] = _to_number(row.get(col)) if col else None
            desc_col = find_column(df, [f"{g}_desc", f"{g} desc"])
            rec[f"{g}_desc"] = clean_str(row.get(desc_col)) if desc_col else None
        records.append(rec)
    return records


# ----------------------- Career -----------------------

def build_career(input_dir: Path):
    path = find_first_existing_file(input_dir, CAREER_FILES)
    if not path:
        return []

    df = pd.read_excel(path, sheet_name=0)
    df.columns = [str(c).strip() for c in df.columns]
    df = df.dropna(how="all")

    name_col = find_column(df, ["Participante", PARTICIPANT_COLUMN], required=True)
    q_col = find_column(df, ["Pergunta", "Questão"], required=True)
    a_col = find_column(df, ["Resposta"], required=True)

    records = []
    for _, row in df.iterrows():
        name = clean_str(row.get(name_col))
        q = clean_str(row.get(q_col))
        a = clean_str(row.get(a_col))
        if not name or not q:
            continue
        records.append({
            "Participante": name,
            "Pergunta": q,
            "Resposta": a,
            "__participant_key__": normalize_text(name),
        })
    return records


def build():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print(f"Lendo de: {INPUT_DIR}")
    print(f"Escrevendo em: {OUTPUT_DIR}\n")

    access_records, access_meta = build_access(INPUT_DIR)
    interviews_records, interviews_meta = build_interviews(INPUT_DIR)
    facet_records = build_facet(INPUT_DIR)
    career_records = build_career(INPUT_DIR)

    (OUTPUT_DIR / "access.json").write_text(
        json.dumps(access_records, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "interviews.json").write_text(
        json.dumps(interviews_records, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "facet.json").write_text(
        json.dumps(facet_records, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUTPUT_DIR / "career.json").write_text(
        json.dumps(career_records, ensure_ascii=False, indent=2), encoding="utf-8")

    manifest = {
        "access": access_meta,
        "interviews": interviews_meta,
        "facet_groups": FACET_GROUPS,
        "pbkdf2_iterations": PBKDF2_ITERATIONS,
        "row_counts": {
            "access": len(access_records),
            "interviews": len(interviews_records),
            "facet": len(facet_records),
            "career": len(career_records),
        },
    }
    (OUTPUT_DIR / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print("Build concluído.")
    print(f"  row_counts = {manifest['row_counts']}")


if __name__ == "__main__":
    build()
