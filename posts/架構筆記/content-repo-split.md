---
title: 把文章搬出程式碼：push 一篇 .md,它自己上站
date: 2026-11-25
category: 架構筆記
tags: [GitHub Actions, CI/CD, repository_dispatch, 自動化]
badge: CI
excerpt: 文章跟站台程式本來擠在同一個 repo,想發篇廢文也要開 PR。後來把內容拆出去,push 就自己上站。
---

這個部落格的程式碼有開 PR 保護,是怕自己半夜手滑把站推壞。

但文章跟程式本來在同一個 repo,所以我只是想發一篇廢文,也得開分支、等 CI、再 merge。改個錯字也一樣。後來就變得不太想寫了。

## 先放結果

現在我發文章只做一件事:在內容 repo 丟一個 `.md`,然後 push。

大概半分鐘,站上就有了。Actions 跑完長這樣:

```text
✓ Notify site to deploy        (內容 repo:2s)
✓ Build & Deploy               (站台:repository_dispatch 觸發)
  22 page(s) built
  Rsync site to VPS            ✓
```

這篇就是我 push 上去測的。

## 怎麼接的

我把文章拆成另一個 repo,叫 `han-content`,裡面只有 `posts/*.md`,沒開保護,想改就直接 commit。

站台 repo 還是原本那個,版型、搜尋、CI 都在這邊,差別是建置的時候才去把文章 clone 進來。

剩下的問題是:內容 repo 一 push,怎麼讓站台知道?

我用的是 `repository_dispatch`。內容 repo 有個很小的 workflow,push 的時候打一下 GitHub API,送一個自訂事件過去。站台的 `deploy.yml` 多掛一個監聽:

```yaml
on:
  push:
    branches: [main]
  repository_dispatch:
    types: [content-updated]
```

收到就開始建置、rsync 到 VPS。說穿了就是 webhook,只是兩邊都在 GitHub 裡。

## 為什麼不用 submodule

我有想過 submodule,也想過同一個 repo 分資料夾。

submodule 是 git 內建的功能,可以把另一個 repo 掛進主 repo 的某個資料夾,像這樣把文章 repo 掛在 `posts/` 底下。但主 repo 記的不是對方的檔案,只是「指到它的哪一個 commit」。所以內容 repo 每多一篇文章,主 repo 還得再 commit 一次,把指標更新過去,感覺沒有真的拆開。

<figure>
<img src="/bloger/images/submodule-pointer.svg" alt="submodule 下每多一篇文章,內容 repo 多一個 commit,主 repo 也得多一個更新指標的 commit" />
<figcaption>內容 repo 每多一篇,主 repo 就得多一個「更新指標」的 commit(金色那幾個)。</figcaption>
</figure>

分資料夾的話,保護規則還是同一套,回到原點。

所以就拆成兩個 repo,中間用一個事件接起來。內容那邊隨便我改,程式這邊保護照舊。

缺點也有:要多保管一把 PAT(內容 repo 用它發事件),而且本機要看完整的站,得把兩邊都拉下來。我寫了個 `pull-content` 腳本把文章抓回本機,算是湊合著解掉。

## 踩到的坑

嵌入向量的快取 key 是用文章內容算 hash,所以「抓文章」這步要排在快取之前,不然 key 永遠對不上,每次都整批重算。

站台這邊的 `src/content/posts/` 要 gitignore,不然本機殘留的舊檔會跟新抓的打架。

先這樣。
