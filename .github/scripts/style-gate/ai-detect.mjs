// 來源:vps-blogger/tools/style-gate/ai-detect.mjs(vendored,改功能改那份再 npm run gate:sync 同步)。
// ai-detect.mjs — Lane B「AI 偵測器」的 client。**自己不打 NVIDIA**,改打 han-blog-style-autofix
// Worker 的 `POST /lint`(suggest-only route)——這樣 NVIDIA key 留在 Cloudflare、不進 CI。
//
// 契約(跟 Worker 對齊):req { markdown, fewShot } → res { findings:[{rule,line,column,snippet,
// message,suggestion}] },**永不回改寫後文字**。
//
// 降級:沒設 AUTOFIX_WORKER_URL / AUTOFIX_SECRET → 回 [](gate 就只跑確定性 heuristic,不花額度)。
// 任何非 2xx / 例外 / 壞格式 → 一樣回 [],不爆、不擋流程。
// 守 Lane B 不變量:只回 findings、不改字;並順手丟掉「原文裡找不到」的 snippet(防 LLM 幻想)。
//
// 測試可注入 fetchImpl / env,不真的打網路。

import { loadExamples, buildFewShot } from './rag-examples.mjs';

function config(env = process.env) {
  return { url: env.AUTOFIX_WORKER_URL || '', secret: env.AUTOFIX_SECRET || '' };
}

// 有沒有設 Worker URL + secret 可以打 /lint;gate 用它決定要不要印「略過」。
export function aiAvailable(env = process.env) {
  const c = config(env);
  return !!(c.url && c.secret);
}

// 維度 4:挑「哪句值得拉成 blockquote」。回 findings(suggest-only)。沒設 / 失敗 → []。
export async function detectBlockquote(markdown, opts = {}) {
  const env = opts.env || process.env;
  const { url, secret } = config(env);
  if (!url || !secret) return [];

  const examples = opts.examples || loadExamples();
  const fewShot = buildFewShot(examples, { rule: 'blockquote', limit: 6 }); // 作者過去把哪種句子做引用
  const doFetch = opts.fetchImpl || fetch;

  let data;
  try {
    const r = await doFetch(url.replace(/\/+$/, '') + '/lint', {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ markdown, fewShot }),
    });
    if (!r.ok) return [];
    data = await r.json();
  } catch {
    return [];
  }

  const raw = Array.isArray(data?.findings) ? data.findings : [];
  return raw
    .filter((f) => f && typeof f === 'object' && !('markdown' in f) && !('text' in f) && !('fixed' in f)) // 守 suggest-only
    // 要有「原文裡定位得到」的非空 snippet 才留:丟 LLM 幻想句,也丟掉空/缺 snippet 的雜訊建議
    .filter((f) => typeof f.snippet === 'string' && f.snippet.trim() !== '' && markdown.includes(f.snippet.replace(/…$/, '').slice(0, 10)))
    .map((f) => ({
      rule: f.rule || 'blockquote',
      line: Number.isFinite(f.line) ? f.line : 1,
      column: Number.isFinite(f.column) ? f.column : 1,
      snippet: String(f.snippet || ''),
      message: String(f.message || '這句或許值得拉成 blockquote 強調。'),
      suggestion: String(f.suggestion || '若認同,可把它獨立成一段、前面加 > 變引用。'),
    }));
}
