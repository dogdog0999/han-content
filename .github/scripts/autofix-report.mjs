// publish.yml ① 失敗時用:把 autofix.mjs 寫出的失敗清單,在 GitHub 開成 Issue,
// 讓你一眼知道「哪篇文章、為什麼失敗、去哪裡看」,每篇都附捷徑連結。
// 已有未關閉、帶 autofix-failure 標籤的 Issue 時,改在那張 Issue 留言,不重複開新的。
//
// 用法:node .github/scripts/autofix-report.mjs <失敗清單 JSON>
// 環境變數:GITHUB_TOKEN(workflow 內建,需 issues: write)、GITHUB_REPOSITORY、GITHUB_SHA、
//          GITHUB_RUN_ID、GITHUB_SERVER_URL(Actions 都會給);DRY_RUN=1 只印出內容、不呼叫 API。
import { readFileSync, existsSync, appendFileSync } from 'node:fs';

const NL = String.fromCharCode(10);
const [file] = process.argv.slice(2);
const dry = process.env.DRY_RUN === '1';
const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY || 'dogdog0999/han-content';
const sha = process.env.GITHUB_SHA || '';
const runId = process.env.GITHUB_RUN_ID || '';
const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
const site = process.env.SITE_URL || 'https://han-bloger-page.duckdns.org/bloger';
const branch = 'main';
const LABEL = 'autofix-failure';

if (!file || !existsSync(file)) {
  console.log('沒有失敗清單,不開 Issue。');
  process.exit(0);
}
const items = JSON.parse(readFileSync(file, 'utf8'));
if (!Array.isArray(items) || !items.length) {
  console.log('失敗清單是空的,不開 Issue。');
  process.exit(0);
}
if (!dry && !token) {
  console.log('沒有 GITHUB_TOKEN,無法開 Issue。');
  process.exit(1);
}

const enc = (p) => p.split('/').map(encodeURIComponent).join('/');
const cell = (t) => String(t).split('|').join('/').split(NL).join(' ');
const short = sha.slice(0, 7);
const repoUrl = `${server}/${repo}`;
const runUrl = runId ? `${repoUrl}/actions/runs/${runId}` : `${repoUrl}/actions`;

async function gh(method, path, body) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'han-content-autofix-report',
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

// 「① 結構校正」那一步的 log 連結(直接跳到該步驟)
let logUrl = runUrl;
if (!dry && runId) {
  const r = await gh('GET', `/repos/${repo}/actions/runs/${runId}/jobs`);
  const job = r.ok ? r.data?.jobs?.[0] : null;
  const step = job?.steps?.find((s) => s.name.startsWith('① 結構校正'));
  if (job?.html_url) logUrl = step ? `${job.html_url}#step:${step.number}:1` : job.html_url;
}

const rows = items.map(({ path, reason }) => {
  const slug = (path.startsWith('posts/') ? path.slice(6) : path).replace(/[.]md$/, '');
  const links = [
    `[檔案](${repoUrl}/blob/${sha || branch}/${enc(path)})`,
    `[編輯](${repoUrl}/edit/${branch}/${enc(path)})`,
    `[修改歷史](${repoUrl}/commits/${branch}/${enc(path)})`,
    `[線上頁面](${site}/posts/${enc(slug)}/)`,
  ].join(' · ');
  return `| \`${cell(path)}\` | ${cell(reason)} | ${links} |`;
});

const body = [
  `## style-autofix 校正失敗(${items.length} 篇)`,
  '',
  '這次 push 的結構校正有文章沒成功。**這些文章保留原文、沒被改動,也已照常上線**,只是沒套用 AI 的結構整理。',
  '',
  '| 文章 | 失敗原因 | 捷徑 |',
  '|---|---|---|',
  ...rows,
  '',
  '### 去哪裡看',
  `- 失敗的步驟 log(直接跳到「① 結構校正」):${logUrl}`,
  `- 這次 Publish run:${runUrl}`,
  sha ? `- 觸發的 commit:${repoUrl}/commit/${sha}` : '',
  '',
  '### 常見原因與處理',
  '- **HTTP 401 / 403**:GitHub secret `AUTOFIX_SECRET` 和 Cloudflare Worker `han-blog-style-autofix` 上的 `AUTOFIX_SECRET` 不一致(或其中一邊多了空白、換行)。',
  '- **呼叫失敗 / fetch failed**:`AUTOFIX_WORKER_URL` 錯誤,或 Worker 暫時連不上。',
  '- 修好之後,到上面的 Publish run 按 **Re-run jobs**,或重新 push 該篇文章即可重新校正。',
  '',
  '_此 Issue 由 `.github/scripts/autofix-report.mjs` 自動建立。_',
].filter((l) => l !== null).join(NL);

const title = `style-autofix 校正失敗:${items.length} 篇(${short || 'unknown'})`;

if (dry) {
  console.log(`[DRY_RUN] 標題:${title}${NL}${NL}${body}`);
  process.exit(0);
}

// 已有未關閉的 autofix-failure Issue → 留言;否則建立新的。
const open = await gh('GET', `/repos/${repo}/issues?labels=${LABEL}&state=open&per_page=1`);
const existing = open.ok && Array.isArray(open.data) ? open.data.find((i) => !i.pull_request) : null;

let url;
if (existing) {
  const r = await gh('POST', `/repos/${repo}/issues/${existing.number}/comments`, { body: `### ${title}${NL}${NL}${body}` });
  if (!r.ok) { console.log(`留言失敗(HTTP ${r.status}):${JSON.stringify(r.data)}`); process.exit(1); }
  url = existing.html_url;
  console.log(`已在既有 Issue 留言:${url}`);
} else {
  await gh('POST', `/repos/${repo}/labels`, { name: LABEL, color: 'B60205', description: 'style-autofix 校正失敗' }); // 已存在會回 422,忽略
  const r = await gh('POST', `/repos/${repo}/issues`, { title, body, labels: [LABEL] });
  if (!r.ok) { console.log(`開 Issue 失敗(HTTP ${r.status}):${JSON.stringify(r.data)}`); process.exit(1); }
  url = r.data.html_url;
  console.log(`已建立 Issue:${url}`);
}

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `> 失敗已記錄到 Issue:${url}${NL}`);
}
