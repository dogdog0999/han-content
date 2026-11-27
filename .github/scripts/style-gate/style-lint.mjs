// 來源:vps-blogger/tools/style-gate/style-lint.mjs(vendored,改功能改那份再 npm run gate:sync 同步)。
// style-lint.mjs — Lane B:AI 腔「送出前 lint」。**只列建議、絕不改字。**
//
// 為什麼只建議不自動改(見 .claude/skills/safe-ai-autofix):少排比、少對仗、結尾不浮誇
// 這幾條,要動的正是「文字與語氣」——定不出「怎麼改都不准破壞」的 deterministic 不變量,
// 所以不能靜默自動改。這支把疑點**列出來**,配一句建議方向,由作者一鍵接受或略過。
//
// 這裡的偵測器是**確定性 heuristic**(雛形,能跑、零依賴、不打 LLM)。之後可用 RAG few-shot
// (rag-examples.mjs:作者歷次「原句→改後」)餵給 LLM 偵測器,提升建議準度——那是**下一步**,
// 而且它優化的是「建議準不準」,不是「亂改的權力」:輸出永遠還是建議,不是改好的文字。
//
// Zero dependencies. 每筆 finding:{ rule, line, column, snippet, message, suggestion }

// 把 Markdown 拆成「可檢查的散文行」:略過 frontmatter、程式碼圍欄、純 HTML/圖片行。
function proseLines(md) {
  const lines = String(md).split('\n');
  const out = [];
  let fence = false;
  let inFrontmatter = false;
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (i === 0 && line.trim() === '---') { inFrontmatter = true; return; }
    if (inFrontmatter) { if (line.trim() === '---') inFrontmatter = false; return; }
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return; }
    if (fence) return;
    const bare = line.replace(/`[^`]*`/g, '').trim();
    if (!bare) return;
    if (/^<[^>]+>$/.test(bare) || /^!\[/.test(bare)) return; // 整行是 HTML/圖片
    out.push({ no: i + 1, text: line });
  });
  return out;
}

// 把散文依空行切成「段落」:連續非空散文行併成一塊,空行/圍欄/整行 HTML 斷開。
// 回傳 [{ no, text }](no = 段落起始行)。給「段落過長」用。
function proseBlocks(md) {
  const lines = String(md).split('\n');
  const blocks = [];
  let cur = null;
  let fence = false;
  let fm = false;
  const flush = () => { if (cur) { blocks.push(cur); cur = null; } };
  lines.forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (i === 0 && line.trim() === '---') { fm = true; return; }
    if (fm) { if (line.trim() === '---') fm = false; return; }
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; flush(); return; }
    if (fence) return;
    if (line.trim() === '') { flush(); return; }
    const bare = line.replace(/`[^`]*`/g, '').trim();
    if (/^<[^>]+>$/.test(bare) || /^!\[/.test(bare)) { flush(); return; }
    if (!cur) cur = { no: i + 1, text: line };
    else cur.text += '\n' + line;
  });
  flush();
  return blocks;
}

// 把一行切成句子(中文標點)。回傳 [{ s, offset }]。
function sentences(line) {
  const res = [];
  let buf = '';
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    buf += line[i];
    if ('。!?!?;;'.includes(line[i])) {
      res.push({ s: buf, offset: start });
      buf = '';
      start = i + 1;
    }
  }
  if (buf.trim()) res.push({ s: buf, offset: start });
  return res;
}

// --- 規則 -------------------------------------------------------------------

// R1 冒號 + 對仗列舉:「……:A、B、C」這種工整排比(CLAUDE.md 點名的 AI 腔)。
function ruleColonParallel(line, no, push) {
  const m = /[:：]\s*([^。!?!?\n]*?(?:[、,][^。!?!?\n、,]+){2,})/.exec(line);
  if (m) {
    push({
      rule: 'colon-parallel', line: no, column: m.index + 1, snippet: clip(m[0]),
      message: '冒號後接三項以上對仗列舉,讀起來像 AI 的工整排比。',
      suggestion: '改寫成散文句,或把列舉拆進不同句子、減少項數。',
    });
  }
}

// R2 三段式排比:同一句裡三個結構相近、長度相近的短分句(以、或,分隔)。
function ruleTripleParallel(sentence, no, col, push) {
  const parts = sentence.split(/[,,、]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const lens = parts.map((p) => p.length);
    const min = Math.min(...lens);
    const max = Math.max(...lens);
    const allCjk = parts.every((p) => /[一-鿿]/.test(p)); // 避免誤抓英文/專有名詞清單
    // 三項以上、全中文、每項 2~12 字、長度相近(最長不超過最短的 2 倍)→ 疑似排比
    if (allCjk && min >= 2 && max <= 12 && max <= min * 2) {
      push({
        rule: 'triple-parallel', line: no, column: col + 1, snippet: clip(sentence),
        message: '一句裡三個以上長度相近的對仗分句,排比味重。',
        suggestion: '留最有力的一兩項,其餘拆成散句或刪掉。',
      });
    }
  }
}

// R3 浮誇結尾:文章最後一兩段若出現這些句型,提醒收平淡一點。
const GRANDIOSE = [
  /我(真正|最)(滿意|喜歡|在意|驕傲|得意)的(其實)?是/,
  /讓我(?:最)?(?:感到|覺得)?[^。!?\n]*的,?其實是/,
  /不僅[^。!?\n]*,?(更|還)[^。!?\n]*/,
  /這(就)?是[^。!?\n]*的(意義|價值|美好|浪漫)/,
  /[^。!?\n]{0,8}愈[^。!?\n]{0,4}愈[^。!?\n]{0,4}好/, // 口號式「X 愈 Y 愈好」
];
function ruleGrandioseEnding(sentence, no, col, isTail, push) {
  for (const re of GRANDIOSE) {
    if (re.test(sentence)) {
      push({
        rule: 'grandiose', line: no, column: col + 1, snippet: clip(sentence),
        message: isTail ? '結尾句偏浮誇/口號,和作者「平淡收尾」的調性不合。' : '句子偏浮誇或像口號。',
        suggestion: '收平淡一點(例:「先這樣,之後想到再補」)。',
      });
      return;
    }
  }
}

// R5 絕對性口吻:偵測把話說死的詞,**軟性**提醒留彈性(不斷定、不自動改)。
// 精準度優先(recall 高 precision 低,寧可漏不要吵):刻意避開正常語境的同形詞——
//   · 「一定程度/一定的風險…」是「某種程度」、「不一定」是反而留彈性 → 不算;只有「一定要/一定會…」這種斷定才算。
//   · 單純「只有他知道」是陳述 → 不算;只有「只有…才…」這種排他勸說式才算。
//   · 丟掉「所有/每一個/任何時候」這類量詞(多半是正常陳述,太吵)。
const ABSOLUTE_STRONG = /(永遠|從來|絕對|必定|毫無|無一例外|百分之百|一律|總是|永不|鐵定)/; // 拿掉「完全」(完全同意/完全不同 多半正常語)
const ABSOLUTE_YIDING = /(?<!不)一定(?!程度|的|比例|數量|範圍|條件|水準|基礎|風險|幫助)/; // 斷定的「一定」,排除「某種程度」與「不一定」
const ABSOLUTE_ZHIYOU = /只有[^。!?,，\n]{1,20}才/;                                      // 「只有…才…」排他勸說
function ruleAbsoluteTone(sentence, no, col, push) {
  let m = ABSOLUTE_STRONG.exec(sentence);
  let word = m && m[1];
  if (!m) { m = ABSOLUTE_YIDING.exec(sentence); word = m && '一定'; }
  if (!m) { m = ABSOLUTE_ZHIYOU.exec(sentence); word = m && '只有…才'; }
  if (m) {
    push({
      rule: 'absolute-tone', line: no, column: col + m.index + 1, snippet: clip(sentence),
      message: `這裡語氣偏絕對(出現「${word}」),看要不要留點彈性。`,
      suggestion: '若不是真的百分百,可換成留餘地的說法(通常/多半/幾乎/大多)。',
    });
  }
}

// R7(1b) 全形括弧 heuristic(deterministic,不燒 AI):純中文內容用半形 () → 建議全形;
// 純英文/數字內容用全形（）→ 建議半形。中英混排是 ambiguous,留白、不在這裡斷定。只建議、不改字。
function ruleParenWidth(line, no, push) {
  // 把被保護的區段(行內 code / 標籤 / 連結 URL)換成等長空白,保留欄位、避免誤判
  const clean = line
    .replace(/`[^`]*`/g, (m) => ' '.repeat(m.length))
    .replace(/<[^>]+>/g, (m) => ' '.repeat(m.length))
    .replace(/\]\([^)]*\)/g, (m) => ' '.repeat(m.length));
  let m;
  const half = /\(([^()]{1,30})\)/g;
  while ((m = half.exec(clean))) {
    const inner = m[1];
    if (/[一-鿿]/.test(inner) && !/[A-Za-z]/.test(inner)) {
      push({
        rule: 'paren-width', line: no, column: m.index + 1, snippet: clip('(' + inner + ')'),
        message: '括弧內是中文,半形 () 夾在中文裡偏突兀。',
        suggestion: '考慮改用全形（）。',
      });
    }
  }
  let m2;
  const full = /（([^（）]{1,30})）/g;
  while ((m2 = full.exec(clean))) {
    const inner = m2[1];
    if (!/[一-鿿]/.test(inner) && /[A-Za-z0-9]/.test(inner)) {
      push({
        rule: 'paren-width', line: no, column: m2.index + 1, snippet: clip('（' + inner + '）'),
        message: '括弧內是英文/數字,全形（）會很突兀(作者點的反例)。',
        suggestion: '考慮改用半形 ()。',
      });
    }
  }
}

// R6 段落過長:整段中文字太多或句數太多 → 提醒切開留喘息空間(只建議,不替你切)。
function ruleLongParagraph(block, push) {
  const cjk = (block.text.match(/[一-鿿]/g) || []).length;
  const sents = (block.text.match(/[。!?!?]/g) || []).length;
  if (cjk >= 140 || sents >= 6) {
    push({
      rule: 'long-paragraph', line: block.no, column: 1, snippet: clip(block.text),
      message: `這段偏長(約 ${cjk} 個中文字${sents ? `、${sents} 句` : ''}),一口氣讀下來比較喘。`,
      suggestion: '考慮切成幾段,或把關鍵句獨立成一段(留喘息空間)。',
    });
  }
}

// R4 流行詞反覆:同一個 2~4 字內容詞在全文出現 ≥ 4 次(CLAUDE.md 的「摩擦」案例)。
const STOPWORDS = new Set([
  '這個', '那個', '一個', '可以', '因為', '所以', '但是', '就是', '我們', '自己', '什麼',
  '沒有', '還是', '不是', '這樣', '這些', '那些', '然後', '其實', '已經', '一樣', '這裡',
  '時候', '問題', '方式', '東西', '出來', '起來', '一下', '需要', '應該', '可能', '知道',
]);
function ruleRepeatedBuzzword(md, push) {
  // 只在散文行內統計 2~3 字候選詞,並記下每個詞第一次出現的行號。
  // 用「重疊」n-gram:不管斷詞對齊到哪,2 字的流行詞(像「摩擦」)都數得到。
  const freq = Object.create(null);
  const firstLine = Object.create(null);
  const lineMap = proseLines(md);
  for (const { no, text: lt } of lineMap) {
    for (const run of lt.match(/[一-鿿]+/g) || []) {
      for (let n = 2; n <= 3; n++) {
        for (let i = 0; i + n <= run.length; i++) {
          const g = run.slice(i, i + n);
          freq[g] = (freq[g] || 0) + 1;
          if (!(g in firstLine)) firstLine[g] = no;
        }
      }
    }
  }
  const flagged = Object.keys(freq)
    .filter((g) => g.length >= 2 && !STOPWORDS.has(g) && freq[g] >= 4)
    // 去掉「被更長高頻詞包住」的噪音(例:若「摩擦力」很多,就不另報「摩擦」)
    .filter((g) => !Object.keys(freq).some((h) => h !== g && h.includes(g) && freq[h] >= freq[g]))
    .sort((a, b) => freq[b] - freq[a]);
  for (const g of flagged) {
    push({
      rule: 'repeated-buzzword', line: firstLine[g], column: 1, snippet: g,
      message: `「${g}」在全文出現 ${freq[g]} 次,反覆用同一個詞會顯得像口頭禪。`,
      suggestion: '換幾個說法,或刪掉幾處。',
    });
  }
}

function clip(s) {
  const t = s.trim();
  return t.length > 40 ? t.slice(0, 40) + '…' : t;
}

// 主入口:回傳 findings(只建議、不改字)。opts.tailParagraphs:把最後 N 段視為「結尾」(預設 2)。
export function lintStyle(md, opts = {}) {
  const findings = [];
  const push = (f) => findings.push(f);
  const lines = proseLines(md);
  const tailFrom = lines.length - (opts.tailParagraphs ?? 2);

  lines.forEach((l, idx) => {
    ruleColonParallel(l.text, l.no, push);
    const isTail = idx >= tailFrom;
    for (const { s, offset } of sentences(l.text)) {
      ruleTripleParallel(s, l.no, offset, push);
      ruleGrandioseEnding(s, l.no, offset, isTail, push);
      ruleAbsoluteTone(s, l.no, offset, push);
    }
    ruleParenWidth(l.text, l.no, push);
  });
  for (const block of proseBlocks(md)) ruleLongParagraph(block, push);
  ruleRepeatedBuzzword(md, push);

  // 穩定排序:先行號、再欄位
  findings.sort((a, b) => a.line - b.line || a.column - b.column);
  return findings;
}

export const RULE_LABELS = {
  'colon-parallel': '冒號對仗列舉',
  'triple-parallel': '三段式排比',
  grandiose: '浮誇/口號',
  'repeated-buzzword': '流行詞反覆',
  'absolute-tone': '絕對口吻',
  'long-paragraph': '段落過長',
  'paren-width': '括弧全半形',
  blockquote: '引用強調',
};
