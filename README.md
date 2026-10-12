# PQC 科研工作流平台 · 一期工程

一期交付了「论文带学 + Wiki 知识库」：丢入论文 → 老师式对话带学 → 中英对照 → 前置→核心映射 → 沉淀成可复用、可持续生长的全局知识库。

> 这是后量子密码（PQC）项目组科研工作流平台的第一期，聚焦"读论文 + 沉淀知识"。二期（WeKnora 语义检索）、写论文（多模型辩论）、算法审核在后续推进。

## 一期成果

### paper-reader 插件（三件套）

| 部件 | 载体 | 职责 |
|---|---|---|
| skill `paper-reader` | `paper-reader/assets/paper-reader.md` | 带学方法论：对话式发问、前置知识可跳过、双语三层、检索复用 |
| command `/readpaper` | `paper-reader/index.js` | 收 PDF 附件，触发带学 |
| tool `upsert_concept` | `paper-reader/index.js` | 概念去重 + 双链 + graph.json 一致性 |

### 知识库 wiki

- `graph.json`：全库知识图谱（实体 + 关系），`prerequisite_of` 边表达「前置→核心」映射
- 概念页全库唯一、自动去重、跨论文复用
- 论文页（讲义）、术语表（中英对照）
- **检索增强**：带学前自动查已有知识，已沉淀概念复用、未沉淀详讲

### 配套（团队协作）

- `team-wiki/`：中心仓库骨架（分布式使用 + 集中管理的目录规范、权限配置、CODEOWNERS）
- `scripts/merge-wiki.mjs`：跨用户概念合并脚本（把多人 wiki 合并成 canonical）
- `scripts/import-weknora.md`：WeKnora 批量导入方案

## 目录结构

```
default-workspace/
├── README.md                    # 本文件
├── DESIGN.md                    # 完整设计文档（数据 schema、三层架构、分阶段计划）
├── WEKNORA_INTEGRATION.md       # 二期 WeKnora 接入指南
├── paper-reader-guide.html      # 面向老师的业务介绍页
├── paper-reader/                # 插件 bundle（三件套）
│   ├── index.js                 # skill provider + command + tool
│   ├── assets/paper-reader.md   # skill 正文（文件承载，改它无需重启）
│   ├── package.json             # bundle manifest
│   ├── cordis.patch.yml         # loader patch
│   ├── locale/{en,zh}.json      # 显示元数据
│   └── test/upsert_concept.test.mjs  # 21 项单元测试
├── paper-wiki/                  # 端到端验证生成的示例 wiki
├── scripts/                     # 团队协作脚本
│   ├── merge-wiki.mjs           # 跨用户合并
│   └── import-weknora.md        # WeKnora 导入
├── team-wiki/                   # 中心仓库骨架（模板）
└── docs/
    └── plugin-development.md    # DSH 插件开发经验（踩坑总结，见下）
```

## 快速开始

### 1. 安装插件

在 DSH 会话中：

```
plugin_manager install_bundle <paper-reader 目录绝对路径>
```

安装后 skill `paper-reader`、命令 `/readpaper`、工具 `upsert_concept` 三者同时可用。

### 2. 使用

1. 把论文 PDF 拖进对话，输入 `/readpaper`，或直接说"读这篇论文 / 带读 / 精读"；
2. 跟着老师的提问走——先发问、再讲解，答对简讲、答错纠偏、说"不知道"走完整讲解；
3. 前置知识环节可跳过；带学前会**自动检索已有知识**，已沉淀的概念简述带过、只详讲新的；
4. 结束自动落盘到当前工作区的 `paper-wiki/`。

### 3. 跑测试

```bash
node paper-reader/test/upsert_concept.test.mjs
```

## 使用说明（带学七步）

```
解析论文 → 检索已有知识 → 开场(告知复用) → 前置知识(可跳过) → 核心内容 → 实验/局限 → 落盘
```

- **中英对照三层**：术语表 + 核心段落逐段对照 + 其余中文讲解
- **前置→核心映射**：每个核心概念标注它依赖哪些前置知识（`prerequisite_of` 边 + `why`）
- **检索复用**：已沉淀概念直接引用、不重复讲；落盘报告区分"新增/复用"数量

## 架构设计

三层数据架构（详见 `DESIGN.md`）：

```
本地 md + graph.json（真源，git/GitHub）
    ├─ 二期同步 → 钉文档/协作层
    └─ 二期导入 → WeKnora（语义检索/问答，智能层）
```

## 开发指南

### 调提示词（无需重启）

skill 正文是纯 Markdown（`paper-reader/assets/paper-reader.md`），**每次加载重新读取**，改它**无需重启**。拆分层级（第 0~6 节）、提问节奏、讲解风格都在这里调。

### 改代码（需重启）

`paper-reader/index.js` 是插件代码，改它**必须重启 DSH 才生效**（模块缓存）。

### 插件开发经验

DSH 插件开发的踩坑总结（零外部依赖、fs cwd 传递、sandbox policy、模块缓存、BOM 容错等）见 **[docs/plugin-development.md](docs/plugin-development.md)**，其他同学开发新插件前先读。

## 已知约束与坑

| 坑 | 说明 |
|---|---|
| 改 index.js 需重启 | DSH 模块缓存，remove+install 和改入口名都无法绕过 |
| 改 assets/*.md 无需重启 | skill 正文每次加载重读 |
| 外部 bundle 零依赖 | 不能 import `@deepseek-ai/dsh-*`，用 node 内置 + ctx 服务 |

## 后续规划

- **二期**：WeKnora 智能层（语义检索/问答，见 `WEKNORA_INTEGRATION.md`）
- **写论文**：期刊 LaTeX 模板 + 多模型辩论（research-council 插件）
- **算法审核**：理论/实际安全性判断 + 检测脚本 + 评估报告

## 工程与知识内容分仓

本仓库（仓库 A）分发插件、协作脚本、文档和 team-wiki 空模板。paper-wiki、成员 wiki 和合并生成物由独立的知识内容仓库（仓库 B）管理。

1. 克隆本仓库，使用 paper-reader/ 的绝对路径安装插件。
2. 将 team-wiki/ 模板复制到独立的仓库 B，不复制工程仓库的 .gitignore。
3. 将本地 paper-wiki/ 种子内容复制到仓库 B 的 users/<真实成员名>/wiki/，保留 concepts、papers、glossary.md 和 graph.json。
4. 运行 `node scripts/merge-wiki.mjs <仓库B的绝对路径>`，审核后在仓库 B 提交成员内容、merged/ 和根目录 graph.json。

工程仓库忽略所有成员目录和合并生成物；alice、bob 仅为本地测试数据。仓库 B 的远程地址由团队另行配置。