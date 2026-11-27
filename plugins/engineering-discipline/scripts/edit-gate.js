/**
 * edit-gate.js — PreToolUse hook（matcher: Edit|Write|MultiEdit|NotebookEdit）
 *
 * 动手前闸门：主对话这一轮第一次要改「正式程式码」时，若这一轮还没写机制笔记，
 * 在改动发生前提醒模型一次。
 *
 * 判断流程（由便宜到贵）：
 *   1. 子代理里的呼叫（stdin 有 agent_id）→ 不提（子代理的机制笔记由派工闸门看 brief）
 *   2. 写的不是正式程式码（专案外、.claude/、不在 codePaths 内、说明文件）→ 不提
 *   3. 这一轮已经提醒过（同一个 prompt_id）→ 不提
 *   4. 读「本轮」对话纪录；找不到本轮起点 → 不提
 *   5. 这一轮稍早已经改过正式程式码 → 不提（一轮只在第一次提醒）
 *   6. 这一轮已有机制笔记（用户输入、主对话文字、写进档案或派工 brief 的内容，任一处）→ 不提
 *   7. 其余：stdout {"hookSpecificOutput": {additionalContext}}，exit 0
 *
 * 只送给模型看（additionalContext），不显示给使用者；固定只提醒，block 模式也不挡。
 * 任何例外一律放行（exit 0），不能卡死改档。
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const lib = require("./lib");

const EDIT_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];

function message(rel) {
  return (
    `${lib.TAG} 這一輪即將第一次修改正式程式碼（${rel}），而這一輪還沒有機制筆記。` +
    "機制筆記五行：系統與職責／症狀所在／現況為何如此／改什麼、牽動誰（改動影響聲明）／怎麼驗整個系統。" +
    "五行填得出來再改；填不出來代表還沒弄清楚牽動誰。這則提醒一輪只出現一次。"
  );
}

/** 一轮只提醒一次：用 session_id + prompt_id 记在暂存档 */
function stateFile(sessionId) {
  const safe = String(sessionId || "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safe) return null;
  return path.join(os.tmpdir(), "engineering-discipline", `${safe}.edit-gate`);
}

function alreadyReminded(file, promptId) {
  try {
    return fs.readFileSync(file, "utf8").trim() === promptId;
  } catch (_) {
    return false;
  }
}

function markReminded(file, promptId) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, promptId);
  } catch (_) {}
}

/** 把本轮里可能放机制笔记的文字全部收起来 */
function turnText(turn) {
  const parts = [turn.userText];
  for (const content of turn.assistant) {
    for (const b of content) {
      if (!b) continue;
      if (b.type === "text") parts.push(b.text || "");
      if (b.type === "tool_use" && b.input && typeof b.input === "object") {
        for (const k of ["content", "new_string", "prompt"]) {
          if (typeof b.input[k] === "string") parts.push(b.input[k]);
        }
      }
    }
  }
  return parts.join("\n");
}

async function main() {
  const data = await lib.readStdinJson();
  if (!data) return;
  if (!EDIT_TOOLS.includes(data.tool_name)) return;
  if (data.agent_id) return;

  const input = data.tool_input && typeof data.tool_input === "object" ? data.tool_input : {};
  const filePath = input.file_path || input.notebook_path;
  const root = lib.projectRoot();
  const cfg = lib.loadConfig(root);
  if (!lib.isCodeFileWrite(filePath, cfg, root)) return;

  const promptId = typeof data.prompt_id === "string" ? data.prompt_id : "";
  const state = stateFile(data.session_id);
  if (state && promptId && alreadyReminded(state, promptId)) return;

  const transcriptPath = data.transcript_path;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return;
  const turn = lib.readTurn(transcriptPath);
  if (!turn.found) return;

  const editedBefore = turn.assistant.some((content) =>
    content.some(
      (b) =>
        b &&
        b.type === "tool_use" &&
        b.id !== data.tool_use_id &&
        EDIT_TOOLS.includes(b.name) &&
        lib.isCodeFileWrite(b.input && (b.input.file_path || b.input.notebook_path), cfg, root)
    )
  );
  if (editedBefore) return;
  if (lib.hasMechanismNote(turnText(turn))) return;

  if (state && promptId) markReminded(state, promptId);
  const rel = path.relative(root, path.resolve(root, String(filePath))) || String(filePath);
  await lib.emit(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: message(rel) },
    })
  );
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
