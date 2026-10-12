# 论文带学 + Wiki 知识库插件（paper-reader）设计文档

> 状态：设计已收敛（v1 初稿），待动工
> 载体：DSH 插件 bundle（skill + command + tool）

---

## 1. 目标与定位

丢入一篇论文 PDF，以**老师上课**的方式带你读论文：中英对照、拆成前置知识与核心内容等部分、并在前置知识→核心内容之间建立可追溯的映射；最终沉淀为一个**可复用、可持续生长的全局知识库 wiki**（参考 [Tencent/WeKnora](https://github.com/Tencent/WeKnora) 的知识单元 + 关系图谱思想）。

核心体验 = **对话式启发带学**（老师先发问 → 按你的回答展开讲解），wiki 是带学过程的**沉淀副产物**（无论你怎么带学，最终都落盘成完整 wiki）。

---

## 2. 最终形态总览

### 2.1 工具三件套（仓库 A：插件，打包成 DSH bundle）

| 部件 | 载体 | 职责 |
|---|---|---|
| Skill `paper-reader` | SKILL.md（文件，**user 级**，可热改） | 完整方法论指令：解析 → 双语三层 → 对话式带学 → 映射 → 落盘 |
| Command `/readpaper` | JS 代码 | 入口：`input.attachments:true` 收 PDF，触发流程 |
| Tool `upsert_concept` | JS 代码 | 概念去重 + 双链 + graph.json 一致性（复用质量靠它锁死） |
| Tool `extract_pdf_text`（可选） | JS 代码 | PDF 文本/公式/图/表抽取 |

### 2.2 数据三层（仓库 B：知识库内容）

```
本地 md + graph.json（真源，git/GitHub）
        │ 二期同步                     │ 三期导入
        ▼                              ▼
钉文档（协作层，人看）          WeKnora（智能层，语义检索/问答）
```

- **真源层**：本地 `md + graph.json`，git 版本管理，GitHub 托管。唯一可信数据源，可 diff / PR / 回滚 / 迁移 / 复用。
- **协作层（二期）**：钉文档，人看的在线投影（团队生态确定后接）。
- **智能层（三期，可选）**：WeKnora，机器用的语义检索 / 问答，直接导入 graph.json。

---

## 3. 数据层设计（仓库 B：知识库）

### 3.1 目录结构

```
paper-wiki/
├── README.md                 # 知识库说明、如何贡献、如何看图谱
├── graph.json                # ★ 全库知识图谱（机器读，对齐 WeKnora 实体/关系模型）
├── glossary.md               # ★ 全局术语表（中英对照，跨论文统一）
├── concepts/                 # 概念页（全局唯一，跨论文复用，前置/核心都在这里）
│   └── self-attention.md
│   └── transformer.md
├── papers/                   # 论文入口页（每篇论文一份"讲义"）
│   └── attention-is-all-you-need.md
│   └── attention-is-all-you-need/
│       ├── source.pdf
│       └── bilingual.md      # 核心段落中英对照（长文时单独拆出）
└── .obsidian/                # 可选：Obsidian 配置（图谱视图）
```

要点：概念页**全库唯一**（一个概念只建一页，新论文直接 `[[引用]]`）；graph.json 与 md 双链**必须一一对应**（由 `upsert_concept` 保证）。

### 3.2 graph.json schema（对齐 WeKnora 实体/关系模型）

```jsonc
{
  "version": "1.0.0",
  "meta": { "name": "paper-wiki", "generator": "dsh-paper-reader", "updatedAt": "" },

  "entities": [
    {
      "id": "concept:self-attention",       // 命名空间:id，全局唯一
      "type": "concept",                    // concept | paper | term
      "name": "自注意力机制",
      "nameEn": "Self-Attention",
      "slug": "self-attention",             // 决定 md 文件名，全库唯一
      "category": "prerequisite",           // prerequisite | core | background | method | result
      "aliases": ["self attention", "自注意力"],
      "summary": "让序列中每个位置直接加权聚合其他位置信息的机制",
      "page": "concepts/self-attention.md", // 指向 md
      "papers": ["paper:attention-is-all-you-need"],
      "properties": {}
    },
    {
      "id": "paper:attention-is-all-you-need",
      "type": "paper",
      "name": "Attention Is All You Need",
      "nameZh": "注意力即一切",
      "slug": "attention-is-all-you-need",
      "page": "papers/attention-is-all-you-need.md",
      "properties": { "arxiv": "1706.03762", "year": 2017 }
    }
  ],

  "relations": [
    {
      "id": "rel:...",
      "type": "prerequisite_of",            // 方向约定：source(前置) → target(核心)
      "source": "concept:self-attention",
      "target": "concept:transformer",
      "why": "self-attention 是 Transformer 的核心计算单元，替换了 RNN 的循环结构",
      "papers": ["paper:attention-is-all-you-need"]
    }
  ]
}
```

**方向约定（固定）**：`prerequisite_of` 永远是 **前置知识 → 核心内容**；`why` 存"为什么需要它"。可扩展关系类型：`builds_on`（核心→延伸）、`cites`（论文→引用）、`exemplifies`（论文→概念）。

### 3.3 md 模板（讲义结构 + 混合风格 + 双链）

**论文页** `papers/<slug>.md`：

```markdown
---
type: paper
title: Attention Is All You Need
titleZh: 注意力即一切
arxiv: 1706.03762
year: 2017
---

# 《Attention Is All You Need》讲义

## 0. 一句话看懂
> **要点**：…   **讲解**：…

## 1. 背景与动机
## 2. 前置知识
- [[self-attention|自注意力]] — 为什么需要：…
- [[sequence-to-sequence|Seq2Seq]] — 为什么需要：…

## 3. 核心内容
### 3.1 核心问题定义
### 3.2 方法
> 原文：“…”  译文：“…”（核心段落中英对照）
### 3.3 关键设计取舍
### 3.4 与已有工作的关系

## 4. 实验与证据
## 5. 局限 / 争议 / 展望
## 6. 延伸阅读
```

**概念页** `concepts/<slug>.md`：

```markdown
---
type: concept
name: 自注意力机制
nameEn: Self-Attention
category: prerequisite
aliases: [self-attention, 自注意力]
---

# 自注意力机制
> **一句话**：…

## 是什么
## 为什么需要它（被哪些论文用到）
- 被 [[attention-is-all-you-need|Transformer]] 用来：…（prerequisite_of → transformer）
## 自身的前置
- [[attention-mechanism|注意力机制]]
```

**术语表** `glossary.md`：

```markdown
| 英文 | 中文 | 一句话解释 | 出处论文 |
|---|---|---|---|
| self-attention | 自注意力 | 序列内位置间直接加权聚合 | [[attention-is-all-you-need]] |
```

### 3.4 中英对照三层

1. **术语表**：全库统一（glossary.md），跨论文复用；
2. **核心段落逐段对照**：原文英文引用 + 中文翻译，**交错块**（md 最稳；并排两栏留待二期查看器）；
3. **其余部分**：中文讲解为主，关键句标注英文原文。

---

## 4. 交互层设计（对话式启发带学）★

### 4.1 总体流程

```
丢入 PDF + /readpaper
   │
   ▼
① 解析 + 双语 + 术语抽取（后台，不打扰用户）
   │
   ▼
② 对话式带学（主线）：
   ├─ 开场：一句话 TL;DR + 说明带学方式
   ├─ 【前置知识】列出清单 → 问是否跳过 →（不跳过则逐个带学）
   ├─ 【背景与动机】先发问 → 按回答讲解
   ├─ 【核心内容】每个核心点：先发问 → 按回答讲解（中英对照穿插）
   ├─ 【实验 / 局限 / 展望】同理
   └─ 全程允许：跳过 / "直接给我结论"
   │
   ▼
③ 落盘 wiki（无论是否跳过，最终都生成完整讲义 md + graph.json + glossary）
```

### 4.2 提问 → 回答 → 定制讲解（核心机制）

- 每个知识点，老师**先抛 1 个引导问题**，等用户回答，再展开讲解；
- 讲解深度**依据回答**定制（见 4.4）；
- 带学过程与 wiki 落盘分离：带学是对话节奏，wiki 是完整沉淀，两者不互相打断。

### 4.3 前置知识可跳过

- 进入【前置知识】前，**明确询问**："是否跳过前置知识？"；
- 跳过 → 直接进核心内容，但清单保留、可随时回看，且 wiki 落盘时前置知识**照常完整写入**；
- 不跳过 → 逐个前置概念带学（同样先发问 → 按回答讲解）；单个概念也允许跳过。

### 4.4 回答适配策略

| 用户回答 | 老师反应 |
|---|---|
| 答对 / 答得好 | 简短确认 + 精炼讲解，不啰嗦 |
| 答错 / 有误区 | 指出误区 + 详细讲解纠偏 |
| "不知道 / 跳过" | 走默认完整讲解路径 |

---

## 5. 工具三件套设计（仓库 A）

### 5.1 Skill `paper-reader`（SKILL.md，方法论）

正文只写方法论，不写死代码。核心约束：

- 拆分层级（第 0~6 节）作为**独立段落**，便于单独调优每段提示词；
- 混合风格 = 每节先"要点"再"讲解"；
- 双语三层 = 术语表全局统一 + 核心段落逐段交错对照 + 其余中文讲解；
- **对话式带学**：先发问 → 按回答定制讲解；前置知识环节询问是否跳过；
- **任何"新增/复用概念、建双链、更新图谱"都必须走 `upsert_concept`，禁止手写**（保证全局库不脏）。

### 5.2 Command `/readpaper`

`input.attachments:true` → 收 PDF 存到 `papers/<slug>/source.pdf` → 通知 agent 加载 `paper-reader` skill 执行全流程。

### 5.3 Tool `upsert_concept`（代码，锁死一致性）

```jsonc
// 输入
{
  "name": "自注意力机制",
  "nameEn": "Self-Attention",
  "category": "prerequisite",
  "summary": "…",
  "aliases": ["self attention"],
  "prerequisitesOf": [ { "target": "concept:transformer", "why": "…" } ],
  "usedByPapers": ["paper:attention-is-all-you-need"]
}
// 输出
{ "conceptId": "concept:self-attention", "slug": "self-attention",
  "created": true, "updatedRefs": ["concepts/self-attention.md", "graph.json"] }
```

逻辑：按 name/nameEn/aliases 查 graph.json → 命中则复用（只追加 papers 引用与边）→ 未命中则新建概念页 + 实体节点 + 关系边，md 与 graph.json **同源写入**。

### 5.4 可选 Tool `extract_pdf_text`

输入 PDF 路径 → 输出结构化文本 + 公式/图/表位置标记（可复用 agent 现有解析能力，作为增强项）。

---

## 6. 版本管理与分发

两个 git 仓库，职责分开：

| 仓库 | 内容 | 谁用 |
|---|---|---|
| **仓库 A：插件/skill 仓库** | SKILL.md + command + tool 代码，打包成 DSH bundle，发布 GitHub/npm | 老师与同学（install 即用） |
| **仓库 B：知识库仓库** | wiki 本体（md + graph.json），团队共享知识资产 | 团队成员（clone / fork / PR） |

- 工具迭代：改 SKILL.md（文件承载）→ commit → 发版 → 同学 `install_bundle` 更新；
- 内容迭代：读完一篇 → 提交一篇 wiki → PR → 合并，知识库持续生长。

---

## 7. 分阶段计划

- **一期（本次）**：skill(SKILL.md) + `/readpaper` + `upsert_concept` 最小闭环 → 用真实论文（Transformer）跑通并验证 → 按效果调 SKILL.md 提示词。
- **二期**：协作层——钉文档同步（团队生态确定后接）。
- **三期（可选）**：智能层——导入 WeKnora，获得语义检索 / 问答。

---

## 8. 待迭代与调优项

- 第 0~6 节的拆分层级：通过不断调整 SKILL.md 各段提示词来优化效果；
- 提问的粒度与节奏（每核心点 vs 仅关键点）：留作调优项；
- 中英对照的并排两栏展示：二期查看器阶段支持。
