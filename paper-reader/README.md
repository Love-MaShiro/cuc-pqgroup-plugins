# paper-reader —— 论文带学 + Wiki 知识库 DSH 插件

以**用户控制节奏**的方式带你读论文：先从 wiki 或可靠文献准备材料，再具体讲解与讨论；前置讲解可跳过，知识仍纳入可复用 wiki。

## 功能

- 丢入论文 PDF，自动解析正文
- **中英对照三层**：全局术语表 + 核心段落逐段对照 + 其余中文讲解
- **用户控制节奏**：先用具体例子讲清一个点，再按需列出易混淆处供选择；不机械凑题，提问后结束本轮，不补答未回答的问题。普通带读不创建 goal
- **前置知识可跳过**：“不知道”换具体例子重讲，“跳过”停止当前讲解；跳过的概念仍进入 wiki，教学进度与知识覆盖分开
- **材料指导教学**：介绍前置知识前检索并读取已有 wiki；缺失或不足时搜索、阅读可靠教材、读本或论文，核查定义与条件后补充知识库并用于教学
- **前置 → 核心 映射**：每个核心概念都显式标注它依赖哪些前置知识（`prerequisite_of` 有向边 + "为什么需要"）
- **全局 wiki**：概念页全库唯一、跨论文自动去重复用；`graph.json` 记录知识图谱，为将来接入检索/问答（WeKnora）留好接口

## 组成

| 部件 | 载体 | 职责 |
|---|---|---|
| skill `paper-reader` | `assets/paper-reader.md` | 完整带学方法论（文件承载，改提示词即生效） |
| command `/readpaper` | `readpaper.js`（由 `index.js` 注册） | 接收附件或导入指定 PDF 路径，触发 agent 带学 |
| tool `upsert_concept` | `index.js` | 概念去重 + 双链 + graph.json 一致性（复用质量靠它锁死） |

## 安装

> 依赖 DeepSeek Harness（dsh）。本 bundle 零外部依赖。

```bash
# 在 Harness 会话中对插件管理器执行：
# plugin_manager install_bundle <本目录绝对路径>
```

安装后：skill `paper-reader`、命令 `/readpaper`、工具 `upsert_concept` 三者同时可用。

## 使用

开始先在 `paper-reader-work/<paper-slug>/<reading-id>/template.md` 建立阅读草稿。准备和试讲只更新草稿、只读正式 wiki；模块完成且材料核查后才提交该模块。试用或测试默认不写正式真源。跳过讲解仍在草稿准备知识，完成模块后一起入库。模板在 `assets/reading-template.md`；由 agent 按指令建立工作副本，命令本身不直接写文件。

1. 把论文 PDF 拖入对话，等待上传完成，再与 `/readpaper` **同一次提交**；
2. 或直接说"读这篇论文 / 带读 / 精读"（模型会自动加载 `paper-reader` skill）；
3. 每次讨论一个点，随时可说“我想想”“跳过”“直接讲”；疑惑菜单无需全部回答；
4. wiki 按论文涉及的知识范围整理，包含跳过讲解的前置；阅读进度单独记录已讲、未讲和跳过，不为整理自动推进教学。

默认概念讲解；可选起始模式，后续用自然语言随时切换：

```text
/readpaper --mode=explain 我完全不懂 LWE
/readpaper --mode=discuss 只解释公式 2 的第二步
/readpaper @"./papers/paper.pdf" --mode=practice 给一个理解检查
```

普通带读不创建 goal；这是插件请求与教学规则，尚未证明宿主能够强制停止已有 goal 的续跑。实现依据、宿主边界与多轮评估见 [调研与分析](../docs/paper-reader-research.md)。

也可以直接指定 DSH 所在机器上的 PDF 路径，绕过 composer 的上传/收据传递环节：

```text
/readpaper @"F:\desktop\papers\论文 title.pdf" 重点讲解安全性证明
/readpaper @"./papers/paper.pdf" 跳过背景，先讲方法
/readpaper "./papers/paper.pdf"
```

开头支持 `@路径`、`@"路径"`、`"路径"` 和无空格的 `paper.pdf`；含空格的路径必须加引号。相对路径按当前会话工作目录解析。命令会通过 `ctx.fs` 读取 PDF，检查文件签名，再经 `attachments.saveFile` 保存为正式文件附件后交给 agent；仍受 DSH 文件访问权限约束。路径导入上限为 64 MiB，更大的文件使用 composer 上传。附件与路径可以同时提供，路径后的阅读要求会一并传给 agent。

**更新代码后需要重启 DSH**。若 profile 链接本仓库的 `paper-reader` 目录，重启即可加载；若使用复制的 bundle，需先更新安装目录再重启。

### “未收到附件”的处理

这表示 handler 没有收到文件块，不能据此断定上传失败或附件服务缺失。`input.attachments: true` 与 `invocation.attachments` 保持官方接口，无需改字段名。

- 文件必须与命令同次提交；此前已发出的附件不属于本次 `invocation.attachments`，本插件不会自动选择历史论文。
- `@路径` 是文本输入，不是 composer 上传；使用上面的路径语法即可直接导入。
- 已上传但仍报空：检查附件轨道是否 `ready` 且有 `receiptId`，再检查 `serializeDraftAttachments → claim.submit → commands.execute` 是否携带 `{ type: 'file', receiptId }`。
- 路径导入若报 `attachments 文件存储服务` 缺失，应检查当前 profile 的附件服务配置；文件不存在、权限拒绝和存储失败会分别保留具体错误。

本次核对的本机安装包为 `0.2.0-rc.2`（commit `04f392c9ddd144fa426da2045178797da6db6c11`），已包含上述 composer 转发逻辑。仅有源码与安装包版本不同，不能证明此链路缺失。本次改动提供插件层路径备用入口，未修改 DSH 客户端，也未验证 UI 空提交的具体触发原因。

### PDF 正文解析

导入成功表示文件已交给 agent，**不表示正文已解析**。本 bundle 不包含 PDF 解析库；若运行环境既无 `pdftotext`，也无 Python PDF 库，需要为 agent 实际使用的 Python 安装 `pypdf`（`<python可执行文件> -m pip install pypdf`），或配置其他 PDF 解析工具。扫描件还需要 OCR。不要把解析器缺失误报为附件缺失。

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
node --test test/readpaper.test.mjs
node test/upsert_concept.test.mjs
```

## 目录

```
paper-reader/
├── index.js              # skill provider + command + tool
├── readpaper.js          # 附件转发、PDF 路径导入与错误提示
├── package.json          # bundle manifest
├── cordis.patch.yml      # loader patch
├── assets/paper-reader.md # skill 正文
├── locale/{en,zh}.json   # 显示元数据
└── test/                 # readpaper 与 upsert_concept 回归测试
```

## 设计文档

完整设计见仓库根目录的 `DESIGN.md`（数据 schema、三层架构、分阶段计划）。
