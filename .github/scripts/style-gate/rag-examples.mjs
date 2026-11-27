// 來源:vps-blogger/tools/style-gate/rag-examples.mjs(vendored,改功能改那份再 npm run gate:sync 同步)。
// rag-examples.mjs — Lane B 的「自我學習」例子庫(RAG few-shot)。**下一步**,先把格式與 loader 定好。
//
// 概念(見 docs/style-gate-plan.md):把作者歷次「原句 → 改後」存成例子,之後當 few-shot
// 餵給 Lane B 的 AI 偵測器,讓它更準地抓到**這位作者**在意的 AI 腔。
//
// 關鍵界線:它優化的是「**建議準不準**」,不是「亂改的權力」。不管例子庫多大,Lane B 的輸出
// 永遠還是「列建議、人點頭」——例子只影響「抓哪些句子、建議往哪個方向」,不會讓流程變成自動改字。
//
// 格式:JSONL,一行一個例子(方便 append、diff 友善):
//   { "before": "原句", "after": "改後(可空=這句該刪)", "rule": "grandiose", "note": "為什麼" }
//   - before:作者原本寫的、或 AI 產的句子
//   - after :作者改成的樣子(空字串代表「這句整句刪掉」)
//   - rule  :對應 style-lint 的規則 id(colon-parallel / triple-parallel / grandiose / repeated-buzzword),選填
//   - note  :一句話說明,選填
//
// 現在只提供讀取 + 組 few-shot 文字;真正把它接進 LLM 偵測器是下一步(見 plan 的「後續」)。

import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const EXAMPLES_PATH = resolve(here, 'examples', 'style-rewrites.jsonl');

// 讀例子庫。壞行略過(容錯),回傳乾淨的例子陣列。
export function loadExamples(path = EXAMPLES_PATH) {
  if (!existsSync(path)) return [];
  const out = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('//')) continue;
    try {
      const o = JSON.parse(t);
      if (o && typeof o.before === 'string') {
        out.push({ before: o.before, after: typeof o.after === 'string' ? o.after : '', rule: o.rule || '', note: o.note || '' });
      }
    } catch {
      /* 壞行略過 */
    }
  }
  return out;
}

// append 一筆(作者接受某個建議、或手動修掉某句後,可呼叫這支把它記下來)。
export function recordExample(example, path = EXAMPLES_PATH) {
  const o = { before: String(example.before || ''), after: String(example.after || ''), rule: example.rule || '', note: example.note || '' };
  appendFileSync(path, JSON.stringify(o) + '\n');
  return o;
}

// 把例子組成 few-shot 文字,給之後的 LLM 偵測器當 prompt 的一部分。
// rule 有給就只取同規則的例子;limit 控制筆數(few-shot 不用多)。
export function buildFewShot(examples, { rule = '', limit = 8 } = {}) {
  const picked = (rule ? examples.filter((e) => e.rule === rule) : examples).slice(0, limit);
  if (!picked.length) return '';
  const lines = ['這位作者過去的「原句 → 改後」偏好(學這個方向,不要照抄):'];
  for (const e of picked) {
    lines.push(`- 原句:${e.before}`);
    lines.push(`  改後:${e.after || '(刪掉)'}${e.note ? `(${e.note})` : ''}`);
  }
  return lines.join('\n');
}
