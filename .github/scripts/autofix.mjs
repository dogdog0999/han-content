// publish.yml ① 用:對「這次 push 改動的文章」逐篇呼叫 style-autofix Worker,
// 有變動(changed)就把校正後的 Markdown 寫回檔案。commit 由 workflow 的下一步做。
//
// 用法:node .github/scripts/autofix.mjs <改動文章清單檔>   (一行一個路徑)
// 環境變數:WORKER_URL、AUTOFIX_SECRET(沒設就略過,不當作錯誤)
// 輸出:寫入 $GITHUB_OUTPUT 的 fixed=<被校正的篇數>
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';

const [listFile] = process.argv.slice(2);
const url = process.env.WORKER_URL;
const secret = process.env.AUTOFIX_SECRET;
const out = (n) => process.env.GITHUB_OUTPUT && appendFileSync(process.env.GITHUB_OUTPUT, `fixed=${n}\n`);

if (!url || !secret) {
  console.log('尚未設定 AUTOFIX_WORKER_URL / AUTOFIX_SECRET,略過結構校正。');
  out(0);
  process.exit(0);
}

const files = existsSync(listFile) ? readFileSync(listFile, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean) : [];
if (!files.length) {
  console.log('沒有文章變動。');
  out(0);
  process.exit(0);
}

let fixed = 0;
const failureItems = []; // {path, reason}:給 autofix-report.mjs 開 Issue 用
const failures = []; // 呼叫失敗(HTTP 錯誤或例外)的文章;有的話最後讓這一步失敗,並在 run 頁面顯示紅色註解與摘要
for (const f of files) {
  const md = readFileSync(f, 'utf8');
  if (/^\s*isoPage:\s*true\s*$/m.test(md)) {
    console.log(`略過(isoPage):${f}`);
    continue;
  }
  const title = (md.match(/^title:\s*(.*)$/m)?.[1] ?? '').replace(/^["']|["']$/g, '');
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ title, markdown: md }),
    });
    if (!res.ok) {
      const hint = res.status === 401 || res.status === 403 ? '(請檢查 AUTOFIX_SECRET 與 Worker 上的是否一致)' : '';
      console.log(`失敗(HTTP ${res.status}),保留原文:${f}`);
      console.log(`::error file=${f},title=style-autofix 失敗::HTTP ${res.status}${hint},這篇保留原文、沒有校正`);
      failures.push(`${f}(HTTP ${res.status})`);
      failureItems.push({ path: f, reason: `HTTP ${res.status}${hint}` });
      continue;
    }
    const j = await res.json();
    console.log(`${j.changed ? '校正' : '不變'}:${f} — ${j.reason}`);
    if (j.changed && typeof j.markdown === 'string' && j.markdown.trim()) {
      writeFileSync(f, j.markdown);
      fixed++;
    }
  } catch (err) {
    console.log(`呼叫失敗,保留原文:${f} — ${err.message}`);
    console.log(`::error file=${f},title=style-autofix 失敗::呼叫失敗:${err.message},這篇保留原文、沒有校正`);
    failures.push(`${f}(${err.message})`);
    failureItems.push({ path: f, reason: `呼叫失敗:${err.message}` });
  }
}
console.log(`共校正 ${fixed} 篇。`);
out(fixed);

if (failures.length) {
  // 先把成功校正的結果輸出(上面 out),再讓這一步失敗,Actions 才看得到紅色註解與摘要。
  console.log(`有 ${failures.length} 篇校正失敗,見上方錯誤註解。`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const lines = [`### ⚠️ style-autofix 有 ${failures.length} 篇校正失敗`, '', ...failures.map((x) => `- ${x}`), ''];
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join(String.fromCharCode(10)));
  }
  // 失敗清單寫成 JSON,workflow 下一步(autofix-report.mjs)會據此在 GitHub 開 Issue。
  if (process.env.AUTOFIX_FAILURES_FILE) writeFileSync(process.env.AUTOFIX_FAILURES_FILE, JSON.stringify(failureItems, null, 2));
  process.exitCode = 1;
}
