import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { apply } from "../index.js";

const PDF = Buffer.from("%PDF-1.7\nfixture bytes for transport testing, not a parsed document\n%%EOF");

test("reading modes preserve attachments and requirements, with one followup", async () => {
  for (const mode of ["explain", "discuss", "practice"]) {
    const h = harness();
    const attachment = { type: "file", attachment: { attachmentId: "paper" } };
    assert.equal((await h.run({ attachments: [attachment], rawInput: `--mode=${mode} 解释公式 2` })).kind, "success");
    assert.equal(h.messages.length, 1);
    assert.equal(h.messages[0].content[0], attachment);
    assert.match(h.messages[0].content[1].text, new RegExp(`起始模式：${mode}`));
    assert.match(h.messages[0].content[1].text, /解释公式 2/);
  }
});

test("invalid reading mode fails before importing or submitting", async () => {
  const h = harness();
  const result = await h.run({ rawInput: '@"paper.pdf" --mode=unknown' });
  assert.equal(result.kind, "error");
  assert.match(result.text, /explain、discuss 或 practice/);
  assert.equal(h.resolves.length, 0);
  assert.equal(h.messages.length, 0);
});

test("path import accepts a mode after the path and defaults to explanation", async (t) => {
  const cwd = await fixture(t);
  for (const [suffix, mode] of [["--mode=discuss 公式 2", "discuss"], ["我不懂 LWE", "explain"]]) {
    const h = harness({ cwd });
    assert.equal((await h.run({ rawInput: `@"论文 paper.pdf" ${suffix}` })).kind, "success");
    assert.equal(h.saved.length, 1);
    assert.match(h.messages[0].content[1].text, new RegExp(`起始模式：${mode}`));
  }
});

function harness(options = {}) {
  const messages = [];
  const saved = [];
  const reads = [];
  const resolves = [];
  let command;
  const store = {
    async saveFile(input) {
      saved.push(input);
      const ref = {
        attachmentId: createHash("sha256").update(input.data).digest("hex"),
        name: input.name,
        bytes: input.data.length,
      };
      await options.onSave?.();
      return ref;
    },
  };
  const ctx = {
    get: (name) => name === "attachments" && !options.noStore ? store : undefined,
    skills: { registerProvider() {} },
    tools: { register() {} },
    commands: { register(value) { command = value; } },
    fs: {
      async resolve(path, opts) {
        resolves.push({ path, ...opts });
        return { path: resolve(opts.cwd, path) };
      },
      async stat(target) {
        try {
          const info = await stat(target.path);
          return { type: info.isFile() ? "file" : "directory", size: info.size };
        } catch (error) {
          if (error.code === "ENOENT") return undefined;
          throw error;
        }
      },
      async readBytes(target, signal, maxBytes) {
        reads.push({ target, signal, maxBytes });
        if (options.readError) throw options.readError;
        const data = await readFile(target.path);
        if (data.length > maxBytes) throw Object.assign(new Error("too large"), { code: "FS_TOO_LARGE" });
        return data;
      },
    },
  };
  apply(ctx);
  const agent = {
    session: { header: { cwd: options.cwd ?? tmpdir() } },
    followup(message) { messages.push(message); },
  };
  return {
    command, messages, saved, reads, resolves,
    run: (input = {}) => command.handler({ agent, rawInput: "", attachments: [], ...input }),
  };
}

async function fixture(t) {
  const cwd = await mkdtemp(join(tmpdir(), "readpaper-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "论文 paper.pdf"), PDF);
  return cwd;
}

test("registered command retains attachment support and forwards admitted blocks plus instructions", async () => {
  const h = harness();
  assert.equal(h.command.input.attachments, true);
  const file = Object.freeze({ type: "file", attachment: { attachmentId: "paper", name: "paper.pdf", bytes: 123 } });
  const image = Object.freeze({ type: "image", attachment: { attachmentId: "figure" } });
  const attachments = Object.freeze([file, image]);
  assert.equal((await h.run({ attachments, rawInput: "重点解释定理 2" })).kind, "success");
  assert.equal(h.messages.length, 1);
  const message = h.messages[0];
  assert.equal(message.content[0], file);
  assert.equal(message.content[1], image);
  assert.match(message.content[2].text, /重点解释定理 2/);
  assert.match(message.content[2].text, /paper-reader skill/);
  assert.equal(message.role, "user");
  assert.deepEqual(message.source, { kind: "user" });
  assert.ok(message.id);
  assert.equal(h.saved.length, 0);
  assert.equal(h.reads.length, 0);
});

test("empty or missing attachments report a recoverable error without starting a turn", async () => {
  for (const attachments of [[], undefined]) {
    const h = harness();
    const result = await h.run({ attachments, rawInput: "重点解释定理 2" });
    assert.equal(result.kind, "error");
    assert.match(result.text, /未收到附件/);
    assert.match(result.text, /同一次提交/);
    assert.match(result.text, /@"/);
    assert.equal(h.messages.length, 0);
  }
});

test("quoted @relative path imports exact PDF bytes using session cwd and preserves reading instructions", async (t) => {
  const cwd = await fixture(t);
  const h = harness({ cwd });
  const signal = new AbortController().signal;
  assert.equal((await h.run({ rawInput: '@"论文 paper.pdf" 重点解释证明\n跳过背景', signal })).kind, "success");
  assert.equal(h.resolves[0].cwd, cwd);
  assert.equal(h.resolves[0].signal, signal);
  assert.equal(h.reads[0].signal, signal);
  assert.deepEqual(h.saved[0].data, PDF);
  assert.equal(h.saved[0].name, "论文 paper.pdf");
  const [file, text] = h.messages[0].content;
  assert.equal(file.type, "file");
  assert.equal(file.attachment.bytes, PDF.length);
  assert.equal(file.attachment.attachmentId, createHash("sha256").update(PDF).digest("hex"));
  assert.match(text.text, /重点解释证明\n跳过背景/);
});

test("absolute paths, quoted paths, and bare PDF filenames are supported", async (t) => {
  const cwd = await fixture(t);
  await writeFile(join(cwd, "paper.PDF"), PDF);
  for (const input of [`@"${join(cwd, "论文 paper.pdf")}"`, "'论文 paper.pdf'", "paper.PDF", "@paper.PDF"]) {
    const h = harness({ cwd });
    assert.equal((await h.run({ rawInput: input })).kind, "success", input);
    assert.equal(h.saved.length, 1);
  }
});

test("Windows backslashes survive parsing unchanged", async () => {
  const h = harness();
  const path = String.raw`F:\desktop\论文 paper.pdf`;
  await h.run({ rawInput: `@"${path}" 解释方法` });
  assert.equal(h.resolves[0].path, path);
});

test("an explicit path can accompany already admitted attachments", async (t) => {
  const cwd = await fixture(t);
  const h = harness({ cwd });
  const attachment = { type: "image", attachment: { attachmentId: "figure" } };
  await h.run({ rawInput: '@"论文 paper.pdf"', attachments: [attachment] });
  assert.equal(h.messages[0].content[0], attachment);
  assert.equal(h.messages[0].content[1].type, "file");
});

test("malformed explicit paths fail without reading or starting a turn", async () => {
  for (const input of ['@"unclosed.pdf', '@"paper.pdf"notes', "@paper.txt", "@", "@paper with spaces.pdf"]) {
    const h = harness();
    assert.equal((await h.run({ rawInput: input })).kind, "error", input);
    assert.equal(h.reads.length, 0);
    assert.equal(h.messages.length, 0);
  }
});

test("missing files and directories are rejected before byte reads", async (t) => {
  const cwd = await fixture(t);
  await mkdir(join(cwd, "directory.pdf"));
  for (const input of ["@missing.pdf", "@directory.pdf"]) {
    const h = harness({ cwd });
    assert.equal((await h.run({ rawInput: input })).kind, "error");
    assert.equal(h.messages.length, 0);
    assert.equal(h.reads.length, 0);
  }
});

test("missing session cwd never resolves against the host process directory", async () => {
  const h = harness();
  const result = await h.run({ rawInput: "@paper.pdf", agent: { session: { header: {} } } });
  assert.equal(result.kind, "error");
  assert.match(result.text, /缺少工作目录/);
  assert.equal(h.resolves.length, 0);
  assert.equal(h.messages.length, 0);
});

test("non-PDF bytes are rejected before attachment storage", async (t) => {
  const cwd = await fixture(t);
  await writeFile(join(cwd, "fake.pdf"), "not a PDF");
  const h = harness({ cwd });
  const result = await h.run({ rawInput: "@fake.pdf" });
  assert.equal(result.kind, "error");
  assert.match(result.text, /PDF 签名/);
  assert.equal(h.saved.length, 0);
  assert.equal(h.messages.length, 0);
});

test("missing attachment service is distinct from an empty composer submission", async () => {
  const h = harness({ noStore: true });
  const result = await h.run({ rawInput: "@paper.pdf" });
  assert.equal(result.kind, "error");
  assert.match(result.text, /attachments 文件存储服务/);
  assert.equal(h.reads.length, 0);
  assert.equal(h.messages.length, 0);
});

test("filesystem denial and byte cap errors stay visible without a direct-fs fallback", async (t) => {
  const cwd = await fixture(t);
  for (const [code, message, expected] of [
    ["FS_ACCESS_DENIED", "sandbox denied", /sandbox denied/],
    ["FS_TOO_LARGE", "too large", /64 MiB/],
  ]) {
    const h = harness({ cwd, readError: Object.assign(new Error(message), { code }) });
    const result = await h.run({ rawInput: '@"论文 paper.pdf"' });
    assert.equal(result.kind, "error");
    assert.match(result.text, expected);
    assert.equal(h.saved.length, 0);
    assert.equal(h.messages.length, 0);
  }
});

test("cancellation before import or during storage never submits a followup", async (t) => {
  const cwd = await fixture(t);
  for (const before of [true, false]) {
    const controller = new AbortController();
    const h = harness({ cwd, onSave: () => controller.abort() });
    if (before) controller.abort();
    await assert.rejects(h.run({ rawInput: '@"论文 paper.pdf"', signal: controller.signal }), { name: "AbortError" });
    assert.equal(h.messages.length, 0);
    assert.equal(h.saved.length, before ? 0 : 1);
  }
});

test("attachment storage failure is reported without submitting a partial message", async (t) => {
  const cwd = await fixture(t);
  const h = harness({ cwd, onSave() { throw new Error("attachment store unavailable"); } });
  const result = await h.run({ rawInput: '@"论文 paper.pdf"' });
  assert.equal(result.kind, "error");
  assert.match(result.text, /attachment store unavailable/);
  assert.equal(h.messages.length, 0);
});
