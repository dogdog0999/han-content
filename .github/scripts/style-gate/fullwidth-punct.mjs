// 來源:vps-blogger/tools/style-gate/fullwidth-punct.mjs(vendored,改功能改那份再 npm run gate:sync 同步)。
// fullwidth-punct.mjs — Lane A①b(「1a」):全形標點正規化,但**只做能守住不變量的那一塊**。
//
// 不變量:只會把「**夾在兩個 CJK 字之間**的半形 `,` 或 `.`」換成全形 `，`/`。`,其他一個字元都不動;
// 且不碰程式碼(fenced / 行內 `code`)與 HTML 標籤(`<...>`)。
//
// 為什麼這塊能 deterministic 自動(見 docs/style-gate-plan.md 的「追加維度評估」):
// 「夾在兩個 CJK 之間」這條邊界天生乾淨 —— `Node.js`、`3.14`、URL 裡的 `.`/`,`,鄰居都不是 CJK,
// 碰不到;英文句子裡的標點也碰不到。作者點的反例(括弧、含英文的情境)不在這條規則內,留給 Lane B。
// 保守起見**只收 `,` 與 `.`**,不收 `:;!?`(`:` 會撞到 12:30、比例、URL)。
//
// 跟用詞替換一樣:它會改**可見文字**,所以**不走 style-autofix Worker**(會破壞 textSignature),
// 是 Lane A 的另一條獨立 deterministic 轉換。沿用 applyTwTerms 的分段邏輯。
//
// Zero dependencies。回傳 { text, changes:[{from,to,count}] }。原本換行(含 CRLF 的 \r)原樣保留。

const CJK = /[一-鿿㐀-䶿]/; // 常用漢字 + 擴充 A;全形標點不在此範圍,不會被當成 CJK 鄰居
const MAP = { ',': '，', '.': '。' };

export function applyFullwidthPunct(input) {
  const counts = Object.create(null);
  // 保護:行內 `code`、HTML 標籤 <...>、以及 Markdown link/image 的 URL 段 `](url)`
  // (URL 裡若有 CJK 夾的 ,/. 不該被改,免得把連結改壞)。
  const protectedInline = /(`[^`\n]*`|<[^>\n]+>|\]\([^)\n]*\))/;
  let fence = false;
  const lines = String(input).split('\n');
  const out = lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return line; } // 圍欄線不動
    if (fence) return line;                                          // 圍欄內整行不動
    return line
      .split(protectedInline)
      .map((seg, i) => (i % 2 === 1 ? seg : convertSegment(seg, counts)))
      .join('');
  });
  const changes = Object.keys(MAP)
    .filter((k) => counts[k])
    .map((k) => ({ from: k, to: MAP[k], count: counts[k] }));
  return { text: out.join('\n'), changes };
}

// 在一段純散文上,只有「前後都是 CJK」的 , / . 才換。段落邊界外(前後跨到被保護區段)一律不換(fail-safe)。
function convertSegment(segment, counts) {
  const chars = Array.from(segment);
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (c !== ',' && c !== '.') continue;
    const prev = i > 0 ? chars[i - 1] : '';
    const next = i < chars.length - 1 ? chars[i + 1] : '';
    if (prev && next && CJK.test(prev) && CJK.test(next)) {
      chars[i] = MAP[c];
      counts[c] = (counts[c] || 0) + 1;
    }
  }
  return chars.join('');
}
