/**
 * stop-gate.js — Stop hook
 *
 * 收工闸门：宣称「修好／已完成／PASS」的回合，若本轮真的动过 code，回报必须附改动影响声明。
 *
 * 判断流程：
 *   1. stop_hook_active 为 true → 放行（一轮最多拦 1 次，避免无限打回）
 *   2. 没有 transcript_path 或档案不存在 → 放行
 *   3. 读「本轮」（最后一则真正的用户输入之后），收集：
 *        - 最后一则 assistant 文字（优先用 data.last_assistant_message）
 *        - 本轮有没有修改类动作：Edit／Write 写到正式程式码（与动手前闸门同一把尺），
 *          或 Agent 的修改类派工（与派工闸门同一把尺）
 *   4. 最后回复没命中完成宣称 → 放行
 *   5. 本轮没有修改类动作（纯问答、文件编辑、改工具脚本）→ 放行
 *   6. 最后回复已含「改动影响声明／机制笔记／影响面」任一字样 → 放行
 *   7. 其余：warn 模式输出 systemMessage；block 模式输出 decision block
 * 任何例外一律放行，不能卡死对话。
 *
 * 范围说明：只看「本轮」，不看整个 session——
 * 否则 session 早期改过一次 code，之后每个带「已完成」的回合都会被追讨。
 */

"use strict";

const fs = require("fs");
const lib = require("./lib");

const EDIT_TOOLS = ["Edit", "Write", "MultiEdit", "NotebookEdit"];

const REASON =
  `${lib.TAG} 本輪動過正式程式碼（Edit／Write 或修改類派工），收工回報卻沒有「改動影響聲明」。` +
  "請補：改了什麼→牽動誰（下游依賴）→整個機制驗了哪些（驗職責不驗症狀）。" +
  "回報中含「改動影響聲明」或「機制筆記」字樣即可通過。";

/** 这个 tool_use 是不是修改类动作 */
function isModifyToolUse(block, cls, cfg, root) {
  if (!block || block.type !== "tool_use") return false;
  const input = block.input && typeof block.input === "object" ? block.input : {};
  if (EDIT_TOOLS.includes(block.name)) {
    return lib.isCodeFileWrite(input.file_path || input.notebook_path, cfg, root);
  }
  if (block.name === "Agent") return lib.isModifyDispatch(input, cls, cfg, root);
  return false;
}

async function main() {
  const data = await lib.readStdinJson();
  if (!data) return;
  if (data.stop_hook_active) return;

  const transcriptPath = data.transcript_path;
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return;

  const root = lib.projectRoot();
  const cfg = lib.loadConfig(root);
  const cls = lib.classifiers(cfg);

  const turn = lib.readTurn(transcriptPath);
  if (!turn.found) return; // 找不到本轮起点 → 不退化成整个 session 的范围，放行

  let lastAssistantText = "";
  let hasModify = false;
  for (const content of turn.assistant) {
    if (content.some((b) => isModifyToolUse(b, cls, cfg, root))) hasModify = true;
    const t = lib.textOfContent(content);
    if (t.trim()) lastAssistantText = t;
  }
  const message =
    (typeof data.last_assistant_message === "string" && data.last_assistant_message) ||
    lastAssistantText ||
    "";
  if (!message.trim()) return;

  if (!cls.claimRe.test(message)) return; // 没宣称完成
  if (!hasModify) return; // 本轮没动正式程式码
  if (lib.hasImpactStatement(message)) return; // 已附声明

  if (cfg.mode === "block") {
    await lib.emit(JSON.stringify({ decision: "block", reason: REASON }));
  } else {
    await lib.emit(JSON.stringify({ systemMessage: REASON }));
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(0));
