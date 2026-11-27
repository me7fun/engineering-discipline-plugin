/**
 * lib.js — engineering-discipline plugin 共用函式库
 *
 * 各支 hook 共用：专案根解析、设定档读取（含合并顺序）、stdin 读取、「本轮」对话纪录读取、
 * 以及「修改类派工／机制笔记／完成宣称／正式程式码档」等分类器。
 * 分类器集中一处，动手前、派工、收工三个闸门才会用同一把尺。
 *
 * 设定档读取顺序（后者覆盖前者；mode 取最后一个有定义的，五个阵列一律「追加」）：
 *   1. 内建预设
 *   2. ~/.claude/engineering-discipline.json                       （使用者层级）
 *   3. <专案>/.claude/engineering-discipline.config.json            （专案层级，会进 git）
 *   4. <专案>/.claude/engineering-discipline.config.local.json      （专案层级，本机覆盖；存在才读）
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const TAG = "[engineering-discipline]";

const DEFAULT_CONFIG = {
  // warn = 只提醒不挡；block = 真的挡下（PreToolUse exit 2／Stop decision block）
  mode: "warn",
  // 以下三个阵列为「追加」到内建关键字之后，不是取代
  modifyKeywords: [],
  readOnlyKeywords: [],
  claimKeywords: [],
  // 追加到内建只读代理类型（Explore、Plan、web-fetch、claude-code-guide）之后；这些类型的派工不算修改类
  readOnlyAgentTypes: [],
  // 哪些路径算「正式程式码」（相对专案根的路径前缀，例 "src/"）。
  // 有填：只有这些路径底下的档算；没填：专案内、副档名是程式码的档都算
  codePaths: [],
};

// 修改类 brief：命中其一即视为「要动 code」
const MODIFY_RE_SRC = "修|fix|修復|修正|修复|改碼|改码|改 code|實作|实作|实现|patch|bug";
// 只读标记：命中其一则不论上面是否命中，一律视为只读派工
const READONLY_RE_SRC =
  "只讀|只读|read-only|唯讀|只做調查|只做调查|不改任何|禁改|不動 code|不动 code|只改文件|只改文档|docs-only|只提交|只做提交|commit-only";
// 提交类派工：description 讲的是 commit／push／打 tag，这类派工不算修改类
const COMMIT_DESC_RE = /commit|提交|推送|push|rollout|\btag\b/i;
const COMMIT_DESC_START_RE = /^\s*(commit|提交|推送|push|打 ?tag)/i;
// 只读类型的子代理：派给这些类型一律不算修改类（看类型，不靠关键字）
const READONLY_AGENT_TYPES = ["Explore", "Plan", "web-fetch", "claude-code-guide"];
// 完成宣称：收工回报里出现这些字样，表示在宣称「做好了」
const CLAIM_RE_SRC = "修好|已修|已上 dev|上 dev 了|PASS|通過|通过|修復完成|修正完成|已完成";

// 机制笔记整体标记
const NOTE_WORD_RE = /機制筆記|机制笔记/;
// 机制笔记五个标题；至少命中 3 个「不同」标题即视为附了笔记
const NOTE_HEADINGS = [/系統與職責|系统与职责/, /症狀所在|症状所在/, /現況為何|现况为何/, /牽動誰|牵动谁/, /怎麼驗|怎么验/];
// 改动影响声明：收工回报必附其一
const IMPACT_RE = /改動影響聲明|改动影响声明|機制筆記|机制笔记|影響面|影响面/;

// 没设 codePaths 时：写到这些副档名才算「动了 code」
const CODE_FILE_RE = /\.(ts|tsx|js|jsx|mjs|cjs|vue|go|py|json)$/i;
// 有设 codePaths 时：路径底下除了这些说明类副档名，其余都算
const DOC_FILE_RE = /\.(md|txt|log)$/i;

// 系统注入的 user 纪录开头（不是真正的用户输入）
const INJECTED_PREFIXES = [
  "<system-reminder>",
  "<task-notification>",
  "[SYSTEM NOTIFICATION",
  "[Request interrupted",
  "<local-command-stdout>",
  "<local-command-caveat>",
  "This session is being continued",
];
// 读对话纪录尾端的大小上限（由小到大试；都找不到本轮起点就放弃、放行）
const TAIL_SIZES = [1 << 20, 8 << 20, 64 << 20];

/** 解析专案根：优先 CLAUDE_PROJECT_DIR，退回 git rev-parse，再退回 cwd */
function projectRoot() {
  const env = process.env.CLAUDE_PROJECT_DIR;
  if (env && fs.existsSync(env)) return env;
  try {
    const out = execSync("git rev-parse --show-toplevel", {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    if (out) return out;
  } catch (_) {}
  return process.cwd();
}

function readJsonSafe(p) {
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : null;
  } catch (_) {
    return null;
  }
}

function asStringArray(v) {
  return Array.isArray(v) ? v.filter((s) => typeof s === "string" && s.trim()) : [];
}

/** 合并一层设定：mode 覆盖、阵列追加 */
function mergeLayer(base, layer) {
  if (!layer) return base;
  const out = Object.assign({}, base);
  if (layer.mode === "warn" || layer.mode === "block") out.mode = layer.mode;
  for (const k of ["modifyKeywords", "readOnlyKeywords", "claimKeywords", "readOnlyAgentTypes", "codePaths"]) {
    out[k] = base[k].concat(asStringArray(layer[k]));
  }
  return out;
}

/** 读设定：缺档或坏档一律跳过该层（fail-safe，最终至少是内建预设） */
function loadConfig(root) {
  const home = os.homedir();
  const layers = [
    path.join(home, ".claude", "engineering-discipline.json"),
    path.join(root, ".claude", "engineering-discipline.config.json"),
    path.join(root, ".claude", "engineering-discipline.config.local.json"),
  ];
  let cfg = Object.assign({}, DEFAULT_CONFIG);
  for (const p of layers) cfg = mergeLayer(cfg, readJsonSafe(p));
  return cfg;
}

/** 把使用者追加的关键字（纯文字）转成 regex 片段 */
function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildRe(baseSrc, extras, flags) {
  const parts = [baseSrc].concat(extras.map(escapeRe));
  return new RegExp(parts.join("|"), flags);
}

/** 依设定组出三把尺 */
function classifiers(cfg) {
  return {
    modifyRe: buildRe(MODIFY_RE_SRC, cfg.modifyKeywords, "i"),
    readOnlyRe: buildRe(READONLY_RE_SRC, cfg.readOnlyKeywords, "i"),
    claimRe: buildRe(CLAIM_RE_SRC, cfg.claimKeywords, ""),
  };
}

/** 这段 brief 是不是「修改类派工」：命中修改词且没有只读标记 */
function isModifyBrief(prompt, cls) {
  const p = String(prompt || "");
  if (!p) return false;
  if (cls.readOnlyRe.test(p)) return false;
  return cls.modifyRe.test(p);
}

/**
 * 读代理定义档的 frontmatter，取 model 与 tools。
 * 找 <专案>/.claude/agents/ 与 ~/.claude/agents/ 底下的 <type>.md、<type>/*.md。
 * 找不到或读不到回 null。
 */
function agentDef(type, root) {
  const name = String(type || "").trim();
  if (!name || /[\\/]|\.\./.test(name)) return null;
  const dirs = [path.join(root || projectRoot(), ".claude", "agents"), path.join(os.homedir(), ".claude", "agents")];
  for (const dir of dirs) {
    const base = path.join(dir, name);
    const candidates = [base + ".md"];
    try {
      for (const f of fs.readdirSync(base)) if (/\.md$/i.test(f)) candidates.push(path.join(base, f));
    } catch (_) {}
    for (const file of candidates) {
      let text;
      try {
        text = fs.readFileSync(file, "utf8").slice(0, 8192);
      } catch (_) {
        continue;
      }
      const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
      if (!m) continue;
      const model = /^model:[ \t]*(\S+)/m.exec(m[1]);
      const tools = /^tools:[ \t]*(.+)$/m.exec(m[1]);
      return {
        model: model ? model[1].replace(/["']/g, "") : "",
        tools: tools ? tools[1].split(",").map((t) => t.trim()).filter(Boolean) : null,
      };
    }
  }
  return null;
}

const WRITE_TOOL_RE = /^(Edit|Write|MultiEdit|NotebookEdit)$/;

/**
 * 这次派工（Agent 的 tool_input）是不是「修改类派工」：
 *   - subagent_type 落在只读类型清单（内建＋设定追加，不分大小写）→ 不是
 *   - 该类型的定义档列了 tools 且没有任何写档工具 → 不是
 *   - 提交类派工 → 不是
 *   - 否则照 brief 文字判断。没带 subagent_type 的派工不豁免。
 */
function isModifyDispatch(input, cls, cfg, root) {
  const i = input && typeof input === "object" ? input : {};
  const type = typeof i.subagent_type === "string" ? i.subagent_type.trim().toLowerCase() : "";
  if (type) {
    const extra = cfg && Array.isArray(cfg.readOnlyAgentTypes) ? cfg.readOnlyAgentTypes : [];
    const readOnly = READONLY_AGENT_TYPES.concat(extra).map((t) => String(t).trim().toLowerCase());
    if (readOnly.includes(type)) return false;
    const def = agentDef(i.subagent_type, root);
    if (def && def.tools && !def.tools.some((t) => WRITE_TOOL_RE.test(t))) return false;
  }
  // 提交类派工：description 讲 commit／push，且没有同时讲修改（或一开头就是提交）
  const desc = typeof i.description === "string" ? i.description : "";
  if (COMMIT_DESC_RE.test(desc) && (COMMIT_DESC_START_RE.test(desc) || !cls.modifyRe.test(desc))) {
    return false;
  }
  return isModifyBrief(i.prompt, cls);
}

/** 这段文字有没有附机制笔记：有「机制笔记」字样，或五个标题至少命中 3 个不同的 */
function hasMechanismNote(text) {
  const t = String(text || "");
  if (NOTE_WORD_RE.test(t)) return true;
  const hits = NOTE_HEADINGS.filter((re) => re.test(t)).length;
  return hits >= 3;
}

/**
 * 这次派工是不是「没写明模型」：tool_input.model 没填（或空字串）。
 * subagent_type 为 fork 时不算——fork 一律沿用主对话模型，填了也无效。
 * 该代理类型的定义档自己写了 model（不是 inherit）也不算。
 */
function isMissingModel(input, root) {
  const i = input && typeof input === "object" ? input : {};
  if (String(i.subagent_type || "").toLowerCase() === "fork") return false;
  if (typeof i.model === "string" && i.model.trim()) return false;
  const def = agentDef(i.subagent_type, root);
  if (def && def.model && def.model.toLowerCase() !== "inherit") return false;
  return true;
}

/** 收工回报有没有改动影响声明 */
function hasImpactStatement(text) {
  return IMPACT_RE.test(String(text || ""));
}

function realpathSafe(p) {
  try {
    return fs.realpathSync(p);
  } catch (_) {
    return p;
  }
}

/**
 * 这次 Edit／Write 是不是写到「正式程式码」：
 *   - 专案根以外（暂存区、别的资料夹）→ 不算
 *   - 专案的 .claude/ 底下（进度档、设定、hook）→ 不算
 *   - 有设 codePaths：落在其中一个路径前缀底下、且不是说明类副档名 → 算
 *   - 没设 codePaths：副档名是程式码 → 算
 */
function isCodeFileWrite(filePath, cfg, root) {
  const raw = String(filePath || "");
  if (!raw) return false;
  const base = realpathSafe(root || projectRoot());
  const abs = path.resolve(base, raw);
  const real = path.join(realpathSafe(path.dirname(abs)), path.basename(abs));
  const rel = path.relative(base, real).split(path.sep).join("/");
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  if (rel === ".claude" || rel.startsWith(".claude/")) return false;
  const codePaths = cfg && Array.isArray(cfg.codePaths) ? cfg.codePaths : [];
  if (codePaths.length) {
    if (DOC_FILE_RE.test(rel)) return false;
    return codePaths.some((c) => {
      const prefix = String(c).trim().replace(/^\.\//, "").replace(/\/+$/, "");
      return prefix && (rel === prefix || rel.startsWith(prefix + "/"));
    });
  }
  return CODE_FILE_RE.test(rel);
}

function textOfContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && b.type === "text")
    .map((b) => b.text || "")
    .join("\n");
}

/** 判断一笔 user 纪录是否为真正的用户输入 */
function isRealUserInput(rec) {
  if (!rec || rec.type !== "user") return false;
  if (rec.isMeta === true || rec.isCompactSummary === true) return false;
  if (rec.isSidechain === true) return false;
  if (rec.origin && rec.origin.kind && rec.origin.kind !== "human") return false;
  const content = rec.message && rec.message.content;
  if (Array.isArray(content)) {
    if (content.some((b) => b && b.type === "tool_result")) return false;
    const hasInput = content.some((b) => b && (b.type === "text" || b.type === "image"));
    if (!hasInput) return false;
  } else if (typeof content !== "string") {
    return false;
  }
  const text = textOfContent(content).trimStart();
  if (INJECTED_PREFIXES.some((p) => text.startsWith(p))) return false;
  return true;
}

/** 读档案尾端 maxBytes；不是从头读起时丢掉第一行（可能是半行） */
function readTail(file, maxBytes) {
  const size = fs.statSync(file).size;
  const start = Math.max(0, size - maxBytes);
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let text = buf.toString("utf8");
    if (start > 0) {
      const nl = text.indexOf("\n");
      text = nl >= 0 ? text.slice(nl + 1) : "";
    }
    return { text, complete: start === 0 };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * 读「本轮」：从对话纪录尾端往回扫到最后一则真正的用户输入。
 * 回传 { found, userText, assistant }：assistant 是本轮主对话每笔 assistant 纪录的 content 阵列（照时间顺序）。
 * 只读尾端（1MB → 8MB → 64MB），都找不到起点就回 found: false（呼叫端一律放行）。
 * 只看 type user／assistant；其他纪录（api-request-blob 等）会重播旧内容，忽略。
 */
function readTurn(transcriptPath) {
  for (const cap of TAIL_SIZES) {
    const { text, complete } = readTail(transcriptPath, cap);
    const lines = text.split("\n");
    const assistant = [];
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || line.startsWith('{"type":"api-request-blob"')) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch (_) {
        continue; // 单行坏掉跳过（可能是正在写入的尾行）
      }
      if (!rec || rec.isSidechain === true) continue;
      if (rec.type === "assistant") {
        const content = rec.message && rec.message.content;
        if (Array.isArray(content)) assistant.push(content);
      } else if (isRealUserInput(rec)) {
        return {
          found: true,
          userText: textOfContent(rec.message && rec.message.content),
          assistant: assistant.reverse(),
        };
      }
    }
    if (complete) break;
  }
  return { found: false, userText: "", assistant: [] };
}

/**
 * 把文字写到 stdout／stderr，等写完才回来。
 * hook 的输出是接到管线的，写完之前就 process.exit 会被截断（macOS 上超过 512 bytes 就断）。
 */
function emit(text, stream) {
  return new Promise((resolve) => {
    try {
      (stream || process.stdout).write(text, () => resolve());
    } catch (_) {
      resolve();
    }
  });
}

/** 读 stdin JSON；坏掉或 2 秒没来就回 null */
function readStdinJson() {
  return new Promise((resolve) => {
    let raw = "";
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      try {
        const data = JSON.parse(raw);
        resolve(data && typeof data === "object" ? data : null);
      } catch (_) {
        resolve(null);
      }
    };
    try {
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (c) => {
        raw += c;
      });
      process.stdin.on("end", finish);
      process.stdin.on("error", finish);
      const t = setTimeout(finish, 2000);
      if (t.unref) t.unref();
    } catch (_) {
      finish();
    }
  });
}

module.exports = {
  TAG,
  DEFAULT_CONFIG,
  projectRoot,
  loadConfig,
  classifiers,
  isModifyBrief,
  isModifyDispatch,
  hasMechanismNote,
  isMissingModel,
  hasImpactStatement,
  isCodeFileWrite,
  textOfContent,
  isRealUserInput,
  agentDef,
  readTurn,
  readStdinJson,
  emit,
};
