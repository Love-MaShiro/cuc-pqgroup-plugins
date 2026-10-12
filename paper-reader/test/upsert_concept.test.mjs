// upsert_concept 核心算法单元测试（不依赖 DSH，用真实文件系统 mock ctx.fs）
import { mkdtempSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { slugify, upsertConcept } from "../index.js";

// ---- mock ctx.fs ----
function makeCtx(baseDir, opts = {}) {
  const writeCalls = [];
  const sandboxPolicyService = opts.withSandboxPolicy
    ? {
        resolve({ session }) {
          return { mode: "workspace-write", workspaceRoot: session?.header?.cwd ?? baseDir, sessionId: session?.id };
        },
      }
    : undefined;
  return {
    get(name) {
      return name === "sandboxPolicy" ? sandboxPolicyService : undefined;
    },
    fs: {
      async resolve(p, opts = {}) {
        const abs = resolve(opts.cwd || baseDir, p);
        return { path: abs, displayPath: abs };
      },
      async stat(target) {
        try {
          const s = readFileSync(target.path);
          return { type: "file", size: s.length };
        } catch {
          try {
            const entries = readdirSync(target.path);
            return { type: "directory" };
          } catch {
            return undefined;
          }
        }
      },
      async readText(target) {
        return readFileSync(target.path, "utf8");
      },
      async writeText(target, content, _expected, _signal, policy) {
        writeCalls.push({ policy });
        mkdirSync(dirname(target.path), { recursive: true });
        writeFileSync(target.path, content);
        return { operation: "write", version: 1 };
      },
    },
    _writeCalls: writeCalls,
  };
}
import { readdirSync } from "node:fs";

function exec(cwd) {
  return { agent: { session: { header: { cwd } } }, signal: undefined };
}

function readGraph(base) {
  return JSON.parse(readFileSync(join(base, "paper-wiki", "graph.json"), "utf8"));
}

let passed = 0;
let failed = 0;
function check(label, cond) {
  if (cond) {
    passed++;
    console.log("  ✓ " + label);
  } else {
    failed++;
    console.log("  ✗ " + label);
  }
}

// ---- 测试 ----
const base = mkdtempSync(join(tmpdir(), "paper-reader-"));
const ctx = makeCtx(base);
console.log("测试目录:", base);

console.log("\n[1] slugify");
check("英文转 kebab", slugify("Self-Attention") === "self-attention");
check("首尾连字符清理", slugify("  Transformer!! ") === "transformer");

console.log("\n[2] 新建概念 + 映射边");
const r1 = await upsertConcept(
  ctx,
  {
    name: "自注意力机制",
    nameEn: "Self-Attention",
    category: "prerequisite",
    summary: "让序列中每个位置直接加权聚合其他位置信息的机制",
    aliases: ["self attention"],
    prerequisitesOf: [{ target: "transformer", why: "self-attention 是 Transformer 的核心计算单元" }],
    usedByPapers: ["attention-is-all-you-need"],
  },
  exec(base),
);
check("created=true", r1.created === true);
check("slug=self-attention", r1.slug === "self-attention");
check("概念页已写", existsSync(join(base, "paper-wiki", "concepts", "self-attention.md")));

const g1 = readGraph(base);
check("entity 自注意力存在", g1.entities.some((e) => e.id === "concept:self-attention"));
check("占位实体 transformer 存在", g1.entities.some((e) => e.id === "concept:transformer"));
const rel = g1.relations.find((r) => r.type === "prerequisite_of");
check("映射边 prerequisite_of 存在", !!rel);
check("边方向 source=前置", rel?.source === "concept:self-attention");
check("边方向 target=核心", rel?.target === "concept:transformer");
check("边 why 记录", rel?.why === "self-attention 是 Transformer 的核心计算单元");

console.log("\n[3] 复用（同 nameEn）");
const r2 = await upsertConcept(
  ctx,
  { name: "自注意力机制", nameEn: "Self-Attention", category: "core", summary: "另一个摘要", usedByPapers: ["bert"] },
  exec(base),
);
check("created=false", r2.created === false);
const g2 = readGraph(base);
check("不新增 entity", g2.entities.filter((e) => e.id === "concept:self-attention").length === 1);
check("追加 papers 引用", g2.entities.find((e) => e.id === "concept:self-attention").papers.includes("bert"));
check("复用不覆盖已有 summary", g2.entities.find((e) => e.id === "concept:self-attention").summary === "让序列中每个位置直接加权聚合其他位置信息的机制");

console.log("\n[4] 别名去重（不同 name，aliases 命中）");
const r3 = await upsertConcept(
  ctx,
  { name: "自注意", nameEn: "", category: "prerequisite", summary: "x", aliases: ["self attention"] },
  exec(base),
);
check("通过别名复用 created=false", r3.created === false);

console.log("\n[5] 边去重（重复 prerequisitesOf 不产生重复边）");
const g3 = readGraph(base);
const relCount = g3.relations.filter((r) => r.id === "rel:self-attention-transformer").length;
check("边唯一", relCount === 1);

console.log("\n[6] sandbox policy 传递（有 sandboxPolicy 服务时）");
const base6 = mkdtempSync(join(tmpdir(), "paper-reader-sp-"));
const ctx6 = makeCtx(base6, { withSandboxPolicy: true });
await upsertConcept(ctx6, { name: "测试概念", nameEn: "Test Concept", category: "core", summary: "测试" }, exec(base6));
const writes = ctx6._writeCalls;
check("writeText 收到 policy", writes.length > 0 && writes[writes.length - 1].policy !== undefined);
check("policy.workspaceRoot = session cwd", writes[writes.length - 1]?.policy?.workspaceRoot === base6);
check("policy.mode 为 workspace-write", writes[writes.length - 1]?.policy?.mode === "workspace-write");

console.log("\n[7] 无 sandboxPolicy 时 policy 为 undefined（非 confining backend）");
const base7 = mkdtempSync(join(tmpdir(), "paper-reader-nosp-"));
const ctx7 = makeCtx(base7);
await upsertConcept(ctx7, { name: "另一个概念", nameEn: "Another", category: "core", summary: "测试" }, exec(base7));
check("无 policy 也能写（backend 默认）", ctx7._writeCalls.length > 0 && ctx7._writeCalls[ctx7._writeCalls.length - 1].policy === undefined);

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed === 0 ? 0 : 1);
