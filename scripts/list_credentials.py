"""
Diagnóstico: lista {diretor: [senhas válidas]} lendo a planilha original.
Útil para conferir qual senha testar no login.
"""

from pathlib import Path

import pandas as pd

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_DIR = SCRIPT_DIR.parent
INPUT_DIR = PROJECT_DIR.parent

ACCESS_FILE = "Participantes - Assessment - com diretores.xlsx"


def _clean_str(v):
    if pd.isna(v):
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).strip()
    if not s or s.lower() in ("nan", "none"):
        return None
    return s


def main():
    df = pd.read_excel(INPUT_DIR / ACCESS_FILE, sheet_name=0)
    df.columns = [str(c).strip() for c in df.columns]

    by_director = {}
    for _, row in df.iterrows():
        director = _clean_str(row.get("DIRETOR"))
        password = _clean_str(row.get("SENHA"))
        participant = _clean_str(row.get("PARTICIPANTE"))
        level = row.get("Acesso_Relatório")
        if not director or not password:
            continue
        by_director.setdefault(director, []).append(
            {"participante": participant, "senha": password, "nivel": int(level) if pd.notna(level) else None}
        )

    print("=== Credenciais válidas por diretor ===\n")
    for director, entries in sorted(by_director.items()):
        print(f"Diretor: {director}")
        for e in entries:
            print(f"  • senha={e['senha']:<12} participante={e['participante']}  (nível {e['nivel']})")
        print()


if __name__ == "__main__":
    main()
