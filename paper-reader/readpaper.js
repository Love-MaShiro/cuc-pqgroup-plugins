import { randomUUID } from "node:crypto";

const MAX_PDF_BYTES = 64 * 1024 * 1024;
const PATH_USAGE = '/readpaper @"F:\\论文目录\\paper.pdf" 可选阅读要求';

const MODE_INSTRUCTIONS = {
  explain: "概念讲解：先用具体例子讲清一个小点，再列出可选疑惑；这些是讨论入口，不是必须作答的测验。",
  discuss: "原文讨论：围绕用户指定的段落、公式或图表，说明原文陈述、假设和推理；未指定位置时只询问讨论位置并结束本轮。",
  practice: "练习辅导：仅在用户主动选择练习时使用。一次给一个理解检查或提示，不代替用户完成推理；用户要求直接解释时切回讲解模式。",
};

// 模式选项位于阅读要求开头（有路径时在路径之后），其余文字原样保留。
function parseMode(input) {
  const match = /^--mode=(\S+)(?:\s+|$)/.exec(input.instructions);
  if (!match) return { ...input, mode: "explain" };
  if (!Object.hasOwn(MODE_INSTRUCTIONS, match[1])) {
    throw new Error("阅读模式须为 explain、discuss 或 practice；例如 /readpaper --mode=discuss 讨论公式 2。");
  }
  return { ...input, mode: match[1], instructions: input.instructions.slice(match[0].length) };
}

// 只识别开头的显式路径；其余输入保留为阅读要求，不当作 shell 命令解析。
function parseInput(rawInput = "") {
  const input = rawInput.trim();
  const explicit = input.startsWith("@");
  const value = explicit ? input.slice(1) : input;
  const quote = value[0];
  let path;
  let rest;
  if (quote === '"' || quote === "'") {
    const end = value.indexOf(quote, 1);
    if (end === -1) throw new Error(`路径引号未闭合。用法：${PATH_USAGE}`);
    path = value.slice(1, end);
    rest = value.slice(end + 1);
    if (rest && !/^\s/.test(rest)) throw new Error(`路径与阅读要求之间需要空格。用法：${PATH_USAGE}`);
  } else {
    const end = value.search(/\s/);
    path = end === -1 ? value : value.slice(0, end);
    rest = end === -1 ? "" : value.slice(end);
  }
  if (!/\.pdf$/i.test(path)) {
    if (explicit) throw new Error(`请指定 PDF 文件；路径含空格时用引号包住。用法：${PATH_USAGE}`);
    return { instructions: input };
  }
  return { path, instructions: rest.trim() };
}

async function importPdf(ctx, invocation, path) {
  const store = ctx.get("attachments");
  if (!store || typeof store.saveFile !== "function") {
    throw new Error("当前 profile 未提供 attachments 文件存储服务，无法导入 PDF。请检查 DSH 附件服务配置。");
  }
  const cwd = invocation.agent.session?.header?.cwd;
  if (!cwd) throw new Error("当前会话缺少工作目录，无法解析论文路径。");
  const { signal } = invocation;
  const target = await ctx.fs.resolve(path, { cwd, signal });
  const info = await ctx.fs.stat(target, signal);
  if (!info || info.type !== "file") throw new Error(`论文文件不存在或不是普通文件：${path}`);
  const data = await ctx.fs.readBytes(target, signal, MAX_PDF_BYTES);
  // 签名检查只用于防止误选文件；正文解析仍由 skill 使用 PDF 解析器完成。
  if (!Buffer.from(data.subarray(0, 1024)).includes(Buffer.from("%PDF-"))) {
    throw new Error(`文件不含 PDF 签名，请确认文件格式：${path}`);
  }
  signal?.throwIfAborted();
  const attachment = await store.saveFile({ data, name: path.split(/[\\/]/).pop() });
  signal?.throwIfAborted();
  return { type: "file", attachment };
}

export async function executeReadpaper(ctx, invocation) {
  invocation.signal?.throwIfAborted();
  let input;
  const attachments = [...(invocation.attachments ?? [])];
  try {
    input = parseMode(parseInput(invocation.rawInput));
    if (input.path) attachments.push(await importPdf(ctx, invocation, input.path));
  } catch (error) {
    invocation.signal?.throwIfAborted();
    const detail = error?.code === "FS_TOO_LARGE"
      ? "路径导入仅支持不超过 64 MiB 的 PDF；更大的文件请使用 composer 上传。"
      : error instanceof Error ? error.message : String(error);
    return { kind: "error", text: `无法读取论文：${detail}` };
  }
  if (attachments.length === 0) {
    return {
      kind: "error",
      text: `本次 /readpaper 未收到附件。请确认 PDF 已上传完成，并与命令在同一次提交；@路径引用不等于上传附件。也可直接输入 ${PATH_USAGE}。若已上传仍出现此提示，请检查 composer → commands.execute 的附件传递。`,
    };
  }
  const text = [
    "先从 skill 的 reading-template.md 在当前工作区建立 paper-reader-work/<paper-slug>/<reading-id>/template.md。本次先准备草稿，正式 paper-wiki 只读；检索、试讲、测试及未完成模块不得写入真源。每完成并核查一个模块才提交该模块到正式 wiki；测试默认不入库，跳过讲解的知识仍在模块草稿中准备。",
    "请加载 paper-reader skill，开始由用户控制节奏的对话式带读。提问后结束本轮，等待用户。不自行创建 goal，不自动连续读完整篇，不补答未回答的问题。介绍前置知识前先检索并读取 wiki；缺失或不足时搜索并阅读可靠教材、读本或论文，以核查后的材料指导学习。跳过讲解不跳过 wiki 收录，知识覆盖与教学进度分别管理；整理放在提问之前，不因整理自动续跑。只有用户明确要求建立 goal 时才按宿主规则创建。",
    `本次起始模式：${input.mode}。${MODE_INSTRUCTIONS[input.mode]} 后续以用户自然语言要求为准，无须重新执行命令；普通阅读要求中的明确模式偏好优先于默认模式。`,
    "先读取附件并确认正文可解析；附件文件引用不是已解析的正文。缺少 PDF 解析工具时说明所缺能力及具体处理办法，不要凭文件名猜测内容。",
    ...(input.instructions ? [`用户的阅读要求：\n${input.instructions}`] : []),
  ].join("\n\n");
  invocation.signal?.throwIfAborted();
  invocation.agent.followup({
    id: randomUUID(),
    role: "user",
    content: [...attachments, { type: "text", text }],
    source: { kind: "user" },
  });
  return { kind: "success", text: "论文已收到，正在开始带学……" };
}
