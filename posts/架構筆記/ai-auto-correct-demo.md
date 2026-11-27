---
title: AI 幫文章校正(下)— 實際跑一次長怎樣
date: 2026-11-27
category: 架構筆記
tags: [AI, CI/CD, GitHub Actions, 自動化, RAG]
wordCount: 400
readingTime: 2
excerpt: 上篇講了為什麼不全丟給 AI，這篇直接推一篇故意寫壞的測試文，看 CI 自動把用詞和標點改回來的實際畫面。
badge: AI
---

[上篇](/bloger/posts/架構筆記/ai-auto-correct-why/)講了分兩條路的想法。這篇直接推一篇故意寫壞的文，看它跑起來長什麼樣。

先放結果。我推了一篇內文有 `軟件`、`緩存` 和半形逗號的測試文，CI 自己把它改好、commit 回來：

<figure>
<img src="/bloger/images/gate-before-after.jpg" alt="GitHub commit diff：github-actions[bot] 的 style-gate commit，紅色是改前的 軟件 緩存 半形逗號，綠色是改後的 軟體 快取 全形標點" />
<figcaption>紅 → 綠，`軟件` 變軟體、`緩存` 變快取、半形逗號變全形，而且 commit 的人是 github-actions[bot]。</figcaption>
</figure>

整個過程沒有我插手。我只 push 了測試文，下一個 commit 就是 bot 自動校正的：

<figure>
<img src="/bloger/images/gate-commit-history.jpg" alt="GitHub commit 歷史：我 push 測試文那個 commit 之後，緊接著一個 github-actions[bot] 的 style-gate 正規化 commit" />
<figcaption>我推文、bot 緊接著校正，兩個 commit 連在一起。</figcaption>
</figure>

## CI 裡那一排把關

發文會觸發一條 workflow，校正排在最前面。這是這次跑的步驟：

<figure>
<img src="/bloger/images/gate-pipeline.jpg" alt="GitHub Actions 的 publish job 步驟列表，⓪a 掃描把關、⓪b 用詞標點校正、⓪c commit、① 結構校正、② AI 影片、③ 佈署，全部綠勾" />
<figcaption>⓪ 先把關（金鑰、用詞、標點），再輪到後面的結構校正與佈署。</figcaption>
</figure>

點開校正那一步，它老實印出改了哪些：

<figure>
<img src="/bloger/images/gate-correct-log.jpg" alt="⓪b 步驟的 log：Lane A 用詞 軟件換軟體、緩存換快取；Lane A 標點 半形逗號換全形六個、半形句號換全形一個" />
<figcaption>換了哪些詞、幾個標點，一條條列出來。</figcaption>
</figure>

接進流程的方式，就是在原本的發文 workflow 前面插這一段：

<figure>
<img src="/bloger/images/gate-wiring.jpg" alt="publish.yml 裡 ⓪a ⓪b ⓪c 三個步驟的 YAML：先擋下不該上站的、用詞標點 apply、結果 commit 回 main" />
<figcaption>金鑰擋下、用詞標點寫回、再 commit，都是現成指令串起來的。</figcaption>
</figure>

## AI 那塊的料

前面這些都沒用到 AI。要動用 AI 的只有「哪句話值得拉成引用」這種判斷，而且配著一份我過去改稿的例子餵給它：

<figure>
<img src="/bloger/images/gate-rag-examples.jpg" alt="style-rewrites.jsonl 的內容：幾行 JSON，每行有 before 原句、after 改後、rule 規則" />
<figcaption>「原句 → 改後」的例子庫，當 AI 的參考，之後也可能畢業成固定規則。</figcaption>
</figure>

跑了幾次下來，該機械處理的都機械掉了，我手動要調的剩沒幾個。先這樣，之後想到再補。
