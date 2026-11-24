---
title: 把文章搬出程式碼：push 一篇 .md,它自己上站
date: 2026-11-25
category: 架構筆記
tags: [GitHub Actions, CI/CD, repository_dispatch, 自動化]
badge: CI
excerpt: 文章跟站台程式本來擠在同一個 repo,改個排版要走 PR、寫篇筆記也卡流程。後來把內容拆成獨立 repo,push 一篇就自己佈署,寫東西總算零摩擦了。
---

這個部落格的程式碼有開 PR 保護,立意是好的——不想讓自己半夜手滑把站推壞。

問題是,文章跟程式本來住在同一個 repo。於是「我只是想發一篇廢文」也得走一輪流程,改個錯字還要開分支。久了就懶得寫。

**我要的其實很簡單:寫文章這件事,摩擦愈小愈好。**

## 先放結果

現在我發文章只做一件事:在內容 repo 丟一個 `.md`,然後 push。

剩下的全自動,大概半分鐘站上就有了。CI 跑完長這樣:

```text
✓ Notify site to deploy        (內容 repo:2s)
✓ Build & Deploy               (站台:repository_dispatch 觸發)
  posts fetched: ...
  22 page(s) built
  Rsync site to VPS            ✓
```

這篇文章本身,就是我 push 上去測出來的。

## 拆成兩個 repo

想法是把「內容」跟「程式」分家:

`han-content` 只放 `posts/*.md`,不設保護,愛改就改、直接 commit。

站台 repo 照舊,版型、搜尋、CI 都在這;**建置的時候才去把文章 clone 進來**。

最關鍵的是那條看不見的線:內容 repo 一 push,要怎麼「叫醒」站台去佈署?

答案是 `repository_dispatch`。內容 repo 加一個小 workflow,push 時打一下 GitHub API,對站台發一個自訂事件;站台的部署流程就多掛一個 `on: repository_dispatch`,收到事件就開跑。

說穿了就是一通 webhook,只是兩邊都在 GitHub 自己家裡。

## 為什麼不用 submodule

我有想過 git submodule,或是乾脆 monorepo 分資料夾。

submodule 每次更新都要在主 repo 再 commit 一次指標,等於沒拆乾淨,摩擦還在。monorepo 分資料夾又回到「同一個 repo、同一套保護」的老問題。

拆兩個 repo + 一條 dispatch,反而是最省事的:**內容那邊完全自由,程式這邊保護照舊,中間用一個事件接起來。**

代價也很誠實:多一把 PAT 要保管(給內容 repo 用來發事件),本機要完整預覽得把兩個 repo 都拉下來。我寫了個 `pull-content` 腳本把文章抓回本機,算是補上這個小麻煩。

## 踩到的幾個坑

嵌入向量的快取 key 是用文章內容算 hash 的,所以「抓文章」這步一定要排在快取之前,不然 key 永遠對不上、每次都重算。

站台這邊的 `src/content/posts/` 要記得 gitignore,否則本機殘留的舊檔會跟抓進來的打架。

那把 PAT 權限只給到 `Contents: write`、而且只授權站台那個 repo——能發事件就好,不用給它整個帳號。

先這樣。之後如果想加「草稿預覽」或排程發文,再回來補。
