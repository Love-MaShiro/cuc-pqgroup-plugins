# team-wiki —— 团队知识库仓库模板

分布式使用、集中化管理的团队论文知识库。每人本地用 `paper-reader` 读论文、生成 wiki，提交到这里汇聚；review 后沉淀为 canonical 精选层，批量导入 WeKnora 供全员检索/问答。

## 目录结构

```
team-wiki/
├── ADMIN/                  # 管理配置（权限、合并规则、git 权限）
│   ├── permissions.yml     # 角色 → 权限矩阵（单一事实源）
│   ├── canonical-rules.yml # 跨用户概念合并规则
│   └── CODEOWNERS          # git 层：merged/ 谁有 merge 权
├── users/<name>/wiki/      # 各人原文（全员共享可读）
├── merged/                 # canonical 精选层（review 后沉淀）
│   ├── concepts/           # 全局概念页（去重后唯一）
│   ├── papers/             # 全局论文页
│   └── glossary.md         # 全局术语表
└── graph.json              # 全局知识图谱（聚合去重）
```

## 工作流

```
读论文 → 本地带学 → 本地 paper-wiki 落盘
   → git push 到 users/<name>/wiki/（自己命名空间）
   → reviewer review → 合并到 merged/ + 去重
   → 批量导入 WeKnora → 全员检索
```

## 两个阶段

- **阶段 1（当前）**：review 是**人工**的——管理员/教师 review 各人提交，通过后合并。
- **阶段 2（下一阶段）**：review 由 **AI 校验**替代，自动合并 + 自动导入，人工只看审计日志。

## 快速开始

1. 将此模板复制到独立的仓库 B（不复制工程仓库的 .gitignore），每人 fork/clone 仓库 B，将本地 paper-wiki 内容复制到 `users/<你的名字>/wiki/`；
2. `git push` 提交自己的命名空间（不碰他人目录和 `merged/`）；
3. reviewer 运行合并脚本：
   ```bash
   node <工程仓库A路径>/scripts/merge-wiki.mjs <知识仓库B路径>
   ```
   把各人 wiki 合并进 `merged/` + 更新 `graph.json`；
4. 批量导入 WeKnora（见 `scripts/import-weknora.md`）。
