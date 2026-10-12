# DSH 插件开发实战指南

> 本文档是从零实现 `paper-reader` 插件（bundled skill + command + tool 三件套）时踩坑总结的可复用经验。写新插件前先读一遍，避免重复踩坑。
>
> 同时以 user 级 skill 形式存在：`~/.dsh/skills/dsh-plugin-development/SKILL.md`，模型在开发 DSH 插件时会自动加载。

## 一、Bundle 最小结构

一个 Host-only bundle 只需三个文件，无需依赖、无需构建：

**`package.json`**：
```json
{
  "name": "@local/my-plugin",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./index.js" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

**`cordis.patch.yml`**：
```yaml
- insert:
    - id: my-plugin
      name: '@local/my-plugin'
      config: {}
```

**`index.js`**（导出三种形式之一）：
```js
const name = "my-plugin";
const inject = ["skills", "commands", "tools", "fs"]; // 声明需要的服务
function apply(ctx) {
  // 注册 skill / command / tool，用 ctx.<service>.register(...)
}
export { apply, inject, name };
```

安装：`plugin_manager` 的 `install_bundle`，target 是 bundle 目录绝对路径。**不要手动改 profile 的 package.json 或 cordis.patch.yml**，install_bundle 会自己处理。

## 二、最重要的坑：零外部依赖

**外部 bundle 无法 import `@deepseek-ai/dsh-*` 包**（模块解析会失败，报 `failed to import`）。这些包从 dsh 安装解析，但外部 bundle 的 import 从 bundle 位置向上找 node_modules，找不到。

**解决**：只用 node 内置模块 + `ctx` 服务。需要 dsh 工具函数时手写等价实现。例如：

```js
// 不要 import { createUserMessage } from "@deepseek-ai/dsh-llm"
import { randomUUID } from "node:crypto";
function createUserMessage(input) {
  return { ...input, id: randomUUID(), role: "user" };
}
```

同理，bundled skill 的 `rank` 用字面量 `600`（即 `BUNDLED_SKILL_RANK`），不必 import。

## 三、三件套注册

### 1. bundled skill provider

skill 正文放 bundle 的 `assets/` 目录，是**纯 Markdown（无 frontmatter）**，name/description 硬编码在 JS 里：

```js
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const PROVIDER_NAME = "my-skill";
// 注意：index.js 在 bundle 根，assets 用 ./assets（不是 ../assets）
const SKILL_BODY_URL = new URL("./assets/my-skill.md", import.meta.url);
const RESOURCE_BASE = { kind: "directory", path: fileURLToPath(new URL("./assets/", import.meta.url)) };

const CANDIDATE = {
  name: PROVIDER_NAME,
  description: "…",                       // 面向模型的触发说明
  invocation: { modelInvocable: true, userInvocable: true },
  provider: PROVIDER_NAME,
  source: "bundled",
  resourceBase: RESOURCE_BASE,
  rank: 600,                              // BUNDLED_SKILL_RANK
  locator: SKILL_BODY_URL,
};
const provider = {
  name: PROVIDER_NAME,
  list: () => Promise.resolve([CANDIDATE]),
  async get() {
    return { ...CANDIDATE, content: await readFile(SKILL_BODY_URL, "utf8") };
  },
};
// 在 apply 里：ctx.skills.registerProvider(() => provider);
```

**关键**：`get()` 每次调用都重新 `readFile`，所以**改 skill 正文（assets/*.md）无需重启**；但改 index.js（代码）需要重启（见「模块缓存」）。

### 2. command（slash command）

```js
ctx.commands.register({
  name: "mycmd",
  description: "…",
  input: { hint: "[可选说明]", attachments: true },  // attachments: true 才能收文件
  handler: (invocation) => {
    // 触发 agent 继续处理：followup 注入一条 user 消息
    invocation.agent.followup(createUserMessage({
      content: [...invocation.attachments, { type: "text", text: "…" }],
      source: { kind: "user" },
    }));
    return { kind: "success", text: "已收到" };   // 或 { kind: "error", text }
  },
});
```

### 3. tool（手写 ToolDefinition，不依赖 dsh-tools）

```js
ctx.tools.register({
  name: "my_tool",
  description: "…",
  parameters: { type: "object", properties: {…}, required: […] },  // 标准 JSON Schema
  output: {
    schema: { type: "object", properties: {…} },
    render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
  },
  async execute(args, exec) {
    const cwd = exec.agent?.session?.header?.cwd;  // agent 工作区
    // … 用 ctx.fs 读写
    return { /* JSON value */ };
  },
  presentCall(args) { return { card: "generic", title: `…`, kind: "other", rawInput: args }; },
});
```

## 四、文件读写（fs 服务）——两个必踩的坑

### 坑 A：cwd 必须传

`ctx.fs.resolve(path, { cwd, signal })` 的 `cwd` **必须传** `exec.agent.session.header.cwd`，否则相对路径会解析到 **Host 进程目录**（如 profile 目录），写错地方。

```js
const cwd = exec.agent?.session?.header?.cwd;
const target = await ctx.fs.resolve("paper-wiki/x.md", { ...(cwd ? { cwd } : {}), signal });
```

### 坑 B：写文件必须传 sandboxPolicy

当前 fs 是 confining backend（sandbox 模式），`writeText` 不传 sandboxPolicy 会用错误的默认 workspaceRoot，导致 `file access denied under workspace-write mode`。正确做法：

```js
const sandboxPolicyService = ctx.get("sandboxPolicy");
const session = exec.agent?.session;
const policy = sandboxPolicyService && session ? sandboxPolicyService.resolve({ session }) : undefined;
await ctx.fs.writeText(target, content, undefined, signal, policy);
```

`resolve({ session })` 的 `workspaceRoot = session.header.cwd`，这才是正确的写入边界。读操作（readText/stat）不需要 policy。

## 五、模块缓存：改代码必须重启

**对已安装 bundle 的 `index.js` 做任何修改，必须重启 DSH 才能加载**（模块缓存，`remove_bundle + install_bundle` 和改入口文件名都无法绕过，已实测确认）。

- 改 `assets/*.md`（skill 正文）→ 无需重启（每次加载重读）
- 改 `index.js`（代码）→ 必须重启

## 六、BOM 容错

Windows 工具（如 PowerShell `Set-Content -Encoding UTF8`）写 JSON 常带 BOM（`\uFEFF`），导致 `JSON.parse` 失败。读 JSON 时统一容错：

```js
JSON.parse(readFileSync(p, "utf8").replace(/^\uFEFF/, ""));
```

## 七、验证流程

1. `install_bundle` → 看返回的 `application: "applied"` 和无 `warnings`（这是是否生效的权威依据，不是日志/进程列表）；
2. `cordis_inspect_query` 查 `Tool.listTools` 确认 tool 注册；`skill` 工具加载确认 skill；
3. **实际调用一次 tool** 确认落盘位置正确（写到 workspace 而非 profile）；
4. 改代码后记得重启再验证。

## 八、filesystem skill（放 .dsh/skills/ 的）可能不生效

若把 skill 写成磁盘文件（`<dshHome>/skills/<name>/SKILL.md`，靠 `dsh-skill-filesystem` 扫描）却加载不到，先查 `@deepseek-ai/dsh-skill-filesystem` 是否激活——它可能默认 `enabled: false`：

- `plugin_manager` `list_plugins` 查 `include:skill-filesystem` 的 `enabled`；
- 若为 false，用 `set_plugin`（target 用 `include:skill-filesystem`，不是 `skill-filesystem`）启用，再加载 skill。

注意：这与 bundled skill 无关（bundled 走 `ctx.skills.registerProvider`，不依赖 filesystem 扫描器）。

## 九、参考源码位置

dsh 自带的权威参考（在 `app.asar` 内，需用 node 解析 asar header 提取）：
- `@deepseek-ai/dsh-skill-badge`：最简 bundled skill provider 示例
- `@deepseek-ai/dsh-command-goal`：command + followup 示例
- `@deepseek-ai/dsh-tool-fs`：fs 读写 + sandboxPolicy 的标准写法
- `@deepseek-ai/dsh-skill-filesystem`：本地文件 skill 的发现规则（`<root>/<name>/SKILL.md`，user 级在 `<dshHome>/skills`）
