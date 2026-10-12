# WeKnora 批量导入方案

把 `team-wiki/merged/` 的 canonical 内容批量导入 WeKnora 知识库，供全员检索/问答。

## 前置

- WeKnora 已部署（服务器），拿到 `WEKNORA_HOST`（如 `https://kb.example.com`）；
- 已创建知识库，拿到 `kb_id`；
- 已生成 API key（或 CLI 已登录）。

## 方式 A：CLI `weknora`（推荐，agent-first）

```bash
# 一次性配置
weknora profile add prod --host https://kb.example.com --use
weknora auth login

# 批量导入 merged/ 下的所有 Markdown
weknora kb create paper-wiki          # 若还没建库
weknora doc upload merged/concepts/*.md
weknora doc upload merged/papers/*.md
weknora doc upload merged/glossary.md
```

## 方式 B：REST API 批量脚本

```bash
# 遍历 merged/ 上传每个 md
for f in merged/concepts/*.md merged/papers/*.md; do
  curl -X POST "$WEKNORA_HOST/api/v1/knowledge-bases/$KB_ID/documents" \
    -H "X-API-Key: $WEKNORA_API_KEY" \
    -F "file=@$f"
done
```

## 方式 C：Web UI

「知识库 → 上传文档」批量选择 `merged/concepts/` 和 `merged/papers/` 下的文件（文件夹上传保留目录树）。

## 导入时机（批量，非实时）

- 在 `merge-wiki.mjs` 合并完成后**手动/定时**执行一次；
- 阶段 2 可在 git 合并的 CI hook 里自动触发导入，实现全自动化。

## 两个知识库建议（可选）

| 知识库 | 内容 | 用途 |
|---|---|---|
| `paper-wiki-all` | `users/`（原文）+ `merged/` | 全员自由检索原始笔记 |
| `paper-wiki-canonical` | 仅 `merged/` | 高质量精选，问答优先走这个库 |

对应 dsh-weknora 插件的 `knowledgeBaseIds` 可指向 `paper-wiki-canonical`，保证 `weknora_ask` 基于精选内容回答。
