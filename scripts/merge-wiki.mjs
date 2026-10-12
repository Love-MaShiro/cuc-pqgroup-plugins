// merge-wiki.mjs —— 跨用户概念合并脚本
// 把 team-wiki/users/<name>/wiki/ 的各人 wiki 合并成 canonical merged/ + 全局 graph.json
// 用法：node merge-wiki.mjs [team-wiki目录]   （默认 ../team-wiki 相对脚本位置）
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync, copyFileSync, unlinkSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(process.argv[2] || join(here, "..", "team-wiki"));

const USERS_DIR = join(ROOT, "users");
const MERGED_DIR = join(ROOT, "merged");
const GRAPH_PATH = join(ROOT, "graph.json");

function readJson(p) {
  try {
    return JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, "")); // 容忍 BOM
  } catch {
    return undefined;
  }
}
function slugKey(e) {
  return (e.slug || e.id || "").toLowerCase();
}

// ---- 1. 扫描所有用户的 wiki ----
const users = existsSync(USERS_DIR)
  ? readdirSync(USERS_DIR).filter((d) => existsSync(join(USERS_DIR, d, "wiki")))
  : [];
if (users.length === 0) {
  console.log("没有找到任何 users/<name>/wiki/ 提交，跳过合并。");
  process.exit(0);
}

const allEntities = [];
const allRelations = [];
const pages = []; // { user, sub, file, path }
const glossaries = [];

for (const user of users) {
  const wikiDir = join(USERS_DIR, user, "wiki");
  const graph = readJson(join(wikiDir, "graph.json"));
  if (!graph || !Array.isArray(graph.entities)) {
    console.log(`  跳过 ${user}（无有效 graph.json）`);
    continue;
  }
  for (const e of graph.entities) allEntities.push({ ...e, _user: user, _src: wikiDir });
  for (const r of graph.relations || []) allRelations.push({ ...r, _user: user });
  for (const sub of ["concepts", "papers"]) {
    const dir = join(wikiDir, sub);
    if (existsSync(dir)) {
      for (const f of readdirSync(dir)) {
        pages.push({ user, sub, file: f, path: join(dir, f) });
      }
    }
  }
  const gl = join(wikiDir, "glossary.md");
  if (existsSync(gl)) glossaries.push({ user, path: gl, text: readFileSync(gl, "utf8") });
}
console.log(`扫描到 ${users.length} 个用户，${allEntities.length} 个实体，${allRelations.length} 条关系，${pages.length} 个页面。`);

// ---- 2. 合并 entities（去重：slug/nameEn/name/aliases）----
const entityByKey = new Map(); // key -> entity
const aliasIndex = new Map();  // alias -> key

function findDuplicateKey(e) {
  const k = slugKey(e);
  if (entityByKey.has(k)) return k;
  if (e.name && [...entityByKey.values()].some((x) => x.name === e.name)) {
    return [...entityByKey.entries()].find(([, x]) => x.name === e.name)?.[0];
  }
  if (e.nameEn) {
    const hit = [...entityByKey.values()].find((x) => x.nameEn && x.nameEn.toLowerCase() === e.nameEn.toLowerCase());
    if (hit) return slugKey(hit);
  }
  for (const a of e.aliases || []) {
    if (aliasIndex.has(a.toLowerCase())) return aliasIndex.get(a.toLowerCase());
  }
  return undefined;
}

for (const e of allEntities) {
  const dupKey = findDuplicateKey(e);
  if (dupKey !== undefined) {
    const existing = entityByKey.get(dupKey);
    // 合并字段（canonical-rules 默认：papers union / aliases union / summary keep-longest）
    existing.papers = [...new Set([...(existing.papers || []), ...(e.papers || [])])];
    existing.aliases = [...new Set([...(existing.aliases || []), ...(e.aliases || [])])];
    if ((e.summary || "").length > (existing.summary || "").length) {
      existing.summary = e.summary;
      existing._user = e._user;
      existing._src = e._src;
    }
    if (e.nameEn && !existing.nameEn) existing.nameEn = e.nameEn;
  } else {
    const key = slugKey(e);
    entityByKey.set(key, { ...e }); // 存副本，避免后续改 _src 时污染 allEntities
    for (const a of e.aliases || []) aliasIndex.set(a.toLowerCase(), key);
  }
}

// ---- 3. 合并 relations（dedup-by-id，papers union，why keep-longest）----
const relationById = new Map();
for (const r of allRelations) {
  const key = r.id || `${r.source}->${r.target}`;
  if (relationById.has(key)) {
    const existing = relationById.get(key);
    if ((r.why || "").length > (existing.why || "").length) existing.why = r.why;
    existing.papers = [...new Set([...(existing.papers || []), ...(r.papers || [])])];
  } else {
    relationById.set(key, r);
  }
}

const mergedEntities = [...entityByKey.values()].map(({ _user, _src, ...e }) => e);
const mergedRelations = [...relationById.values()].map(({ _user, ...r }) => r);

// ---- 4. 写 canonical 概念页 + 论文页到 merged/（先清旧，避免残留）----
mkdirSync(join(MERGED_DIR, "concepts"), { recursive: true });
mkdirSync(join(MERGED_DIR, "papers"), { recursive: true });
for (const sub of ["concepts", "papers"]) {
  const dir = join(MERGED_DIR, sub);
  for (const f of readdirSync(dir)) {
    if (f !== "README.md") unlinkSync(join(dir, f));
  }
}

// 概念页：每个合并后的 entity 取一个 canonical 页，优先"最完整"（summary 最长）用户的原文，缺文件则 fallback 到有文件的用户
const entityPageCopy = new Map(); // slug -> { src, dest }
for (const e of [...entityByKey.values()]) {
  const slug = e.slug || e.id;
  const srcDirs = [
    e._src,
    ...allEntities.filter((x) => x._src !== e._src && slugKey(x) === slugKey(e)).map((x) => x._src),
  ].filter(Boolean);
  for (const src of srcDirs) {
    const srcFile = join(src, "concepts", `${slug}.md`);
    if (existsSync(srcFile)) {
      entityPageCopy.set(slug, { src: srcFile, dest: join(MERGED_DIR, "concepts", `${slug}.md`) });
      break;
    }
  }
}
// 论文页：按文件名去重（同名论文页，取第一个；多用户同论文一般内容相同）
const paperSeen = new Set();
for (const p of pages) {
  if (p.sub === "concepts") continue;
  if (paperSeen.has(p.file)) continue;
  paperSeen.add(p.file);
  copyFileSync(p.path, join(MERGED_DIR, "papers", p.file));
}
for (const [, v] of entityPageCopy) {
  copyFileSync(v.src, v.dest);
}
console.log(`  复制概念页 ${entityPageCopy.size} 个，论文页 ${paperSeen.size} 个。`);

// ---- 5. 写全局 graph.json ----
const graph = {
  version: "1.0.0",
  meta: { generator: "team-wiki-merge", updatedAt: new Date().toISOString(), users },
  entities: mergedEntities,
  relations: mergedRelations,
};
writeFileSync(GRAPH_PATH, JSON.stringify(graph, null, 2) + "\n");
console.log(`  写全局 graph.json：${mergedEntities.length} 实体，${mergedRelations.length} 关系。`);

// ---- 6. 合并 glossary.md ----
const rows = new Map(); // key(英文|中文) -> row
const header = "| 英文 | 中文 | 一句话解释 | 出处论文 |";
for (const g of glossaries) {
  for (const line of g.text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t.startsWith("|") || t.startsWith("|---") || t.includes("英文")) continue;
    const cells = t.split("|").map((c) => c.trim()).filter((c, i) => i > 0 && i < 5);
    if (cells.length < 2) continue;
    const key = `${cells[0]}|${cells[1]}`;
    if (!rows.has(key)) rows.set(key, t);
  }
}
const glossaryMd = [header, "|---|---|---|---|", ...[...rows.values()], ""].join("\n");
writeFileSync(join(MERGED_DIR, "glossary.md"), glossaryMd);
console.log(`  合并术语表 ${rows.size} 行。`);

console.log("\n合并完成。结果在 merged/ 和 graph.json。");
