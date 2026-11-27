# engineering-discipline-plugin

Claude Code marketplace，只含一个 plugin：`engineering-discipline`。

**用途**：不分专案的工作纪律。规则只写成文字，对话一长就会被稀释，所以用 hook 放进流程：开对话时自动带入规则，在该检查的时机自动检查。纯 node、无相依。

目前收两组规则：

### 一、修改前先画机制

- **为什么**：修 bug 只盯眼前症状，容易修好 A 弄坏 B，多轮才收敛。
- **规则**：动手前回答五个问题，写成「机制笔记」五行（系统与职责／症状所在／现况为何如此／改什么、牵动谁／怎么验整个系统）。多轮任务另有「范围与总帐」两条：先定结案情境、定了就封，新类型问题与顺手发现的无关 BUG 记待办另开；每个发现的问题记一行总帐，标明新机制／旧问题重开／自己改出来的。
- **检查时机**：
  - 动手前——主对话这一轮第一次要改正式程式码，而这一轮还没有机制笔记。
  - 派工时——修改类 brief 没附机制笔记。
  - 收工时——宣称修好，回报却没附改动影响声明。

### 二、派 agent 时怎么选模型

- **为什么**：派工不写模型会沿用主对话的最高档，一次派很多只，额度很快用完。
- **规则**：每一只 agent 都明写模型与思考量；依「判错的代价多大、做法定了没」选档；实作与复核分开派；大批派工前先跑一小批量单价。
- **检查时机**：派工时看有没有写明模型（只提醒，不挡）。

新增通用规则时照同一个做法：规则文字加进开场注入，需要检查的加进对应时机的 hook，README 在这里加一组。

## 目录

```
engineering-discipline-plugin/
├── .claude-plugin/marketplace.json
├── README.md
└── plugins/engineering-discipline/
    ├── .claude-plugin/plugin.json
    ├── hooks/hooks.json                 SessionStart / PreToolUse(Edit 类、Agent) / Stop
    ├── scripts/
    │   ├── lib.js                       设定读取、分类器、读「本轮」对话纪录（三个闸门共用同一把尺）
    │   ├── session-start.js             开场注入规则文字（≤40 行）
    │   ├── edit-gate.js                 动手前闸门
    │   ├── agent-brief-gate.js          派工闸门
    │   ├── stop-gate.js                 收工闸门
    │   └── review-stats.js              检视试行效果用的统计（手动执行）
    └── skills/mechanism-note/SKILL.md   /engineering-discipline:mechanism-note
```

## 安装

```
claude plugin marketplace add me7fun/engineering-discipline-plugin        # 或本机 clone 下来的资料夹路径
claude plugin install engineering-discipline@engineering-discipline-plugin --scope local   # 在目标专案目录执行
```

`--scope local` 写进 `<专案>/.claude/settings.local.json`（不进 git）；`--scope project` 会写进会进 git 的 `settings.json`。

更新：

```
claude plugin marketplace update engineering-discipline-plugin
claude plugin update engineering-discipline@engineering-discipline-plugin --scope local   # 在目标专案目录执行
```

更新后要重新载入 plugin（开新对话）才生效。

## 提醒送给谁

| 闸门 | 使用者看得到 | 模型看得到 | block 模式 |
|---|---|---|---|
| 动手前（缺机制笔记） | 否 | 是 | 不挡，固定只提醒 |
| 派工（缺机制笔记） | 是 | 是 | 挡下这次派工 |
| 派工（没写模型） | 是 | 是 | 不挡，固定只提醒 |
| 收工（缺改动影响声明） | 是 | 否 | 打回最后回复 |

`systemMessage` 只显示给使用者；要让模型看到，用 `hookSpecificOutput.additionalContext`。

## 三个闸门的判准

### 共用的三把尺

**什么算「正式程式码」**（动手前闸门、收工闸门共用）：

1. 专案根以外的档（暂存区、别的资料夹）→ 不算。
2. 专案的 `.claude/` 底下（进度档、设定、hook）→ 不算。
3. 有设 `codePaths`：落在其中一个路径前缀底下、且不是 `.md|.txt|.log` → 算；其余不算。
4. 没设 `codePaths`：副档名是 `.ts|.tsx|.js|.jsx|.mjs|.cjs|.vue|.go|.py|.json` → 算。

专案里有大量工具脚本、一次性脚本时，建议设 `codePaths` 只圈产品程式码，否则改脚本也会被当成改程式。

**什么算「修改类派工」**（派工闸门、收工闸门共用），依序判断：

1. `subagent_type` 是只读类型 → 不算。内建 `Explore`、`Plan`、`web-fetch`、`claude-code-guide`，可用 `readOnlyAgentTypes` 追加，不分大小写。
2. 该类型的代理定义档（`<专案>/.claude/agents/` 或 `~/.claude/agents/`）列了 `tools` 且没有 `Edit|Write|MultiEdit|NotebookEdit` → 不算。
3. 提交类派工 → 不算：`description` 命中 `commit|提交|推送|push|rollout|tag`，且以这些字开头、或没有同时命中修改词。
4. brief 命中只读标记 `/只讀|只读|read-only|唯讀|只做調查|只做调查|不改任何|禁改|不動 code|不动 code|只改文件|只改文档|docs-only|只提交|只做提交|commit-only/i` → 不算。
5. brief 命中修改词 `/修|fix|修復|修正|修复|改碼|改码|改 code|實作|实作|实现|patch|bug/i` → 算。
6. 其余不算。没带 `subagent_type` 的派工从第 3 步开始判断。

**什么算「有机制笔记」**（二择一）：含 `機制筆記|机制笔记` 字样；或五个标题 `系統與職責｜症狀所在｜現況為何｜牽動誰｜怎麼驗`（简繁皆认）至少命中 3 个不同的。

### 动手前闸门（PreToolUse，matcher `Edit|Write|MultiEdit|NotebookEdit`）

主对话这一轮第一次要改正式程式码时，若这一轮还没有机制笔记，在改动发生前提醒模型一次。

1. 子代理里的呼叫（stdin 有 `agent_id`）→ 不提。子代理的机制笔记由派工闸门看 brief。
2. 写的不是正式程式码 → 不提。
3. 这一轮已经提醒过，或这一轮稍早已经改过正式程式码 → 不提（一轮只提醒一次）。
4. 这一轮已有机制笔记 → 不提。认的范围：这一轮的用户输入、主对话文字、写进档案的内容（例如计画档）、派工 brief。
5. 其余 → 提醒，exit 0。只送给模型，不显示给使用者；block 模式也不挡。

「一轮」＝最后一则真正的用户输入之后。读不到对话纪录、找不到本轮起点时一律放行。

### 派工闸门（PreToolUse，matcher `Agent`）

看两件事，各自判断，合成一份输出。

**A. 机制笔记**：修改类派工的 brief 没有机制笔记 → 提醒或挡下。

**B. 模型**——读 `tool_input.model`：

1. `subagent_type` 是 `fork` → 不检查（fork 一律沿用主对话模型，填了也无效）。
2. 该代理类型的定义档自己写了 `model`（不是 `inherit`）→ 不检查。
3. `model` 没填 → 提醒。所有派工都看，不只修改类（盘点、复核也会吃额度）。
4. 这一项固定只提醒，`mode` 是 block 也不挡。`effort`（思考量）没填不检查。

输出：

- 缺笔记且 block 模式 → stderr 说明（同时缺模型就一并附上）+ exit 2。
- 其余有任一项要提 → stdout 一个 JSON，exit 0：同一段文字放进 `systemMessage`（给使用者）与 `hookSpecificOutput.additionalContext`（给模型）。
- 两项都没事 → 不输出。

### 收工闸门（Stop）

1. `stop_hook_active` 为 true → 放行（一轮最多拦一次，避免无限打回）。
2. 没 `transcript_path` 或档不存在 → 放行。
3. 取最后一则 assistant 文字（优先 `last_assistant_message`，否则从对话纪录取）。
4. 命中**完成宣称** `/修好|已修|已上 dev|上 dev 了|PASS|通過|通过|修復完成|修正完成|已完成/`
   **且本轮**有修改类动作（改了正式程式码，或派了修改类派工）
   **且**该则缺 `改動影響聲明|改动影响声明|機制筆記|机制笔记|影響面|影响面` 任一字样 → 提醒或挡下。
5. 纯问答、文件编辑、改工具脚本、没有修改类动作的回合一律放行。

输出：warn 模式 `{"systemMessage": …}`；block 模式 `{"decision":"block","reason":"…請補：改了什麼→牽動誰→整個機制驗了哪些"}`。

范围只看「本轮」不看整个 session——否则 session 早期改过一次 code，之后每个带「已完成」的回合都会被追讨。

## 设定

读取顺序（后者覆盖前者；`mode` 取最后一个有定义的，五个阵列一律**追加**到内建清单之后）：

1. 内建预设 `{"mode":"warn","modifyKeywords":[],"readOnlyKeywords":[],"claimKeywords":[],"readOnlyAgentTypes":[],"codePaths":[]}`
2. `~/.claude/engineering-discipline.json`（使用者层级）
3. `<专案>/.claude/engineering-discipline.config.json`（专案层级，会进 git）
4. `<专案>/.claude/engineering-discipline.config.local.json`（专案层级本机覆盖，存在才读）

缺档、坏档一律跳过该层。**预设 warn。**

```json
{
  "mode": "warn",
  "codePaths": ["src/", "packages/"],
  "readOnlyAgentTypes": ["independent-reviewer"],
  "modifyKeywords": ["重構", "refactor"],
  "readOnlyKeywords": ["只看", "audit"],
  "claimKeywords": ["搞定", "done"]
}
```

- `mode`：`block` 时派工闸门缺机制笔记以 exit 2 挡下，收工闸门以 `decision: block` 打回最后回复（打回一次后 `stop_hook_active` 为 true，第二次放行）。
- `codePaths`：哪些路径算正式程式码，写相对专案根的路径前缀。
- `readOnlyAgentTypes`：只做验证、不改程式，但定义档里有写档工具的自订代理类型填进来。定义档没有写档工具的类型会自动判成只读，不必填。
- 三个关键字阵列的内容当纯文字处理（会 escape），追加到内建 regex 之后；内建关键字不能删，只能用只读标记盖过。

## 检视效果

```
node plugins/engineering-discipline/scripts/review-stats.js <专案目录> --since 2026-11-27
```

输出两块：这个专案的对话纪录里各种提醒各响了几次（按日期）；专案 `.claude/state/` 底下总帐的「关系」字样各出现几次。「自己改出來的」的次数就是「修 A 坏 B」的次数，是这组规则有没有用的指标——前提是总帐照固定字样记。

## 与其他外挂的约定

只认约定，不认对方；对方没装时这些句子不产生作用。

- 常驻待办档是 `.claude/state/todo.md`（专案有 `.claude/state/` 才用；没有就问使用者记在哪）。
- 总帐写在该任务的进度档（专案有 `.claude/state/` 就放那里）。
- 专案有知识库时，查原始意图先查知识库；查到而知识库没记载的，收工时列为知识候选。
- 专案要求先写计画档时，机制笔记五行写进计画档当一节，不另写一份。

## 已知限制

- hook 只保证**没跳过步骤**，不保证**想得对**：贴了五行标题但内容空洞，照样放行。
- 修改类派工的判准是关键字：`fix` 会命中 `prefix`、`修` 会命中「修改说明文件」；误判时在 brief 加只读、「只改文件」或「只提交」标记，或用 `readOnlyKeywords` 追加自己的标记。
- 收工闸门看不到子代理实际改了什么档，只能照派工 brief 的文字判断；派了修改类派工的回合，即使子代理只改了工具脚本也会提醒。
- 动手前闸门只看主对话；子代理里的改档不检查。
- 完成宣称判准同样是关键字：问答回合里引用别人的「已完成」字样，只要本轮没动正式程式码就不会触发。
- 收工闸门在 `stop_hook_active` 为 true 时直接放行：同一轮若先被别的收工检查打回，重答那一次不会再检查改动影响声明。
- 只认对话纪录里 `type: user|assistant` 的纪录，且只读尾端（最多 64MB）；格式若改版或一轮超长，退化为放行，不会挡。
- 派工闸门只看 `Agent` 工具：经 SendMessage 续派给既有 agent 的 brief 不检查；Workflow 脚本里的 `agent()` 也拦不到，有没有写明模型只靠开场注入的规则文字。
- 收工闸门在 warn 模式的提醒只显示给使用者，模型看不到；要回到模型手上得切 block。
