#!/usr/bin/env node
// Dependency watch: finds pinned third-party JS (CDN URLs + manually declared
// vendored/versioned deps), then checks each one against the npm registry
// (newer versions, deprecation) and OSV.dev (known vulnerabilities).
//
// Zero dependencies; Node 18+. Portable: copy this file, the workflow, and
// (optionally) .github/dependency-watch.json into any repo.
//
// Usage:
//   node .github/scripts/dependency-watch.mjs            # print report
//   node .github/scripts/dependency-watch.mjs --out r.md # also write report file
//   node .github/scripts/dependency-watch.mjs sri <url>  # print sha384 SRI for a URL
//
// Exit code: 0 always (so CI doesn't go red); findings are signalled via
// GITHUB_OUTPUT (status=vulnerable|outdated|ok) for the workflow to act on.

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, appendFileSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { createHash } from "node:crypto";

const ROOT = process.cwd();
const CONFIG_PATH = join(ROOT, ".github", "dependency-watch.json");

// ---- sri subcommand --------------------------------------------------------
// Avoid process.exit() after fetch: on Windows it can abort while sockets close.
async function sri(url) {
  if (!url) { console.error("usage: dependency-watch.mjs sri <url>"); process.exitCode = 2; return; }
  const res = await fetch(url);
  if (!res.ok) { console.error(`HTTP ${res.status} for ${url}`); process.exitCode = 1; return; }
  const buf = Buffer.from(await res.arrayBuffer());
  console.log("sha384-" + createHash("sha384").update(buf).digest("base64"));
}

async function main() {
  // ---- config ----------------------------------------------------------------
  const config = existsSync(CONFIG_PATH) ? JSON.parse(readFileSync(CONFIG_PATH, "utf8")) : {};
  const ignoreDirs = new Set(["node_modules", ".git", "dist", "build", ".next", ...(config.ignoreDirs || [])]);
  const scanExts = new Set(config.scanExtensions || [".html", ".htm", ".js", ".mjs", ".cjs", ".ts", ".jsx", ".tsx", ".vue", ".svelte", ".css", ".astro"]);
  // cdnjs library names don't always match npm package names.
  const cdnjsAliases = { "pdf.js": "pdfjs-dist", ...(config.cdnjsAliases || {}) };
  const ignorePackages = new Set(config.ignorePackages || []);

  // ---- scan ------------------------------------------------------------------
  const PKG = String.raw`((?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*)`;
  const VER = String.raw`(\d+\.\d+\.\d+[\w.+-]*)`;
  const patterns = [
    { cdn: "unpkg", re: new RegExp(String.raw`unpkg\.com\/${PKG}(?:@([^/"'\s\x60]+))?`, "gi") },
    { cdn: "jsdelivr", re: new RegExp(String.raw`cdn\.jsdelivr\.net\/npm\/${PKG}(?:@([^/"'\s\x60]+))?`, "gi") },
    { cdn: "esm.sh", re: new RegExp(String.raw`esm\.sh\/(?:v\d+\/)?${PKG}(?:@([^/"'\s\x60?]+))?`, "gi") },
    { cdn: "skypack", re: new RegExp(String.raw`cdn\.skypack\.dev\/${PKG}(?:@([^/"'\s\x60?]+))?`, "gi") },
    { cdn: "cdnjs", re: new RegExp(String.raw`cdnjs\.cloudflare\.com\/ajax\/libs\/([\w.-]+)\/([^/"'\s\x60]+)`, "gi"), aliases: cdnjsAliases },
  ];

  function* walk(dir) {
    for (const name of readdirSync(dir)) {
      if (ignoreDirs.has(name)) continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) yield* walk(p);
      else if (scanExts.has(extname(name).toLowerCase())) yield p;
    }
  }

  const deps = new Map(); // key "name@version" -> { name, version, where:Set }
  const problems = [];    // unpinned / unresolvable / drift

  function addDep(name, version, where) {
    if (ignorePackages.has(name)) return;
    const key = `${name}@${version}`;
    if (!deps.has(key)) deps.set(key, { name, version, where: new Set() });
    deps.get(key).where.add(where);
  }

  for (const file of walk(ROOT)) {
    const rel = relative(ROOT, file).replaceAll("\\", "/");
    const lines = readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      for (const { cdn, re, aliases } of patterns) {
        re.lastIndex = 0;
        for (const m of line.matchAll(re)) {
          let [, name, version] = m;
          if (aliases) name = aliases[name] || name;
          const where = `${rel}:${i + 1}`;
          if (!version) {
            problems.push(`**Unpinned** \`${name}\` from ${cdn} at \`${where}\`: the URL has no version, so the file can change without warning.`);
          } else if (version.includes("${")) {
            // Template-literal version: must be declared in dependency-watch.json.
            if (!(config.manual || []).some((d) => d.npm === name)) {
              problems.push(`**Unresolved version** for \`${name}\` at \`${where}\`: add it to \`.github/dependency-watch.json\` under \`manual\`.`);
            }
          } else if (!new RegExp(`^${VER}$`).test(version)) {
            problems.push(`**Range, not exact pin** \`${name}@${version}\` at \`${where}\`: pin an exact version.`);
          } else {
            addDep(name, version, where);
          }
        }
      }
    });
  }

  // Manually declared deps (vendored files, versions held in constants, etc.).
  // Each entry's version string must appear in its file, to catch the manifest
  // drifting from the code.
  for (const d of config.manual || []) {
    const path = join(ROOT, d.file);
    if (!existsSync(path)) { problems.push(`**Manifest drift**: \`${d.file}\` (for \`${d.npm}\`) no longer exists.`); continue; }
    if (!readFileSync(path, "utf8").includes(d.version)) {
      problems.push(`**Manifest drift**: \`${d.npm}@${d.version}\` is declared, but \`${d.file}\` doesn't contain "${d.version}". Update \`.github/dependency-watch.json\`.`);
      continue;
    }
    addDep(d.npm, d.version, d.file + (d.note ? ` (${d.note})` : ""));
  }

  // ---- registry + OSV --------------------------------------------------------
  const cmp = (a, b) => {
    const pa = a.split(/[.+-]/).map(Number), pb = b.split(/[.+-]/).map(Number);
    for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    return 0;
  };
  const bumpKind = (from, to) => {
    const [a, b] = [from.split("."), to.split(".")];
    return a[0] !== b[0] ? "major" : a[1] !== b[1] ? "minor" : "patch";
  };

  async function npmInfo(name) {
    const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`, {
      headers: { accept: "application/vnd.npm.install-v1+json" },
    });
    if (!res.ok) return null;
    return res.json();
  }

  async function osvBatch(list) {
    const res = await fetch("https://api.osv.dev/v1/querybatch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queries: list.map((d) => ({ package: { ecosystem: "npm", name: d.name }, version: d.version })) }),
    });
    if (!res.ok) throw new Error(`OSV querybatch HTTP ${res.status}`);
    return (await res.json()).results.map((r) => (r.vulns || []).map((v) => v.id));
  }

  const vulnCache = new Map();
  async function osvVuln(id) {
    if (!vulnCache.has(id)) {
      vulnCache.set(id, fetch(`https://api.osv.dev/v1/vulns/${id}`).then((r) => (r.ok ? r.json() : { id })));
    }
    return vulnCache.get(id);
  }

  function fixedVersions(vuln, name) {
    const out = new Set();
    for (const a of vuln.affected || []) {
      if (a.package?.name !== name) continue;
      for (const r of a.ranges || []) for (const e of r.events || []) if (e.fixed) out.add(e.fixed);
    }
    return [...out];
  }

  const list = [...deps.values()].sort((a, b) => a.name.localeCompare(b.name));
  const vulnIds = list.length ? await osvBatch(list) : [];

  const rows = [];
  const vulnerable = [];
  for (const [i, d] of list.entries()) {
    const info = await npmInfo(d.name);
    const latest = info?.["dist-tags"]?.latest;
    const deprecated = info?.versions?.[d.version]?.deprecated;
    const vulns = await Promise.all(vulnIds[i].map(osvVuln));
    let status = "✅ current";
    if (!info) status = "❓ not found on npm";
    else if (latest && cmp(latest, d.version) > 0) status = `⬆️ ${bumpKind(d.version, latest)} update`;
    if (deprecated) status += " · ⚠️ deprecated";
    if (vulns.length) {
      status = `🔴 ${vulns.length} vuln${vulns.length > 1 ? "s" : ""} · ` + status;
      vulnerable.push({ d, vulns });
    }
    rows.push({ d, latest: latest || "?", status });
  }

  // ---- report ----------------------------------------------------------------
  const outdated = rows.filter((r) => r.status.includes("⬆️"));
  const md = [];
  md.push(`Weekly check of pinned third-party code (npm registry + [OSV.dev](https://osv.dev)).`);
  md.push("");
  md.push(`**${vulnerable.length}** vulnerable · **${outdated.length}** outdated · **${problems.length}** pinning issue(s) · ${rows.length} checked`);
  md.push("");
  if (vulnerable.length) {
    md.push("## 🔴 Security advisories");
    for (const { d, vulns } of vulnerable) {
      for (const v of vulns) {
        const fixed = fixedVersions(v, d.name);
        const sev = v.database_specific?.severity || v.severity?.[0]?.score || "";
        md.push(`- **${d.name}@${d.version}** — [${v.id}](https://osv.dev/vulnerability/${v.id})${sev ? ` (${sev})` : ""}: ${v.summary || "no summary"}${fixed.length ? ` — fixed in ${fixed.join(", ")}` : " — no fixed version listed"}`);
      }
    }
    md.push("");
  }
  if (problems.length) {
    md.push("## ⚠️ Pinning issues");
    for (const p of problems) md.push(`- ${p}`);
    md.push("");
  }
  md.push("## All dependencies");
  md.push("| Package | Pinned | Latest | Status | Used in |");
  md.push("|---|---|---|---|---|");
  for (const { d, latest, status } of rows) {
    md.push(`| [${d.name}](https://www.npmjs.com/package/${d.name}) | ${d.version} | ${latest} | ${status} | ${[...d.where].map((w) => `\`${w}\``).join("<br>")} |`);
  }
  md.push("");
  md.push("To update: ask Claude Code to run the `update-dependencies` skill. For an SRI hash, run `node .github/scripts/dependency-watch.mjs sri <url>`.");

  const report = md.join("\n");
  console.log(report);

  const outIdx = process.argv.indexOf("--out");
  if (outIdx > -1) writeFileSync(process.argv[outIdx + 1], report);

  const status = vulnerable.length ? "vulnerable" : outdated.length || problems.length ? "outdated" : "ok";
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `status=${status}\n`);
}

if (process.argv[2] === "sri") await sri(process.argv[3]);
else await main();
