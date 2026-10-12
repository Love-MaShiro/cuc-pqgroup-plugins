# users/ —— 各人的原文命名空间

每人一个子目录，把自己的本地 `paper-wiki` 原样放进来（全员共享可读）。

```
users/
└── <你的名字>/
    └── wiki/          # 直接放 paper-wiki 的内容
        ├── graph.json
        ├── glossary.md
        ├── concepts/
        └── papers/
```

规则：
- 只写自己的 `users/<你的名字>/`，不碰他人目录和 `merged/`；
- 原文**全员共享**（可读、可检索），review 后才会沉淀进 `merged/` 成为 canonical；
- 提交后由 reviewer 运行 `scripts/merge-wiki.mjs` 合并。
