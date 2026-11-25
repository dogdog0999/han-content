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
      console.log(`失敗(HTTP ${res.status}),保留原文:${f}`);
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
  }
}
console.log(`共校正 ${fixed} 篇。`);
out(fixed);
