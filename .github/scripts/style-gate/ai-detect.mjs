// 來源:vps-blogger/tools/style-gate/ai-detect.mjs(vendored 進 han-content 供 publish.yml 用;改功能請改 vps-blogger 那份再同步過來)。
// ai-detect.mjs — Lane B 的「AI 偵測器」,只在真的需要語意判斷的維度上場(目前:4 blockquote),
// 其餘能用程式就用程式(北極星規則)。走 NVIDIA 自家 chat API(跟 style-autofix 同一把 NVIDIA_API_KEY
// 的模式);**沒設 key 就乾淨降級成「不建議」**,不爆、不擋流程。
//
// 守 Lane B 不變量:**只回 findings、不改字、不影響 exit**;而且只建議「文章裡真的存在的句子」
// (LLM 亂編的句子定位不到 → 丟掉),避免它幻想出原文沒有的內容。
//
// 測試可注入 fetchImpl / env,不真的打網路。

import { loadExamples, buildFewShot } from './rag-examples.mjs';

const DEFAULT_URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const DEFAULT_MODEL = 'nvidia/nemotron-3.5-bolt-e4b';

function config(env = process.env) {
  return {
    apiKey: env.NVIDIA_API_KEY || '',
    url: env.NVIDIA_URL || DEFAULT_URL,
    model: env.PROMPT_MODEL || env.MODEL || DEFAULT_MODEL,
  };
}

// 有沒有 key 可以打 AI;gate 用它決定要不要印「略過」。
export function aiAvailable(env = process.env) {
  return !!config(env).apiKey;
}

// 低階:打 NVIDIA chat,回純文字 content。沒 key / 非 2xx / 例外 → 回 null(呼叫端降級)。
async function chat(messages, { env = process.env, fetchImpl } = {}) {
  const { apiKey, url, model } = config(env);
  if (!apiKey) return null;
  const doFetch = fetchImpl || fetch;
  try {
    const r = await doFetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ model, temperature: 0.2, max_tokens: 1024, messages }),
    });
    if (!r.ok) return null;
    const j = await r.json();
    return stripThink(String(j?.choices?.[0]?.message?.content || '').trim());
  } catch {
    return null;
  }
}

function stripThink(s) {
  let t = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  const m = t.match(/<\/think>/i);
  if (m) t = t.slice(m.index + m[0].length);
  return t.trim();
}

// 從 LLM 回應抽 JSON 陣列(容錯:挑第一個 [ ... ])。
function parseJsonArray(text) {
  if (!text) return null;
  const m = text.match(/\[[\s\S]*\]/);
  if (!m) return null;
  try {
    const a = JSON.parse(m[0]);
    return Array.isArray(a) ? a : null;
  } catch {
    return null;
  }
}

// 維度 4:挑「哪句值得拉成 blockquote 強調」。回 findings(suggest-only)。沒 key / 失敗 → []。
export async function detectBlockquote(markdown, opts = {}) {
  const examples = opts.examples || loadExamples();
  const fewShot = buildFewShot(examples, { rule: 'blockquote', limit: 6 }); // 作者過去把哪種句子做引用
  const sys = [
    '你是中文部落格的「編輯建議助手」。只建議、不改字。',
    '任務:從文章裡挑出「最值得拉成 blockquote(引用)來強調」的 1~3 句關鍵句(作者的核心主張/提醒/金句)。',
    '只挑真的有重量的句子;沒有就回空陣列 []。挑出的句子必須是原文裡**逐字存在**的句子。',
    '嚴格只輸出 JSON 陣列,每項 { "sentence": "原句逐字", "why": "為什麼值得強調(≤20字)" },不要任何多餘說明。',
    fewShot,
  ].filter(Boolean).join('\n');

  const content = await chat([{ role: 'system', content: sys }, { role: 'user', content: markdown }], opts);
  const arr = parseJsonArray(content);
  if (!arr) return []; // 沒 key、呼叫失敗、或格式壞 → 乾淨降級成「不建議」

  const findings = [];
  for (const it of arr) {
    const s = typeof it?.sentence === 'string' ? it.sentence.trim() : '';
    if (!s) continue;
    const probe = s.slice(0, Math.min(s.length, 12));
    const idx = markdown.indexOf(probe);
    if (idx < 0) continue; // 原文找不到 → 可能是 LLM 幻想,丟掉
    const line = markdown.slice(0, idx).split('\n').length;
    const why = typeof it?.why === 'string' ? it.why.trim() : '';
    findings.push({
      rule: 'blockquote', line, column: 1,
      snippet: s.length > 40 ? s.slice(0, 40) + '…' : s,
      message: `這句或許值得拉成 blockquote 強調${why ? `(${why})` : ''}。`,
      suggestion: '若認同,可把它獨立成一段、前面加 > 變引用;不認同就略過。',
    });
  }
  return findings;
}
