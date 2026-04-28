// data.js - carrega os JSONs gerados pelo build.py.
// (No futuro, dá para trocar essa fonte por SharePoint via MSAL/Graph.)

class LocalJsonSource {
  constructor(basePath = "./data") {
    this.basePath = basePath;
  }

  async _fetch(name) {
    const res = await fetch(`${this.basePath}/${name}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Falha ao carregar ${name}: ${res.status}`);
    return res.json();
  }

  async loadAll() {
    const [manifest, access, interviews, facet, career] = await Promise.all([
      this._fetch("manifest.json"),
      this._fetch("access.json"),
      this._fetch("interviews.json"),
      this._fetch("facet.json").catch(() => []),
      this._fetch("career.json").catch(() => []),
    ]);
    return { manifest, access, interviews, facet, career };
  }
}

export const dataSource = new LocalJsonSource("./data");
