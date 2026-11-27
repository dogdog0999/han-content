// 來源:vps-blogger/tools/style-gate/secret-scan.mjs(vendored,改功能改那份再 npm run gate:sync 同步)。
// secret-scan.mjs — Lane A②:掃「真正的金鑰值」,fail-closed(偵測到就擋下送出)。
//
// 設計重點(見 docs/style-gate-plan.md):
// - **只偵測、絕不改寫**。偵測到真的金鑰值 → 回 severity:'block',讓 gate 擋下送出並明確提示,
//   由人決定怎麼處理(換 key、刪掉)。**不靜默刪字**——把真的外洩悄悄藏起來比留著更危險。
// - 金鑰「名稱」(像 NVIDIA_API_KEY、AUTOFIX_SECRET 這種變數名)不是外洩,這個部落格還常常
//   在講它們;所以名稱只給 severity:'notice'(偏好:要不要化名),預設不擋、也不吵。
// - 想在某行放一個「示範用」的假 key,行末加 `<!-- secret-scan:ignore -->` 可略過該行。
//
// 不變量:這支**不改任何文字**,純 reporter;唯一的「動作」是在發現 block 級時讓流程 exit 非 0。
//
// Zero dependencies.

// 已知金鑰格式 → 一律 block(高信心是真的值)。
const KNOWN = [
  { id: 'pem-private-key', label: 'PEM 私鑰區塊', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { id: 'aws-access-key', label: 'AWS Access Key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: 'github-token', label: 'GitHub Token', re: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b/g },
  { id: 'github-pat', label: 'GitHub fine-grained PAT', re: /\bgithub_pat_[A-Za-z0-9_]{22,}\b/g },
  // anthropic 放 openai 前面:sk-ant-… 兩條都會命中,先匹配的會 cover 住、後面那條跳過(見下方 covered 檢查),
  // 避免同一把 sk-ant key 被 openai + anthropic 重複 block。
  { id: 'anthropic-key', label: 'Anthropic API Key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'openai-key', label: 'OpenAI API Key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { id: 'google-api-key', label: 'Google API Key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: 'slack-token', label: 'Slack Token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: 'nvidia-key', label: 'NVIDIA API Key', re: /\bnvapi-[A-Za-z0-9_-]{20,}\b/g },
  { id: 'cloudflare-token', label: 'Cloudflare API Token', re: /\b[A-Za-z0-9_-]{40}\b(?=.*(?:cloudflare|cf[_-]?api))/gi },
  { id: 'jwt', label: 'JWT', re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
];

// 一行裡若出現這些字,代表「這附近的長亂碼」很可能真的是機密 → 升級成 block。
const SECRET_CONTEXT = /(secret|token|api[_-]?key|apikey|password|passwd|pwd|credential|private[_-]?key|bearer|金鑰|密鑰|密碼|憑證|權杖)/i;

// 金鑰「名稱」識別字(大寫底線常數),只給 notice。兩個版本:global 給迭代、非 global 給 .test()。
const KEY_NAME_RE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:KEY|SECRET|TOKEN|PASSWORD|PAT)\b/g;
const IS_KEY_NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:KEY|SECRET|TOKEN|PASSWORD|PAT)$/;

// 一般長亂碼(可能是機密,也可能是雜湊)。長度 ≥ 24、字元混雜。
const GENERIC = /[A-Za-z0-9_\-+/=]{24,}/g;

// 看起來像雜湊的純 hex(git SHA、檔案雜湊…),沒有機密關鍵字就別當成金鑰。
const PURE_HEX = /^[0-9a-f]{32,64}$/i;

// 把「圖片/連結的路徑段」遮成等長空白,只給高熵掃描用(已知金鑰格式照樣掃原行)。
// 路徑不是金鑰,但長路徑(/bloger/images/xxx)會被當高熵長字串;同行又有「金鑰/token」字就
// 誤判成 block、擋下整篇佈署。遮掉這些段就不誤報。等長替換 → 欄位位置不變。
// base64 值(含 + / =,或 / 前面緊貼字元)不會被當成路徑,仍會被掃到。
function maskPathsForGeneric(line) {
  const blank = (m) => ' '.repeat(m.length);
  return line
    .replace(/\b(?:src|href|srcset|poster|data-[\w-]+)\s*=\s*"[^"]*"/gi, blank) // HTML 屬性 URL(雙引號)
    .replace(/\b(?:src|href|srcset|poster|data-[\w-]+)\s*=\s*'[^']*'/gi, blank) // HTML 屬性 URL(單引號)
    .replace(/\]\([^)\s]*/g, blank)                                             // markdown ](url
    .replace(/https?:\/\/[^\s"'<>)]+/gi, blank)                                 // 絕對 URL
    .replace(/(?<![A-Za-z0-9+=/])\.{0,2}\/[A-Za-z0-9._/-]{6,}/g, blank);        // 相對/絕對路徑段(/ 前非 base64 字元)
}

function shannon(s) {
  const freq = Object.create(null);
  for (const ch of s) freq[ch] = (freq[ch] || 0) + 1;
  let e = 0;
  for (const k in freq) {
    const p = freq[k] / s.length;
    e -= p * Math.log2(p);
  }
  return e;
}

function charClasses(s) {
  return (/[a-z]/.test(s) ? 1 : 0) + (/[A-Z]/.test(s) ? 1 : 0) + (/[0-9]/.test(s) ? 1 : 0) + (/[_\-+/=]/.test(s) ? 1 : 0);
}

// 掃一段文字,回傳 findings。每筆:{ id, label, severity, line, column, match, message }
// severity:'block'(真的值,fail-closed)| 'warn'(疑似高熵、信心低)| 'notice'(金鑰名稱,偏好化名)
// opts:{ includeNames=false } 要不要列出「金鑰名稱」notice(預設關,因為這部落格常提到名稱)。
export function scanSecrets(input, opts = {}) {
  const includeNames = !!opts.includeNames;
  const findings = [];
  const lines = String(input).split('\n');

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    if (/secret-scan:\s*ignore/i.test(line)) return; // 明示略過該行(示範用假 key)
    const hasContext = SECRET_CONTEXT.test(line);
    const covered = []; // 已被「已知格式」涵蓋的區段,避免 GENERIC 重複報

    // 1) 已知格式 → block
    for (const { id, label, re } of KNOWN) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line))) {
        if (covered.some(([a, b]) => m.index >= a && m.index < b)) { // 同一段已被前一條格式認走(sk-ant → anthropic),別重複 block
          if (m.index === re.lastIndex) re.lastIndex++;
          continue;
        }
        covered.push([m.index, m.index + m[0].length]);
        findings.push({
          id, label, severity: 'block', line: lineNo, column: m.index + 1,
          match: redact(m[0]),
          message: `疑似${label}(真實金鑰值)。送出前請移除並更換這把 key。`,
        });
        if (m.index === re.lastIndex) re.lastIndex++;
      }
    }

    // 2) 一般高熵長字串 → 有機密關鍵字 block,否則(非純 hex 雜湊)warn
    //    掃「遮掉圖片/連結路徑」後的版本(等長,欄位不變),避免長路徑被誤判。
    const genericLine = maskPathsForGeneric(line);
    GENERIC.lastIndex = 0;
    let g;
    while ((g = GENERIC.exec(genericLine))) {
      const tok = g[0];
      const start = g.index;
      if (covered.some(([a, b]) => start >= a && start < b)) continue; // 已知格式已涵蓋
      if (IS_KEY_NAME.test(tok)) continue;                             // 純大寫常數名 → 下面 notice 處理
      const e = shannon(tok);
      if (e < 3.5 || charClasses(tok) < 2) continue;                   // 熵太低/字元太單一 → 不像金鑰
      // 純 hex 長字串(git SHA、檔案雜湊…)**一律只 warn、絕不 block**,即使同行有機密字樣——
      // 技術文很常寫「這個 commit 的 token 是 <40-hex>」,不能因此擋掉整篇佈署(fail-closed 只留給高信心的真值)。
      if (PURE_HEX.test(tok)) {
        findings.push({ id: 'high-entropy', label: '高熵字串(疑似雜湊)', severity: 'warn', line: lineNo, column: start + 1, match: redact(tok), message: '長 hex 字串,像雜湊/SHA 而非金鑰;若其實是機密請自行移除。' });
        continue;
      }
      findings.push({
        id: 'high-entropy', label: '高熵長字串', severity: hasContext ? 'block' : 'warn',
        line: lineNo, column: start + 1, match: redact(tok),
        message: hasContext ? '這行有機密字樣且出現長亂碼,高度疑似金鑰值,請移除。' : '出現高熵長字串,若是機密請移除;若是雜湊/ID 可忽略。',
      });
    }

    // 3) 金鑰「名稱」→ notice(偏好:要不要化名),預設不列
    if (includeNames) {
      KEY_NAME_RE.lastIndex = 0;
      let n;
      while ((n = KEY_NAME_RE.exec(line))) {
        findings.push({
          id: 'key-name', label: '金鑰名稱', severity: 'notice', line: lineNo, column: n.index + 1,
          match: n[0], message: `提到金鑰名稱「${n[0]}」。只是名稱、不是外洩;若不想顯示真名可用化名。`,
        });
      }
    }
  });

  return findings;
}

// 只留頭尾幾個字,中間打碼——報告裡不要再把疑似機密原樣印出來。
function redact(s) {
  if (s.length <= 8) return s[0] + '…';
  return s.slice(0, 4) + '…' + s.slice(-4) + `(${s.length} 字)`;
}

export const SEVERITY_ORDER = { block: 0, warn: 1, notice: 2 };
