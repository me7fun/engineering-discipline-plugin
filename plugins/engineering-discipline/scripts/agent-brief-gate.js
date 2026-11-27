/**
 * agent-brief-gate.js — PreToolUse hook（matcher: Agent）
 *
 * 派工闸门：主对话派 Agent 时检查两件事，两件各自判断、合成一份输出。
 *
 * A. 机制笔记（看 tool_input.prompt）
 *   1. 不是修改类（派给只读类型的子代理、提交类派工、没命中修改词，或带只读／只改文件／只提交标记）→ 不提
 *   2. 修改类且已附机制笔记（有「机制笔记」字样，或五个标题至少命中 3 个）→ 不提
 *   3. 修改类且缺笔记 → warn 模式提醒；block 模式挡下
 *
 * B. 模型（看 tool_input.model）
 *   1. subagent_type 是 fork → 不提（fork 一律沿用主对话模型）
 *   2. 该代理类型的定义档自己写了 model → 不提
 *   3. model 没填 → 提醒。所有派工都看，不只修改类
 *   4. 这一项固定只提醒，block 模式下也不挡
 *
 * 输出：
 *   - 缺笔记且 block 模式 → stderr 说明（缺模型时一并附上），exit 2
 *   - 其余有任一项要提 → stdout 一个 JSON：systemMessage（给使用者看）＋
 *     hookSpecificOutput.additionalContext（同一段文字，给模型看），exit 0
 *   - 两项都没事 → 不输出，exit 0
 * 任何例外一律放行（exit 0），不能卡死派工。
 */

"use strict";

const lib = require("./lib");

const MISSING_MSG =
  `${lib.TAG} 派工 brief 缺機制筆記（五行）：系統與職責／症狀所在／現況為何如此／` +
  "改什麼、牽動誰（改動影響聲明）／怎麼驗整個系統。修改類派工請把這五行放進 brief，" +
  "讓 agent 知道動的是哪一層、下游誰依賴、整個系統怎麼驗；只讀調查請在 brief 標明「只讀」；只改文件、不動程式碼的派工請標明「只改文件」；只做 commit／push 的請標明「只提交」。";

const MODEL_MSG =
  `${lib.TAG} 這次派工沒寫明模型（model），會沿用主對話的模型。` +
  "之後每一隻 agent 請明寫模型與思考量：清單／盤點／跑腳本用 Sonnet，" +
  "照規格實作、判讀、找原因用 Opus，驗收前的獨立複核用最強的模型。" +
  "（代理定義檔自己寫了 model 的類型不會收到這則提醒。）";

async function main() {
  const data = await lib.readStdinJson();
  if (!data) return 0;
  if (data.tool_name && data.tool_name !== "Agent") return 0;

  const input = data.tool_input && typeof data.tool_input === "object" ? data.tool_input : {};
  const prompt = typeof input.prompt === "string" ? input.prompt : "";
  if (!prompt) return 0;

  const root = lib.projectRoot();
  const cfg = lib.loadConfig(root);
  const cls = lib.classifiers(cfg);

  const missingNote = lib.isModifyDispatch(input, cls, cfg, root) && !lib.hasMechanismNote(prompt);
  const missingModel = lib.isMissingModel(input, root);
  if (!missingNote && !missingModel) return 0;

  if (missingNote && cfg.mode === "block") {
    await lib.emit(MISSING_MSG + "\n" + (missingModel ? MODEL_MSG + "\n" : ""), process.stderr);
    return 2;
  }

  const msgs = [];
  if (missingNote) msgs.push(MISSING_MSG);
  if (missingModel) msgs.push(MODEL_MSG);
  const text = msgs.join("\n");
  const out = {
    systemMessage: text,
    hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: text },
  };
  await lib.emit(JSON.stringify(out));
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch(() => process.exit(0));
