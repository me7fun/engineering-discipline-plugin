#!/usr/bin/env node
/**
 * review-stats.js — 检视试行效果用的统计（手动执行，不是 hook）
 *
 * 用法：node review-stats.js [专案目录] [--since YYYY-MM-DD]
 *
 * 输出两块：
 *   1. 这个专案的对话纪录里，本 plugin 各种提醒各响了几次（按日期）。
 *      只数得到显示给使用者的提醒（派工、收工）；动手前闸门只送给模型，纪录里另外数。
 *   2. 专案 .claude/state/ 底下总帐的「关系」字样各出现几次：
 *      新機制／舊問題重開／自己改出來的。「自己改出來的」就是「修 A 坏 B」的次数。
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const args = process.argv.slice(2);
const sinceIdx = args.indexOf("--since");
const since = sinceIdx >= 0 ? args[sinceIdx + 1] || "" : "";
const positional = args.filter((a, i) => sinceIdx < 0 || (i !== sinceIdx && i !== sinceIdx + 1));
const project = path.resolve(positional[0] || process.cwd());

const TAG = "[engineering-discipline]";
const KINDS = [
  ["動手前缺筆記", /即將第一次修改正式程式碼/],
  ["派工缺筆記", /派工 brief 缺機制筆記/],
  ["派工沒寫模型", /這次派工沒寫明模型/],
  ["收工缺聲明", /收工回報卻沒有「改動影響聲明」/],
];

function transcriptDir(p) {
  return path.join(os.homedir(), ".claude", "projects", p.replace(/[^a-zA-Z0-9]/g, "-"));
}

function countReminders(dir) {
  const byDay = {};
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
  } catch (_) {
    return { byDay, sessions: 0 };
  }
  let sessions = 0;
  for (const f of files) {
    const seen = new Set();
    let hit = false;
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!line.includes(TAG) || !line.includes('"attachment"')) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch (_) {
        continue;
      }
      const a = rec.attachment || {};
      const text =
        a.type === "hook_system_message"
          ? String(a.content || "")
          : a.type === "hook_additional_context"
            ? [].concat(a.content || []).join("\n")
            : "";
      if (!text.includes(TAG)) continue;
      const day = String(rec.timestamp || "").slice(0, 10);
      if (since && day < since) continue;
      for (const [name, re] of KINDS) {
        if (!re.test(text)) continue;
        const key = `${a.toolUseID || rec.uuid}|${name}`;
        if (seen.has(key)) continue;
        seen.add(key);
        byDay[day] = byDay[day] || {};
        byDay[day][name] = (byDay[day][name] || 0) + 1;
        hit = true;
      }
    }
    if (hit) sessions++;
  }
  return { byDay, sessions };
}

function countLedger(dir) {
  const words = ["新機制", "舊問題重開", "自己改出來的"];
  const total = Object.fromEntries(words.map((w) => [w, 0]));
  const files = [];
  const walk = (d) => {
    let entries = [];
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (_) {
      return;
    }
    for (const e of entries) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.md$/i.test(e.name)) {
        if (since && fs.statSync(p).mtime.toISOString().slice(0, 10) < since) continue;
        const text = fs.readFileSync(p, "utf8");
        const row = words.map((w) => text.split(w).length - 1);
        if (row.some(Boolean)) {
          files.push([path.relative(dir, p), row]);
          row.forEach((n, i) => (total[words[i]] += n));
        }
      }
    }
  };
  walk(dir);
  return { total, files };
}

const { byDay, sessions } = countReminders(transcriptDir(project));
console.log(`專案：${project}${since ? `（${since} 起）` : ""}`);
console.log(`\n一、提醒次數（${sessions} 個對話有提醒）`);
const sum = {};
for (const day of Object.keys(byDay).sort()) {
  console.log(`  ${day}  ${Object.entries(byDay[day]).map(([k, v]) => `${k} ${v}`).join("、")}`);
  for (const [k, v] of Object.entries(byDay[day])) sum[k] = (sum[k] || 0) + v;
}
console.log(`  合計  ${Object.entries(sum).map(([k, v]) => `${k} ${v}`).join("、") || "無"}`);

const ledger = countLedger(path.join(project, ".claude", "state"));
console.log("\n二、總帳「關係」字樣（.claude/state/ 底下的 .md）");
console.log(`  ${Object.entries(ledger.total).map(([k, v]) => `${k} ${v}`).join("、")}`);
for (const [f, row] of ledger.files) console.log(`  ${f}  ${row.join(" / ")}`);
