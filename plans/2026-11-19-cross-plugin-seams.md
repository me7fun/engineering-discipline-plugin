# engineering-discipline：與其他外掛的交接處調整（W1、W2、W4、W5、W6）

> 狀態：W1、W2、W4、W5、W6 已在 0.1.4 實作；W3 未做（見「不做什麼」）。本檔是當時的計畫，現行行為以 README 為準。
> 規劃日期 2026-11-19。規劃時讀過的版本：`plugin.json` 0.1.2；目前版本 0.1.3（加了「派 agent 時怎麼選模型」），本計畫實作時用 0.1.4。

## 背景

使用者同時在用四個外掛，各管一件事：

| 外掛 | 管什麼 | 位置 |
|---|---|---|
| wiki | 專案知識庫：記在哪、誰批准才能寫；進度檔放 `.claude/state/` | `github.com/me7fun/claude-knowledge-plugin` |
| engineering-discipline（本 repo） | 改程式前先寫機制筆記；派工與收工各檢查一次 | `github.com/me7fun/engineering-discipline-plugin` |
| codex-dispatch | 先寫計畫檔、送審、逐條查證、驗收、救援；Codex 不可用時開唯讀子代理自審 | `github.com/me7fun/codex-dispatch-plugin` |
| claude-pulse | 只監看對話狀態，不下任何規則 | `github.com/me7fun/claude-pulse-plugin` |

外掛之間不互相呼叫，只靠幾個約定交接：`.claude/state/`、知識庫、計畫檔、交辦內容、最後回覆。本計畫只處理「本外掛這一側」的交接處。wiki 那一側另有一份計畫，兩邊各自獨立，不需要同時發版。

**原則：只認約定，不認對方。** 文字與程式裡不寫其他外掛的名稱、安裝路徑或版本，只寫「專案有 `.claude/state/` 就…」「專案有知識庫就…」這類條件。對方沒裝時，這些句子不產生作用。

## 動手前要確認的事（問使用者）

1. **版控**：本資料夾是 git repo（remote：`github.com/me7fun/engineering-discipline-plugin`）。改動做成獨立的 commit，要不要 push 問使用者。
2. **試行中**：本外掛在一個試行專案試行，2026-11-30 檢討（提醒檔在該專案 `.claude/state/engineering-discipline-review-reminder.md`）。本計畫會改變派工閘門的判斷，檢討時要能區分改動前後。實作完成後告訴使用者實際生效日期。
3. **已安裝版本**：試行專案裝的是 0.1.3（2026-11-27 更新），與原始碼一致。

## 要改什麼

### W1　待辦有固定的位置

**現況**：開場文字與指令說明都寫「記進待辦另開」，沒說記在哪。實際上各專案的檔名都不同（`todo.md`、`known-bugs.md`、`*-pending.md`）。

**改法**：約定常駐待辦檔是 `.claude/state/todo.md`。

- `scripts/session-start.js`「範圍與總帳」第一條：把「記進待辦另開（位置、現象、查證到哪、建議修法）」改成「記進專案的常駐待辦檔另開（專案有 `.claude/state/` 就寫 `.claude/state/todo.md`；每條記位置、現象、查證到哪、建議修法）」。
- `skills/mechanism-note/SKILL.md`「範圍與總帳」第 1 點的兩處「記進待辦另開」：同樣寫明檔案位置，並補一句「專案沒有 `.claude/state/` 就問使用者記在哪」。
- 不搬動、不改名各專案現有的待辦檔。

### W2　查原始意圖時先查知識庫，查到的值得記下來

**現況**：五個問題的第②題與機制筆記第三行只叫人翻 git log、註解、舊版，沒提知識庫；查出來的原因也沒有去處。

**改法**：

- `scripts/session-start.js` 第②題：把「（查原始意圖；查不到標「未知」…」改成「（先查專案知識庫，再查 git 紀錄與註解；查不到標「未知」…」。
- `SKILL.md`「每行怎麼填」第 3 點：查找順序改成「專案知識庫 → git log／註解／舊版」，並加一句「查到的原始意圖若知識庫沒有記載，收工時列為知識候選；專案有知識庫提案流程就照它走」。

### W4　只改文件的派工不必附機制筆記

**現況**：`修正知識頁…`、`更新 README 並修錯字` 這類交辦會命中修改詞「修」，被要求附機制筆記。已用 `lib.isModifyBrief` 實測，兩句都回 `true`。

**改法**：

- `scripts/lib.js` 的 `READONLY_RE_SRC` 加入 `只改文件|只改文档|docs-only`。
- `scripts/agent-brief-gate.js` 的 `MISSING_MSG` 結尾加一句：「只改文件、不動程式碼的派工請標明「只改文件」。」
- 不用「知識庫」「知識頁」當豁免關鍵字。W2 之後，改程式的交辦也會提到知識庫，拿它豁免會放掉真正該檢查的派工。

### W5　唯讀類型的子代理不檢查

**現況**：codex-dispatch 的「驗收修正」會開 Explore（唯讀）子代理，交辦內容是英文，含 `verifying fixes`，沒有本外掛認得的唯讀標記。已實測該段文字會被判成「修改類且缺機制筆記」。warn 模式下只多一則提醒；改成 block 模式後會直接擋掉驗收。

**改法**：以子代理類型判斷，不靠關鍵字。

- `lib.js`：
  - 新增常數 `READONLY_AGENT_TYPES = ["Explore", "Plan"]`。
  - `DEFAULT_CONFIG` 新增 `readOnlyAgentTypes: []`，`mergeLayer` 與另外三個陣列一樣用追加。
  - 新增 `isModifyDispatch(input, cls, cfg)`：`input.subagent_type` 落在唯讀類型清單（內建＋設定追加，比對不分大小寫）就回 `false`；否則回 `isModifyBrief(input.prompt, cls)`。匯出它。
- `agent-brief-gate.js`：把 `lib.isModifyBrief(prompt, cls)` 換成 `lib.isModifyDispatch(input, cls, cfg)`。
- `stop-gate.js` 的 `isModifyToolUse`：Agent 分支同樣改用 `isModifyDispatch`（要把 `cfg` 傳進去）。派工閘門與收工閘門必須用同一把尺。
- 沒帶 `subagent_type` 的派工維持原判斷，不豁免。

### W6　有計畫檔時，機制筆記寫進計畫檔

**現況**：專案若另有「改動較大先寫計畫檔」的流程，一次修 bug 會同時被要求寫計畫檔與機制筆記，內容有重疊（計畫的測試方式 ≈ 第五行；計畫的「不做什麼」≈ 結案情境）。

**改法**：`SKILL.md` 開頭「填好後」那一行後面加一句：「專案要求先寫計畫檔時，五行寫進計畫檔當一節，不另寫一份；計畫的測試方式直接用第五行，「不做什麼」直接用結案情境。」

### README

- 「兩個 hook 的判準」：補上 W4 的新標記與 W5 的子代理類型判斷。
- 「設定」：補 `readOnlyAgentTypes`。
- 「已知限制」：`fix` 會命中 `prefix` 那條保留；刪掉已不成立的描述。
- 新增一節「與其他外掛的約定」，只列三條：常駐待辦檔 `.claude/state/todo.md`；有知識庫先查、查到的列為知識候選；有計畫檔時機制筆記寫進計畫檔。

### 版本

`plugin.json` 的 `version` 改成 `0.1.4`。

## 步驟

1. 向使用者確認上面三件事。
2. 依序改 `lib.js` → `agent-brief-gate.js` → `stop-gate.js` → `session-start.js` → `SKILL.md` → `README.md` → `plugin.json`。
3. 跑「怎麼驗」的全部項目。
4. 更新到試行專案（使用者同意後）：
   ```bash
   claude plugin marketplace update engineering-discipline-plugin
   cd <試行專案目錄>
   claude plugin update engineering-discipline@engineering-discipline-plugin --scope local
   ```
5. 告訴使用者生效日期，並提醒 2026-11-30 檢討時要把「派工閘門的誤攔次數」分成改動前後來看。

## 怎麼驗

在 `plugins/engineering-discipline/` 底下執行。前四項檢查派工閘門，預期結果寫在註解。

```bash
# 1. 唯讀類型的子代理：不輸出任何東西
echo '{"tool_name":"Agent","tool_input":{"subagent_type":"Explore","prompt":"You are verifying fixes to previously reported findings. Do not modify any files."}}' | node scripts/agent-brief-gate.js

# 2. 同一段文字但沒帶類型：輸出 systemMessage（維持原行為）
echo '{"tool_name":"Agent","tool_input":{"prompt":"You are verifying fixes to previously reported findings."}}' | node scripts/agent-brief-gate.js

# 3. 標明只改文件：不輸出任何東西
echo '{"tool_name":"Agent","tool_input":{"prompt":"修正知識頁 pitfalls/foo.md 的重複小節（只改文件）"}}' | node scripts/agent-brief-gate.js

# 4. 一般修 bug 的交辦：輸出 systemMessage
echo '{"tool_name":"Agent","tool_input":{"prompt":"修掉結算流程餘額太早更新的 bug"}}' | node scripts/agent-brief-gate.js
```

5. 開場注入：`node scripts/session-start.js` 輸出合法 JSON，文字含 `.claude/state/todo.md` 與「先查專案知識庫」，總行數仍在檔頭註解寫的上限內。
6. 收工閘門回歸：準備一份對話紀錄，最後一輪只有「Explore 子代理＋宣稱已完成」，確認不再被要求補改動影響聲明；另一份最後一輪有 Edit 寫到 `.js`＋宣稱已完成＋沒有聲明，確認仍會提醒。
7. 設定檔缺檔、壞檔、`readOnlyAgentTypes` 不是陣列時，三支腳本都正常結束（exit 0），不擋對話。

本 repo 目前沒有測試檔。若使用者同意，把上面的檢查寫成 `plugins/engineering-discipline/test/*.test.mjs`（`node:test`，不裝任何套件）。

## 不做什麼

- **不改 `mode`**：維持 warn，要不要轉 block 留給 2026-11-30 的試行檢討。
- **不動使用者的設定檔** `~/.claude/engineering-discipline.json`。
- **不修 W3**：收工閘門在 `stop_hook_active` 為 true 時直接放行。同一輪若先被別的收工檢查打回，重答那一次不會再檢查改動影響聲明。warn 模式下影響很小，留到試行檢討再決定；要修的話，做法是改用自己的每輪計數，不依賴 `stop_hook_active`。
- **不改其他外掛的 repo**。
- **不新增開場注入的段落**，只改既有句子。
- **不動「沒寫明模型」的檢查**：`agent-brief-gate.js` 現在同時看機制筆記與模型兩件事；W4、W5 只改機制筆記那一項的判斷，唯讀類型的子代理沒寫模型仍照常提醒。
