// 來源:vps-blogger/tools/style-gate/gate.mjs(vendored,改功能改那份再 npm run gate:sync 同步)。
// gate.mjs — 發文前風格把關 CLI。把兩條路串起來跑,但**分得很清楚**(見 docs/style-gate-plan.md):
//
//   Lane A(定得出不變量 → 自動 / 擋下):
//     · terms   大陸→台灣用詞:deterministic 替換。預設只報告;--apply 才寫回檔案。
//     · punct   CJK 之間的半形 ,/. → 全形:deterministic。預設只報告;--apply 才寫回。
//     · secrets 真實金鑰值:fail-closed,偵測到就 exit 2、不改任何字。
//   Lane B(定不出不變量 → 只建議、人點頭):
//     · lint    疑似 AI 腔(排比/對仗/浮誇/流行詞反覆/絕對口吻/段落過長/括弧全半形):確定性,只列建議。
//     · ai      需語意判斷的(blockquote 強調):--ai 才開、要 AUTOFIX_WORKER_URL + AUTOFIX_SECRET
//               (打 Worker /lint,key 留 Cloudflare),沒設乾淨略過。只建議。
//   Lane B 永遠只列建議,絕不改字、絕不影響 exit。
//
// 用法:
//   node tools/style-gate/gate.mjs <檔案...>            # 報告模式(不改檔)
//   node tools/style-gate/gate.mjs --apply <檔案...>    # 套用 Lane A terms(寫回檔案)
//   node tools/style-gate/gate.mjs --check <檔案...>    # CI 用:terms 有待換就 exit 3、secrets block exit 2
//   旗標:--only=terms,punct,secrets,lint  --ai(開 AI blockquote 偵測)  --names  --json
//
// 沒給檔案時,預設掃 src/content/drafts 與 src/content/posts 的 *.md(本機預覽內容)。
//
// exit code:2 = 偵測到真實金鑰(fail-closed,最優先);3 = --check 下 terms 還有待換;0 = 其餘。
// Lane B(lint)永遠不影響 exit——它是建議,不是門檻。

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { applyTwTerms } from './zh-tw-terms.mjs';
import { applyFullwidthPunct } from './fullwidth-punct.mjs';
import { scanSecrets } from './secret-scan.mjs';
import { lintStyle, RULE_LABELS } from './style-lint.mjs';
import { detectBlockquote, aiAvailable } from './ai-detect.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const IN_GHA = !!process.env.GITHUB_ACTIONS;

function parseArgs(argv) {
  const opts = { apply: false, check: false, json: false, names: false, ai: false, only: null, files: [] };
  for (const a of argv) {
    if (a === '--apply') opts.apply = true;
    else if (a === '--check') opts.check = true;
    else if (a === '--json') opts.json = true;
    else if (a === '--names') opts.names = true;
    else if (a === '--ai') opts.ai = true;
    else if (a.startsWith('--only=')) opts.only = new Set(a.slice(7).split(',').map((s) => s.trim()).filter(Boolean));
    else if (a.startsWith('--')) { /* 忽略未知旗標 */ }
    else opts.files.push(a);
  }
  return opts;
}

function defaultFiles() {
  const dirs = [join(repoRoot, 'src', 'content', 'drafts'), join(repoRoot, 'src', 'content', 'posts')];
  const files = [];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) if (f.toLowerCase().endsWith('.md')) files.push(join(d, f));
  }
  return files;
}

function isIsoPage(md) {
  return /^\s*isoPage:\s*true\s*$/m.test(md);
}

const want = (opts, lane) => !opts.only || opts.only.has(lane);
const rel = (f) => relative(repoRoot, f).replace(/\\/g, '/');

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const files = (opts.files.length ? opts.files : defaultFiles()).filter((f) => existsSync(f));

  const report = { terms: [], punct: [], secrets: [], lint: [], ai: [] };
  // --ai 開了但沒 key:乾淨略過(不爆),印一行提醒。
  const aiOn = opts.ai && aiAvailable();
  if (opts.ai && !aiOn) console.log('[style-gate] --ai 已開,但未設 AUTOFIX_WORKER_URL / AUTOFIX_SECRET,AI 偵測略過(只跑確定性規則)。\n');
  let termsPending = 0;
  let secretBlocks = 0;

  for (const f of files) {
    let md = readFileSync(f, 'utf8');
    const iso = isIsoPage(md);

    // Lane A② secrets:掃所有檔(含 isoPage);fail-closed,不改字。
    if (want(opts, 'secrets')) {
      const findings = scanSecrets(md, { includeNames: opts.names });
      if (findings.length) report.secrets.push({ file: f, findings });
      secretBlocks += findings.filter((x) => x.severity === 'block').length;
    }

    // Lane A 的兩條 deterministic 文字轉換(用詞、1a 標點):都略過 isoPage;在記憶體裡接著跑,
    // 最後只寫一次檔(避免同一檔 --apply 寫兩遍)。
    let dirty = false;
    if (want(opts, 'terms') && !iso) {
      const { text, changes } = applyTwTerms(md);
      if (changes.length) {
        report.terms.push({ file: f, changes });
        termsPending += changes.reduce((n, c) => n + c.count, 0);
        if (opts.apply) { md = text; dirty = true; }
      }
    }
    if (want(opts, 'punct') && !iso) {
      const { text, changes } = applyFullwidthPunct(md);
      if (changes.length) {
        report.punct.push({ file: f, changes });
        termsPending += changes.reduce((n, c) => n + c.count, 0);
        if (opts.apply) { md = text; dirty = true; }
      }
    }
    if (dirty) writeFileSync(f, md);

    // Lane B lint:只建議,不改字,略過 isoPage。
    if (want(opts, 'lint') && !iso) {
      const findings = lintStyle(md);
      if (findings.length) report.lint.push({ file: f, findings });
    }

    // Lane B AI(4 blockquote):opt-in、需 key,只建議不改字。沒 key 這段根本不會進來。
    if (aiOn && !iso) {
      const findings = await detectBlockquote(md);
      if (findings.length) report.ai.push({ file: f, findings });
    }
  }

  if (opts.json) {
    console.log(JSON.stringify({ files: files.map(rel), ...report, secretBlocks, termsPending }, null, 2));
  } else {
    printHuman(report, opts, files.length);
  }
  if (IN_GHA) emitAnnotations(report);

  // exit:fail-closed 金鑰最優先,再來是 --check 的 terms。
  if (secretBlocks > 0) process.exit(2);
  if (opts.check && !opts.apply && termsPending > 0) process.exit(3);
  process.exit(0);
}

function printHuman(report, opts, nFiles) {
  console.log(`[style-gate] 掃了 ${nFiles} 篇\n`);

  // Lane A② secrets(fail-closed)
  if (want(opts, 'secrets')) {
    const blocks = report.secrets.flatMap((r) => r.findings.filter((x) => x.severity === 'block').map((x) => ({ ...x, file: r.file })));
    if (blocks.length) {
      console.log(`🚫 Lane A/金鑰:偵測到 ${blocks.length} 處真實金鑰值,擋下送出(不會自動刪,請你處理):`);
      for (const x of blocks) console.log(`   ✗ ${rel(x.file)}:${x.line} — ${x.label} ${x.match}`);
      console.log('   → 請移除金鑰、更換該把 key,再送出。\n');
    }
    const soft = report.secrets.flatMap((r) => r.findings.filter((x) => x.severity !== 'block').map((x) => ({ ...x, file: r.file })));
    if (soft.length) {
      console.log(`⚠️  Lane A/金鑰(提醒,不擋):`);
      for (const x of soft) console.log(`   · ${rel(x.file)}:${x.line} — ${x.label}(${x.severity})`);
      console.log('');
    }
    if (!blocks.length && !soft.length) console.log('✓ Lane A/金鑰:沒掃到金鑰值。\n');
  }

  // Lane A① terms(deterministic 自動)
  if (want(opts, 'terms')) {
    if (report.terms.length) {
      console.log(`${opts.apply ? '🔧' : '📝'} Lane A/用詞:${opts.apply ? '已換' : '可換'}大陸→台灣用詞:`);
      for (const { file, changes } of report.terms) {
        console.log(`   ${rel(file)}`);
        for (const c of changes) console.log(`      ${c.from} → ${c.to} ×${c.count}`);
      }
      if (!opts.apply) console.log('   → 加 --apply 直接套用(只動白名單詞,其他不碰)。');
      console.log('');
    } else {
      console.log('✓ Lane A/用詞:沒有需要替換的大陸用詞。\n');
    }
  }

  // Lane A「1a」punct(deterministic 自動)
  if (want(opts, 'punct')) {
    if (report.punct.length) {
      console.log(`${opts.apply ? '🔧' : '📝'} Lane A/標點:${opts.apply ? '已換' : '可換'} CJK 之間的半形 ,/. → 全形:`);
      for (const { file, changes } of report.punct) {
        console.log(`   ${rel(file)}`);
        for (const c of changes) console.log(`      ${c.from} → ${c.to} ×${c.count}`);
      }
      if (!opts.apply) console.log('   → 加 --apply 直接套用(只動夾在兩個 CJK 之間的 ,/.)。');
      console.log('');
    } else {
      console.log('✓ Lane A/標點:沒有需要正規化的半形標點。\n');
    }
  }

  // Lane B lint(只建議)
  if (want(opts, 'lint')) {
    if (report.lint.length) {
      console.log('💡 Lane B/建議(只列出來,不會自動改,由你決定要不要改):');
      for (const { file, findings } of report.lint) {
        console.log(`   ${rel(file)}`);
        for (const x of findings) {
          console.log(`      [${RULE_LABELS[x.rule] || x.rule}] 第 ${x.line} 行:${x.snippet}`);
          console.log(`         ${x.message} 建議:${x.suggestion}`);
        }
      }
      console.log('');
    } else {
      console.log('✓ Lane B/建議:沒抓到明顯的 AI 腔。\n');
    }
  }

  // Lane B AI(blockquote,opt-in):只建議
  if (report.ai.length) {
    console.log('🤖 Lane B/AI 建議(哪句值得拉引用,只建議不改字):');
    for (const { file, findings } of report.ai) {
      console.log(`   ${rel(file)}`);
      for (const x of findings) {
        console.log(`      [${RULE_LABELS[x.rule] || x.rule}] 第 ${x.line} 行:${x.snippet}`);
        console.log(`         ${x.message} 建議:${x.suggestion}`);
      }
    }
    console.log('');
  }
}

function emitAnnotations(report) {
  for (const { file, findings } of report.secrets) {
    for (const x of findings) {
      const lvl = x.severity === 'block' ? 'error' : 'warning';
      console.log(`::${lvl} file=${rel(file)},line=${x.line}::[金鑰] ${x.label} — ${x.message}`);
    }
  }
  for (const group of [report.lint, report.ai]) {
    for (const { file, findings } of group) {
      for (const x of findings) {
        console.log(`::notice file=${rel(file)},line=${x.line}::[建議/${RULE_LABELS[x.rule] || x.rule}] ${x.message} 建議:${x.suggestion}`);
      }
    }
  }
}

main().catch((err) => { console.error(`[style-gate] FATAL: ${err.stack || err.message}`); process.exit(1); });
