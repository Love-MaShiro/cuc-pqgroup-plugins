import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// 手写 createUserMessage，等价于 @deepseek-ai/dsh-llm 的 createUserMessage：
// { ...input, id: brandString(randomUUID()), role: "user" }。
// 外部 bundle 无法 import dsh 自带包，故用 node 内置 crypto 自造，做到零外部依赖。
function createUserMessage(input) {
  return { ...input, id: randomUUID(), role: "user" };
}

// ---------------------------------------------------------------------------
// paper-reader — 论文带学 + Wiki 知识库插件
// 一个 bundle 内注册三样东西：
//   1. bundled skill `paper-reader`（正文在 assets/paper-reader.md，文件承载可热改）
//   2. command `/readpaper`（收 PDF 附件，通过 followup 触发 agent 带学）
//   3. tool `upsert_concept`（概念去重 + 双链 + graph.json 一致性）
// ---------------------------------------------------------------------------

const name = "paper-reader";
const inject = ["skills", "commands", "tools", "fs"];

const WIKI_DIR = "paper-wiki";
// bundled skill rank（对齐 dsh-skill 的 BUNDLED_SKILL_RANK，避免额外依赖故用字面量）
const BUNDLED_SKILL_RANK = 600;

// ===========================================================================
// 1. bundled skill provider（照搬 dsh-skill-badge 的不可变 provider 模式）
// ===========================================================================
const PROVIDER_NAME = "paper-reader";
const SKILL_BODY_URL = new URL("./assets/paper-reader.md", import.meta.url);
const RESOURCE_BASE = {
  kind: "directory",
  path: fileURLToPath(new URL("./assets/", import.meta.url)),
};
const SKILL_DESCRIPTION =
  "带读一篇论文：解析正文、中英对照（术语表 + 核心段落逐段 + 其余中文讲解），以老师上课的对话式带学（先发问、按回答讲解、前置知识可跳过）拆解前置知识与核心内容，并把前置→核心的映射与全部知识沉淀进一个可复用的全局 wiki（graph.json + 概念页 + 论文页）。当用户丢入论文 PDF 或说“读这篇论文/带读/精读/讲读”时使用。";

const CANDIDATE = {
  name: PROVIDER_NAME,
  description: SKILL_DESCRIPTION,
  invocation: { modelInvocable: true, userInvocable: true },
  provider: PROVIDER_NAME,
  source: "bundled",
  resourceBase: RESOURCE_BASE,
  rank: BUNDLED_SKILL_RANK,
  locator: SKILL_BODY_URL,
};
const skillProvider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([CANDIDATE]),
  async get() {
    return {
      name: CANDIDATE.name,
      description: CANDIDATE.description,
      invocation: CANDIDATE.invocation,
      provider: CANDIDATE.provider,
      source: CANDIDATE.source,
      resourceBase: RESOURCE_BASE,
      content: await readFile(SKILL_BODY_URL, "utf8"),
    };
  },
};

// ===========================================================================
// 2. 工具函数：slug、graph.json 读写
// ===========================================================================
function slugify(value) {
  return String(value ?? "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function defaultGraph() {
  return { version: "1.0.0", meta: { generator: "dsh-paper-reader" }, entities: [], relations: [] };
}

async function readJson(ctx, path, cwd, signal) {
  const target = await ctx.fs.resolve(path, { ...(cwd ? { cwd } : {}), signal });
  const info = await ctx.fs.stat(target, signal);
  if (info === undefined || info.type !== "file") return undefined;
  try {
    return JSON.parse(await ctx.fs.readText(target, signal));
  } catch {
    return undefined;
  }
}

async function writeText(ctx, path, content, cwd, signal, policy) {
  const target = await ctx.fs.resolve(path, { ...(cwd ? { cwd } : {}), signal });
  await ctx.fs.writeText(target, content, undefined, signal, policy);
}

async function readGraph(ctx, cwd, signal) {
  const graph = await readJson(ctx, `${WIKI_DIR}/graph.json`, cwd, signal);
  return graph && typeof graph === "object" && Array.isArray(graph.entities) ? graph : defaultGraph();
}

function writeGraph(ctx, cwd, graph, signal, policy) {
  return writeText(ctx, `${WIKI_DIR}/graph.json`, JSON.stringify(graph, null, 2) + "\n", cwd, signal, policy);
}

function conceptPageMarkdown(concept) {
  const lines = ["---", "type: concept", `name: ${concept.name}`];
  if (concept.nameEn) lines.push(`nameEn: ${concept.nameEn}`);
  lines.push(`category: ${concept.category}`);
  if (concept.aliases?.length) lines.push(`aliases: ${JSON.stringify(concept.aliases)}`);
  lines.push("---", "", `# ${concept.name}`, "", `> **一句话**：${concept.summary ?? "（待补充）"}`);
  lines.push("", "## 是什么", "", "（待补充讲解）", "", "## 为什么需要它（被哪些论文用到）", "", "## 自身的前置", "");
  return lines.join("\n");
}

// ===========================================================================
// 3. tool：upsert_concept（概念去重 + 双链 + graph.json 一致性）
// ===========================================================================
async function upsertConcept(ctx, args, exec) {
  const cwd = exec.agent?.session?.header?.cwd;
  const signal = exec.signal;
  const session = exec.agent?.session;
  const sandboxPolicyService = ctx.get("sandboxPolicy");
  const policy = sandboxPolicyService && session ? sandboxPolicyService.resolve({ session }) : undefined;
  const slug = slugify(args.nameEn || args.name);
  if (!slug) throw new Error("无法从 name/nameEn 生成有效 slug");

  const graph = await readGraph(ctx, cwd, signal);
  const now = new Date().toISOString();

  // 去重：按 slug / name / nameEn / aliases 命中即复用
  let entity = graph.entities.find(
    (e) =>
      e.slug === slug ||
      e.name === args.name ||
      (args.nameEn && e.nameEn && e.nameEn.toLowerCase() === args.nameEn.toLowerCase()) ||
      (args.aliases?.length && e.aliases?.length && args.aliases.some((a) => e.aliases.includes(a))),
  );

  const created = entity === undefined;
  if (created) {
    entity = {
      id: `concept:${slug}`,
      type: "concept",
      name: args.name,
      nameEn: args.nameEn ?? "",
      slug,
      category: args.category ?? "core",
      aliases: args.aliases ?? [],
      summary: args.summary ?? "",
      page: `concepts/${slug}.md`,
      papers: [],
      properties: {},
    };
    graph.entities.push(entity);
  }

  // 合并字段（复用时不覆盖已有摘要，只补空）
  entity.category = args.category ?? entity.category ?? "core";
  if (!entity.summary && args.summary) entity.summary = args.summary;
  if (args.nameEn && !entity.nameEn) entity.nameEn = args.nameEn;
  const aliases = new Set([...(entity.aliases ?? []), ...(args.aliases ?? [])]);
  entity.aliases = [...aliases];
  entity.papers = entity.papers ?? [];
  for (const p of args.usedByPapers ?? []) {
    if (!entity.papers.includes(p)) entity.papers.push(p);
  }

  // 映射边：prerequisitesOf = 前置 → 核心
  for (const edge of args.prerequisitesOf ?? []) {
    const targetSlug = slugify(edge.target);
    if (!targetSlug) continue;
    const targetId = `concept:${targetSlug}`;
    // 目标概念若不存在，建一个占位实体（core）
    if (!graph.entities.some((e) => e.id === targetId)) {
      graph.entities.push({
        id: targetId,
        type: "concept",
        name: edge.target,
        nameEn: "",
        slug: targetSlug,
        category: "core",
        aliases: [],
        summary: "",
        page: `concepts/${targetSlug}.md`,
        papers: [...(args.usedByPapers ?? [])],
        properties: {},
      });
    }
    const relId = `rel:${slug}-${targetSlug}`;
    const existingRel = graph.relations.find((r) => r.id === relId);
    if (existingRel) {
      if (edge.why && !existingRel.why) existingRel.why = edge.why;
    } else {
      graph.relations.push({
        id: relId,
        type: "prerequisite_of",
        source: `concept:${slug}`,
        target: targetId,
        why: edge.why ?? "",
        papers: [...(args.usedByPapers ?? [])],
      });
    }
  }

  // 写概念页（新建才写，复用不改内容避免覆盖已有讲解）
  if (created) {
    await writeText(ctx, `${WIKI_DIR}/${entity.page}`, conceptPageMarkdown(entity), cwd, signal, policy);
  }
  graph.meta = { ...(graph.meta ?? {}), generator: "dsh-paper-reader", updatedAt: now };
  await writeGraph(ctx, cwd, graph, signal, policy);

  return {
    conceptId: entity.id,
    slug: entity.slug,
    created,
    updatedRefs: [`${WIKI_DIR}/${entity.page}`, `${WIKI_DIR}/graph.json`],
  };
}

// ===========================================================================
// 4. command：/readpaper（收 PDF，followup 触发 agent 加载 skill）
// ===========================================================================
function executeReadpaper(ctx, invocation) {
  if (invocation.attachments.length === 0) {
    return {
      kind: "error",
      text: "请附上论文 PDF 文件后再执行 /readpaper。",
    };
  }
  invocation.agent.followup(
    createUserMessage({
      content: [
        ...invocation.attachments,
        {
          type: "text",
          text: "请加载 paper-reader skill，对以上论文附件执行完整的对话式带学流程（先发问、按回答讲解、前置知识可跳过），并最终把知识落盘到 paper-wiki/。",
        },
      ],
      source: { kind: "user" },
    }),
  );
  return { kind: "success", text: "论文已收到，正在开始带学……" };
}

// ===========================================================================
// 5. apply
// ===========================================================================
function apply(ctx) {
  ctx.skills.registerProvider(() => skillProvider);

  ctx.commands.register({
    name: "readpaper",
    description: "带读一篇论文：解析、中英对照、对话式带学并沉淀成 wiki",
    input: { hint: "[可选说明]", attachments: true },
    handler: (invocation) => executeReadpaper(ctx, invocation),
  });

  ctx.tools.register({
    name: "upsert_concept",
    description:
      "向全局 wiki 知识库 upsert 一个概念：按 name/nameEn/aliases 去重（命中则复用），新建时写概念页，同时把“前置→核心”映射边（prerequisite_of）写进 graph.json。这是唯一写概念页/双链/图谱的入口，禁止手写 graph.json。",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string", description: "概念中文名" },
        nameEn: { type: "string", description: "概念英文名，用于生成 slug" },
        category: {
          type: "string",
          enum: ["prerequisite", "core", "background", "method", "result"],
          description: "概念类别：前置知识/核心/背景/方法/结论",
        },
        summary: { type: "string", description: "一句话解释" },
        aliases: { type: "array", items: { type: "string" }, description: "别名数组" },
        prerequisitesOf: {
          type: "array",
          description: "前置→核心映射边（本概念作为前置，指向核心概念）",
          items: {
            type: "object",
            properties: {
              target: { type: "string", description: "核心概念的 slug 或英文名" },
              why: { type: "string", description: "为什么需要这个前置" },
            },
            required: ["target"],
          },
        },
        usedByPapers: { type: "array", items: { type: "string" }, description: "使用本概念的论文 slug" },
      },
      required: ["name", "category", "summary"],
    },
    output: {
      schema: {
        type: "object",
        properties: {
          conceptId: { type: "string" },
          slug: { type: "string" },
          created: { type: "boolean" },
          updatedRefs: { type: "array", items: { type: "string" } },
        },
      },
      render: (_args, value) => [
        {
          type: "text",
          text: (value.created ? "新建概念" : "复用概念") + ` ${value.slug}（${value.conceptId}）\n写入：${value.updatedRefs.join(", ")}`,
        },
      ],
    },
    async execute(args, exec) {
      return upsertConcept(ctx, args, exec);
    },
    presentCall(args) {
      return { card: "generic", title: `Upsert 概念 ${args.name}`, kind: "other", rawInput: args };
    },
  });
}

export { apply, inject, name, slugify, upsertConcept };
