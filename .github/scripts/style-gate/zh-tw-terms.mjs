// 來源:vps-blogger/tools/style-gate/zh-tw-terms.mjs(vendored 進 han-content 供 publish.yml 用;改功能請改 vps-blogger 那份再同步過來)。
// zh-tw-terms.mjs — Lane A①:大陸用詞 → 台灣電腦用詞(deterministic、不經 AI)
//
// 這條是「發文前風格把關」裡**定得出不變量**的一條,所以可以自動套用(見 docs/style-gate-plan.md
// 與 .claude/skills/safe-ai-autofix)。它會改到**可見文字**,因此**絕對不能**走 style-autofix
// Worker 那條路——那條的不變量是 `textSignature` 逐字不變,被這個一改就整篇退回。兩條路分開跑。
//
// 不變量(這條自動化「不准破壞」的那條線):
//   只會把「白名單裡的大陸詞」換成「對應的台灣詞」,其他一個字都不動;
//   而且**不碰程式碼**(fenced code / 行內 `code`)與 **HTML 標籤**(`<...>` 屬性,如 src/alt)。
// 之所以敢自動:這條線能用程式 deterministic 地驗(見 zh-tw-terms.test.mjs 的 guard),
// 改錯了頂多是「漏換/多換一個白名單詞」,不會把文章語意改壞。
//
// 白名單只收**明確、無歧義**的詞:大陸形在台灣不會用、或用了也不是別的意思。
// 任何「在台灣另有常見意思」的詞一律**不收**,列在 EXCLUDED_AMBIGUOUS 並由測試擋住誤加。
//
// Zero dependencies. 純資料 + 小函式,Node / Astro build / Workers 都能 import。

// 大陸詞 → 台灣詞。只收無歧義的;要新增前先確認大陸形在台灣不會解讀成別的意思。
export const TW_TERMS = Object.freeze({
  // 硬體 / 裝置
  軟件: '軟體',
  硬件: '硬體',
  固件: '韌體',
  服務器: '伺服器',
  服務端: '伺服端',
  內存: '記憶體',
  硬盤: '硬碟',
  光盤: '光碟',
  鼠標: '滑鼠',
  屏幕: '螢幕',
  芯片: '晶片',
  激光: '雷射',
  攝像頭: '攝影機',
  打印機: '印表機', // 比 打印 長,longest-first 先換這個
  打印: '列印',
  // 規格 / 單位
  分辨率: '解析度',
  帶寬: '頻寬',
  字節: '位元組',
  比特: '位元',
  端口: '連接埠',
  // 網路 / 媒體
  網絡: '網路',
  鏈接: '連結',
  視頻: '影片',
  音頻: '音訊',
  郵箱: '信箱',
  博客: '部落格',
  短信: '簡訊',
  數碼: '數位',
  // 軟體操作 / 設定
  默認: '預設',
  緩存: '快取',
  兼容: '相容',
  卸載: '移除',
  加載: '載入',
  調試: '除錯',
  粘貼: '貼上',
  菜單: '選單',
  // 程式結構(只收無歧義的)
  字符串: '字串', // 比 字符 長,longest-first 先換
  字符: '字元',
  數組: '陣列',
  隊列: '佇列',
  遞歸: '遞迴',
  字段: '欄位',
  線程: '執行緒',
  內核: '核心',
  程序員: '程式設計師',
});

// 故意**不收**的歧義詞:大陸形在台灣另有常見、不同的意思,自動換會改錯語意。
// 測試(zh-tw-terms.test.mjs)會確認 TW_TERMS 的 key 一個都不在這裡——防止之後手滑加進去。
// 這些若真的想處理,屬於 Lane B(列建議、人點頭),不走這條自動路。
export const EXCLUDED_AMBIGUOUS = Object.freeze({
  文件: '檔案',   // 文件 在台灣=文書/document
  代碼: '程式碼', // 代碼 在台灣=代號(股票代碼…)
  程序: '程式',   // 程序 在台灣=程序/procedure
  函數: '函式',   // 函數 在台灣數學也用
  指針: '指標',   // 指針 在台灣=鐘面指針
  質量: '品質',   // 質量 在台灣=物理質量(mass)
  項目: '專案',   // 項目 在台灣=項目/item
  信息: '資訊',   // 信息 在台灣也通用
  智能: '智慧',   // 智能 在台灣也通用(智能手機…)
  用戶: '使用者', // 用戶 在台灣也通用
  登錄: '登入',   // 登錄 在台灣=登記/登錄有案
  進程: '行程',   // 進程 在台灣可讀成進展
  撤銷: '復原',   // 撤銷 在台灣=撤銷(法律/一般)
  刷新: '重新整理', // 刷新 在台灣=刷新紀錄
  倉庫: '儲存庫', // 倉庫 在台灣=倉庫(warehouse)
  克隆: '複製',   // git clone 多半保留英文
  提交: '送交',   // 提交 在台灣=提交/submit
});

// 把一段 Markdown 的大陸詞換成台灣詞,只動散文、不碰程式碼與 HTML 標籤。
// 回傳 { text, changes:[{from,to,count}] }。原本的換行(含 CRLF 的 \r)原樣保留。
export function applyTwTerms(input, map = TW_TERMS) {
  const keys = Object.keys(map).sort((a, b) => b.length - a.length); // longest-first:防 打印機/打印、字符串/字符 誤換
  const counts = Object.create(null);
  // 行內要保護的區段:行內程式碼 `...`、HTML 標籤 <...>(含屬性)、以及 Markdown link/image 的 URL 段
  // `](url)`(連結文字仍是散文、照換;URL 不碰,免得把 /images/視頻封面.png 這種路徑改壞)。
  // 用 capture group 讓 split 保留分隔段。
  const protectedInline = /(`[^`\n]*`|<[^>\n]+>|\]\([^)\n]*\))/;
  let fence = false;
  const lines = String(input).split('\n'); // 不正規化 \r\n:CRLF 的 \r 會留在該行尾,一起保留
  const outLines = lines.map((line) => {
    if (/^\s*(```|~~~)/.test(line)) { fence = !fence; return line; } // 圍欄線本身不動
    if (fence) return line;                                          // 圍欄內整行不動
    return line
      .split(protectedInline)
      .map((seg, i) => (i % 2 === 1 ? seg : replaceCounting(seg, keys, map, counts)))
      .join('');
  });
  const changes = keys
    .filter((k) => counts[k])
    .sort((a, b) => counts[b] - counts[a])
    .map((k) => ({ from: k, to: map[k], count: counts[k] }));
  return { text: outLines.join('\n'), changes };
}

// 在一段「純散文」字串上做白名單替換,順便累計每個詞換了幾次。
function replaceCounting(segment, keys, map, counts) {
  let s = segment;
  for (const k of keys) {
    if (s.indexOf(k) === -1) continue;
    const parts = s.split(k);
    counts[k] = (counts[k] || 0) + (parts.length - 1);
    s = parts.join(map[k]);
  }
  return s;
}
