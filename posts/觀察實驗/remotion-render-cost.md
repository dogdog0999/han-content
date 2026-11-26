---
title: 把 render 丟到 GitHub Actions
date: 2026-11-26
category: 觀察實驗
tags: [Remotion, GitHub Actions, 影片生成, 成本, side project]
wordCount: 600
readingTime: 3
excerpt: 想把投影片影片真的 render 成 mp4，試了 Remotion + GitHub Actions matrix，跑完 benchmark 才發現平行化換的是等待、不是省錢。
badge: 成本
---

Remotion 能用 React 寫動畫、再 render 成 mp4，看起來正合用。

問題是我不想為它養一台常駐的 render 機器，於是試了另一條：**把 render 丟到 GitHub Actions，用 matrix 把影格拆成好幾格平行跑。**

為了算得準，我先試拍了一集無聲 pilot，再寫一個中等複雜度的合成，跑了兩輪真實 workflow，從 Actions API 直接抓每一步的起訖秒數——不是自己掐表估的。

<figure>
  <video src="/bloger/images/remotion-render-cost/remotion-bench-silent.mp4" controls muted loop playsinline preload="metadata"></video>
  <figcaption>GitHub Actions render 出來的無聲成品（那支中等複雜度的合成：標題彈進來、條列淡入、一個轉的 SVG）。中文會變成 □，是因為 CI 的機器沒裝中文字型、我也沒把字型打包進去。</figcaption>
</figure>

## 算出來的帳

兩輪實跑抓到的數字（跑在 GitHub Actions 的標準 Linux runner 上，起訖秒數直接從 GitHub Actions API 拿）：

| 影格數 | Render 步驟 | Job 總時長 |
|---|---|---|
| 2（校準） | 24 秒 | 41 秒 |
| 100 | 30 秒 | 48 秒 |
| 300 | 51 秒 | 1 分 9 秒 |

拆出來看：

- 每個 job 有一筆**跟影格數無關的固定成本，約 38 秒**：bundle 合成，加上每個 job 都是全新 VM、都得重新下載 131MB 的 Chromium headless shell（Remotion render 要用的無頭瀏覽器）。
- 真正 render 每一格只要 **約 0.1 秒**。
- 整個 job 大致是 `38 + 0.1 × 格數` 秒。

**真正花錢的是這 38 秒固定稅，render 本身反而不值一提。**

matrix 拆得越細，這筆固定稅就付越多次；而且 GitHub 的分鐘是**每個 job 各自無條件進位到下一分鐘**。所以「拆 20 格平行跑」聽起來很快，其實是多花錢換更短的等待——**平行化只買到時間，沒省到錢。**

## 踩過的坑

- ubuntu runner **現在沒預裝 ffmpeg**，最後把影格接成影片那步會直接失敗，得自己補一個安裝步驟。
- 那 131MB 的 headless shell，我這次**完全沒做快取**，每個 job 都重下一次。要靠拆細 matrix 省時間，得先把它快取起來——用 `actions/cache` 能不能命中，之後可以實驗看看。
- 還有一點：**公開 repo 的標準 runner 不計費**。真要用就把 render 放公開那邊，分鐘數直接當零。

## 測試環境

這整套 render 管線**最後沒進 main**，是獨立 worktree 裡的一次性實驗，站上還是前端現場播那套在跑。沉沒成本就是這條線試到能動、量完數字後擱著沒上；不過 Remotion 的彈簧、淡入手法有用 0..1 進度版重寫進現在的播放器。
