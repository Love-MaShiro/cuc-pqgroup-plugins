# paper-reader —— 论文带学 + Wiki 知识库 DSH 插件

以**老师上课**的方式带你读论文：中英对照、对话式启发带学（先发问、按回答讲解、前置知识可跳过），最终把知识沉淀为一个**可复用、可持续生长的全局知识库 wiki**（参考 [Tencent/WeKnora](https://github.com/Tencent/WeKnora) 的知识单元 + 关系图谱思想）。

## 功能

- 丢入论文 PDF，自动解析正文
- **中英对照三层**：全局术语表 + 核心段落逐段对照 + 其余中文讲解
- **对话式启发带学**：老师先抛引导问题，按你的回答定制讲解（答对简讲 / 答错纠偏 / 不知道走完整讲解）
- **前置知识可跳过**：跳过不影响最终 wiki 完整性
- **前置 → 核心 映射**：每个核心概念都显式标注它依赖哪些前置知识（`prerequisite_of` 有向边 + "为什么需要"）
- **全局 wiki**：概念页全库唯一、跨论文自动去重复用；`graph.json` 记录知识图谱，为将来接入检索/问答（WeKnora）留好接口

## 组成

| 部件 | 载体 | 职责 |
|---|---|---|
| skill `paper-reader` | `assets/paper-reader.md` | 完整带学方法论（文件承载，改提示词即生效） |
| command `/readpaper` | `index.js` | 收 PDF 附件，触发 agent 带学 |
| tool `upsert_concept` | `index.js` | 概念去重 + 双链 + graph.json 一致性（复用质量靠它锁死） |

## 安装

> 依赖 DeepSeek Harness（dsh）。本 bundle 零外部依赖。

```bash
# 在 Harness 会话中对插件管理器执行：
# plugin_manager install_bundle <本目录绝对路径>
```

安装后：skill `paper-reader`、命令 `/readpaper`、工具 `upsert_concept` 三者同时可用。

## 使用

1. 把论文 PDF 拖入对话，输入 `/readpaper`；
2. 或直接说"读这篇论文 / 带读 / 精读"（模型会自动加载 `paper-reader` skill）；
3. 跟着老师的提问走，随时可说"跳过"或"直接讲"；
4. 结束后知识自动落盘到当前工作区的 `paper-wiki/`。

## Wiki 输出结构

```
paper-wiki/
├── graph.json        # 全库知识图谱（机器读，对齐 WeKnora 实体/关系模型）
├── glossary.md       # 全局术语表（中英对照）
├── concepts/         # 概念页（全局唯一，前置/核心都在这里）
│   └── <slug>.md
└── papers/           # 论文讲义入口页
    └── <slug>.md
```

- **方向约定**：`prerequisite_of` 永远是「前置知识 → 核心内容」。
- **概念复用**：同名/同别名概念只建一页，新论文直接引用，不重写。

## 调提示词

skill 正文在 `assets/paper-reader.md`，是纯 Markdown。改它即可调优拆分层级、提问节奏、讲解风格。**注意：DSH 对已安装包的代码修改需要重启 Harness 才能加载新模块**；纯正文（Markdown 文件）的修改由 skill provider 每次加载时重新读取，无需重启。

## 测试

```bash
node test/upsert_concept.test.mjs
```

## 目录

```
paper-reader/
├── index.js              # skill provider + command + tool
├── package.json          # bundle manifest
├── cordis.patch.yml      # loader patch
├── assets/paper-reader.md # skill 正文
├── locale/{en,zh}.json   # 显示元数据
└── test/upsert_concept.test.mjs
```

## 设计文档

完整设计见仓库根目录的 `DESIGN.md`（数据 schema、三层架构、分阶段计划）。
