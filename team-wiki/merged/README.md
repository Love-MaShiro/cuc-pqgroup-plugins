# merged/ —— canonical 精选层

review 通过后由 `scripts/merge-wiki.mjs` 自动生成的全局 canonical 内容。

- `concepts/`：全局概念页（跨用户去重后唯一）
- `papers/`：全局论文页
- `glossary.md`：全局术语表

**不要手改本目录**——它由合并脚本生成；要改请改 `users/<name>/wiki/` 原文，再重新合并。
