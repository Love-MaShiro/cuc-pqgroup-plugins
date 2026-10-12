# 二期工程：WeKnora 接入指南

把 WeKnora 接入 paper-reader 的 wiki 知识库作为**智能层**，为 DSH agent 提供语义检索与 RAG 问答能力。

## 架构分工

```
paper-wiki/（本地真源，一期已建成）
├── graph.json         ← paper-reader 的知识图谱真源（前置→核心映射）
├── concepts/*.md      ← 概念页
├── papers/*.md        ← 论文讲义页
└── glossary.md        ← 术语表
        │ 导入（Markdown 文档）
        ▼
WeKnora（智能层，部署在服务器）
├── 向量检索 + 混合检索（keyword + vector）
├── RAG 问答（带引用）
└── 知识图谱（Neo4j，从文档自动抽取）
        ▲ 4 个只读工具
        │
DSH agent（weknora_search / read_document / ask / list_knowledge_bases）
```

> 说明：graph.json 是 paper-reader 的本地真源，**不直接导入 WeKnora**（WeKnora 的知识图谱是从文档内容自动抽取实体/关系，走 GraphRAG）。导入的是 concepts/ 和 papers/ 的 Markdown 文档，WeKnora 会自动建立自己的向量索引与图谱。两者并存、互不冲突。

## 一、服务器部署 WeKnora

要求：Docker + Docker Compose + Git（服务器上）。

```bash
git clone https://github.com/Tencent/WeKnora.git
cd WeKnora
cp .env.example .env
# 编辑 .env（见下方「模型配置」）
docker compose pull
docker compose up -d          # 默认：app + docreader + frontend + nginx + postgres + redis
# 需要知识图谱时再加 --profile neo4j
```

部署后：
- Web UI：`http://服务器IP:80`
- 后端 API：`http://服务器IP:8080`

## 二、模型配置（.env 关键项）

WeKnora 需要 **LLM + embedding** 两类模型。

### LLM（用 DeepSeek）

在 .env 配置内置模型，或进入 Web UI「设置 → 模型」添加 DeepSeek：

```ini
# .env 里内置模型声明式配置（配合 config/builtin_models.yaml）
LLM_MODEL_NAME=deepseek-chat
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-你的DeepSeekKey
LLM_PROVIDER=openai
```

### Embedding（千问 Qwen，OpenAI 兼容）

用千问的轻量级向量模型 **qwen3.7-text-embedding-flash**（201 种语言、上下文 131K、约 ¥0.125/M tokens）：

```ini
EMBEDDING_MODEL_NAME=qwen3.7-text-embedding-flash
EMBEDDING_BASE_URL=https://maas.qianwenaiapi.com/compatible-mode/v1
EMBEDDING_API_KEY=${QWEN_EMBEDDING_API_KEY}   # 千问 AI 平台的 key（sk-ws-... 开头），勿提交 git
EMBEDDING_PROVIDER=openai
```

> 部署时把实际 key 设到环境变量：`export QWEN_EMBEDDING_API_KEY=sk-ws-...`。

## 三、导入 wiki 文档

WeKnora 支持 Markdown 文档导入，且文件夹上传会保留目录树。

### 方式 A：Web UI

1. 打开 `http://服务器IP:80`，完成 onboarding；
2. 创建知识库（如 `paper-wiki`）；
3. 上传 `paper-wiki/concepts/` 和 `paper-wiki/papers/` 目录下的 md 文件（保留目录结构）。

### 方式 B：CLI `weknora`

```bash
weknora profile add prod --host https://服务器IP --use
weknora auth login
weknora kb create paper-wiki
weknora doc upload concepts/*.md
weknora doc upload papers/*.md
```

### 方式 C：REST API

```bash
# 创建知识库
curl -X POST https://服务器IP/api/v1/knowledge-bases \
  -H "Authorization: Bearer <token>" -d '{"name":"paper-wiki"}'
# 上传文档
curl -X POST https://服务器IP/api/v1/knowledge-bases/<kb_id>/documents \
  -F "file=@concepts/self-attention.md"
```

## 四、配置 dsh-weknora 插件

插件已安装（`@wxg-prc-cpg/dsh-weknora`），4 个工具已注册，但**默认指向 `http://localhost:8080/api/v1`，需要在服务器部署后改配置**。

在 `$DSH_HOME/profiles/<name>/cordis.patch.yml` 加一行（或覆盖现有 weknora row）：

```yaml
- id: weknora
  name: "@wxg-prc-cpg/dsh-weknora"
  config:
    baseUrl: https://服务器IP/api/v1      # WeKnora 后端
    apiKey: sk-...                        # WeKnora API key（retrieve + chat 权限）
    knowledgeBaseIds:                     # 可选：默认只检索的 KB
      - <kb_id>
    agentId: ""                           # 可选：自定义 agent 用 ReAct 管线
    maxResults: 8
    maxChunkChars: 1200
```

> `apiKey` 在 WeKnora Web UI「设置 → API Keys」生成，需勾选 `retrieve`（前三个工具）和 `chat`（weknora_ask）权限。

## 五、使用方式

配置完成后，DSH agent 即可在对话中调用：

| 场景 | 工具 |
|---|---|
| 查"Transformer 的注意力机制"在哪篇文档 | `weknora_search` |
| 读某个概念的完整上下文 | `weknora_read_document` |
| 综合问答（跨多文档） | `weknora_ask` |
| 报告有哪些知识库 | `weknora_list_knowledge_bases` |

## 六、当前状态

| 项 | 状态 |
|---|---|
| dsh-weknora 插件安装 | ✅ 已安装，4 工具已注册 |
| WeKnora 部署 | ⏳ 待服务器部署（本机 Docker daemon 未启动，且决定部署到服务器） |
| 模型配置 | ⏳ 待部署时定（LLM=DeepSeek，embedding=第三方 API） |
| wiki 文档导入 | ⏳ 待部署后执行 |
| 插件配置（baseUrl/apiKey） | ⏳ 待部署后填 |

## 待办清单（服务器就绪后）

1. 在服务器部署 WeKnora（Docker Compose）
2. 配置 LLM（DeepSeek）+ embedding（第三方 API）
3. 创建知识库 + 导入 paper-wiki 的 md
4. 在 Web UI 生成 API key
5. 回填 cordis.patch.yml 的 weknora row（baseUrl + apiKey + knowledgeBaseIds）
6. 重启 DSH 后验证 weknora_search / weknora_ask
