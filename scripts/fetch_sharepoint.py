"""
Baixa todos os arquivos do SharePoint a partir dos links públicos
("Anyone with link") e os deixa numa pasta local pronta para o build.

Como funciona:
  1. GET no link público -> SharePoint cria sessão "guest" e redireciona pra
     URL canônica do arquivo. Os cookies precisam ser persistidos.
  2. Para arquivo: usa ?download=1 com os cookies da sessão.
  3. Para pasta: a URL canônica do redirect contém o ServerRelativeUrl;
     usamos a API REST /_api/web/GetFolderByServerRelativeUrl para listar
     e baixar cada arquivo.

Configuração: edite SOURCES abaixo OU passe os links via variáveis de ambiente
(SP_FILE_ACESSOS, SP_FILE_ENTREVISTAS, SP_FILE_CARDAPIO, SP_FOLDER_FACET, SP_FOLDER_CARREIRA).
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import urllib.parse
from pathlib import Path
from typing import Dict, List

import requests


UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)

# Tipo: "file" ou "folder"
SOURCES: Dict[str, Dict[str, str]] = {
    "Participantes - Assessment - com diretores.xlsx": {
        "type": "file",
        "url": os.environ.get(
            "SP_FILE_ACESSOS",
            "https://ciadetalentos.sharepoint.com/:x:/s/Arquivos/IQBu6peE0WggQZJ6M6phHAAcAcPpiD03uawbeATddomO7g8?e=RCxeKZ",
        ),
    },
    "Planilha_Entrevistas_Competências POWER BI COMPLETO.xlsx": {
        "type": "file",
        "url": os.environ.get(
            "SP_FILE_ENTREVISTAS",
            "https://ciadetalentos.sharepoint.com/:x:/s/Arquivos/IQBPEpEfSbXrR4x08thkksENASHvbixnFrWzuXsd8aI-s1s?e=D37CEW",
        ),
    },
    "Cardápio Ações de Desenvolvimento - UNIFIQUE.xlsx": {
        "type": "file",
        "url": os.environ.get(
            "SP_FILE_CARDAPIO",
            "https://ciadetalentos.sharepoint.com/:x:/s/Arquivos/IQDSMMHzwt4GQLU5TZfUH-bkAU88mLE_j4v9UpN4FFOR_9Y?e=bQc4Zs",
        ),
    },
    "pdfs_facet5": {
        "type": "folder",
        "url": os.environ.get(
            "SP_FOLDER_FACET",
            "https://ciadetalentos.sharepoint.com/:f:/s/Arquivos/IgAZFkesq7ZNToMG09JcxD_TAUeP6vpnADJilbsHomLH3Fw?e=cGe07W",
        ),
        "ext": ".pdf",
    },
    "questionarios_carreira": {
        "type": "folder",
        "url": os.environ.get(
            "SP_FOLDER_CARREIRA",
            "https://ciadetalentos.sharepoint.com/:f:/s/Arquivos/IgA-7PsFLZSpRr1uDr02CvciAc5p19S_Y8x9sNR_pUW7xsE?e=WQwlmG",
        ),
        "ext": ".xlsx",
    },
}


def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"User-Agent": UA})
    return s


def open_share(session: requests.Session, share_url: str) -> str:
    """
    Abre o link público — isso cria a sessão guest e captura cookies.
    Retorna a URL final (que contém o ServerRelativeUrl real do item).
    """
    r = session.get(share_url, allow_redirects=True, timeout=30)
    r.raise_for_status()
    return r.url


def download_file(session: requests.Session, share_url: str, dest: Path) -> int:
    """Baixa um arquivo usando ?download=1 do link público."""
    sep = "&" if "?" in share_url else "?"
    dl_url = f"{share_url}{sep}download=1"
    # primeiro abre normal pra pegar cookies da sessão guest
    open_share(session, share_url)
    r = session.get(dl_url, allow_redirects=True, timeout=120, stream=True)
    if r.status_code != 200:
        raise RuntimeError(f"Download falhou ({r.status_code}): {dl_url}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with open(dest, "wb") as f:
        for chunk in r.iter_content(chunk_size=64 * 1024):
            if chunk:
                f.write(chunk)
                n += len(chunk)
    return n


def parse_server_relative_path(final_url: str) -> str:
    """
    A URL canônica do AllItems.aspx tem ?id=<server-relative-url> URL-encoded.
    Extrai o caminho do servidor (ServerRelativeUrl), decodificado.
    """
    parsed = urllib.parse.urlparse(final_url)
    qs = urllib.parse.parse_qs(parsed.query)
    raw_id = qs.get("id", [""])[0]
    if not raw_id:
        raise RuntimeError(f"Não encontrei o parâmetro 'id' na URL canônica: {final_url}")
    return urllib.parse.unquote(raw_id)


def _site_url_from(final_url: str, server_rel: str) -> str:
    """Identifica a URL base do site (até /sites/<nome>) a partir de um caminho."""
    parts = server_rel.split("/")
    if len(parts) < 3 or parts[1] != "sites":
        raise RuntimeError(f"Estrutura de site inesperada: {server_rel}")
    return (
        f"{urllib.parse.urlparse(final_url).scheme}://"
        f"{urllib.parse.urlparse(final_url).netloc}/sites/{parts[2]}"
    )


def _list_folder_files(session, site_url: str, folder_rel: str) -> List[Dict]:
    api = (
        f"{site_url}/_api/web/GetFolderByServerRelativeUrl("
        f"'{urllib.parse.quote(folder_rel)}')/Files?$select=Name,ServerRelativeUrl,Length&$top=500"
    )
    r = session.get(api, headers={"Accept": "application/json;odata=nometadata"}, timeout=30)
    r.raise_for_status()
    return r.json().get("value", [])


def _list_folder_subfolders(session, site_url: str, folder_rel: str) -> List[Dict]:
    api = (
        f"{site_url}/_api/web/GetFolderByServerRelativeUrl("
        f"'{urllib.parse.quote(folder_rel)}')/Folders?$select=Name,ServerRelativeUrl&$top=500"
    )
    r = session.get(api, headers={"Accept": "application/json;odata=nometadata"}, timeout=30)
    r.raise_for_status()
    items = r.json().get("value", [])
    # SharePoint costuma incluir pastas internas tipo "Forms" — ignora.
    return [f for f in items if not f.get("Name", "").startswith("Forms")]


def list_folder(session: requests.Session, share_url: str, ext: str) -> List[Dict]:
    """
    Resolve o link público da pasta e lista TODOS os arquivos (recursivamente,
    incluindo subpastas) via API REST do SharePoint.
    Retorna lista de {Name, ServerRelativeUrl, _subpath}.
    """
    final_url = open_share(session, share_url)
    root_rel = parse_server_relative_path(final_url)
    site_url = _site_url_from(final_url, root_rel)

    # BFS pelas subpastas
    all_items: List[Dict] = []
    queue = [(root_rel, "")]  # (caminho absoluto, caminho relativo à raiz da pasta compartilhada)
    while queue:
        rel, subpath = queue.pop(0)
        files = _list_folder_files(session, site_url, rel)
        for f in files:
            f["_subpath"] = subpath
            all_items.append(f)
        for sub in _list_folder_subfolders(session, site_url, rel):
            sub_name = sub["Name"]
            sub_rel = sub["ServerRelativeUrl"]
            new_subpath = f"{subpath}/{sub_name}" if subpath else sub_name
            queue.append((sub_rel, new_subpath))

    if ext:
        all_items = [x for x in all_items if x.get("Name", "").lower().endswith(ext.lower())]
    return all_items


def download_folder_files(
    session: requests.Session, share_url: str, ext: str, dest_dir: Path
) -> int:
    items = list_folder(session, share_url, ext)
    dest_dir.mkdir(parents=True, exist_ok=True)
    print(f"  {len(items)} arquivos para baixar (incluindo subpastas)")
    final_url = open_share(session, share_url)
    netloc = urllib.parse.urlparse(final_url).netloc
    base = f"https://{netloc}"
    n = 0
    for it in items:
        name = it["Name"]
        srel = it["ServerRelativeUrl"]
        subpath = it.get("_subpath", "")
        dl = f"{base}{urllib.parse.quote(srel)}"
        dest = (dest_dir / subpath / name) if subpath else (dest_dir / name)
        try:
            dest.parent.mkdir(parents=True, exist_ok=True)
            r = session.get(dl, timeout=120, stream=True)
            r.raise_for_status()
            with open(dest, "wb") as f:
                for ch in r.iter_content(chunk_size=64 * 1024):
                    if ch:
                        f.write(ch)
            n += 1
            tag = f" [{subpath}]" if subpath else ""
            print(f"   OK  {name}{tag}  ({int(it.get('Length') or 0)} bytes)")
        except Exception as e:
            print(f"   ERR {name}: {e}")
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, required=True, help="Diretório destino")
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    session = make_session()
    print(f"Baixando para: {args.out}\n")

    for name, cfg in SOURCES.items():
        kind = cfg["type"]
        url = cfg["url"]
        if not url:
            print(f"-- {name}: sem URL configurado, pulando.")
            continue
        # Loga origem (parcial, sem token completo) pra facilitar diagnóstico
        url_short = url.split("?", 1)[0] + "..." if len(url) > 100 else url
        print(f"-> {name} ({kind})  fonte: {url_short}")
        try:
            if kind == "file":
                size = download_file(session, url, args.out / name)
                print(f"   OK  {size} bytes\n")
            else:
                n = download_folder_files(session, url, cfg.get("ext", ""), args.out / name)
                print(f"   {n} arquivos baixados em '{name}/'\n")
        except Exception as e:
            print(f"   FALHA: {e}\n", file=sys.stderr)
            raise


if __name__ == "__main__":
    main()
