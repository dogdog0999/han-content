---
title: autofix 測試B(可刪)
date: 2026-11-25
category: 架構筆記
tags: [autofix, 測試]
excerpt: 測試 style-autofix 會不會動到作者自己寫好的結構(可刪)。
---

這是一篇乾淨的 Markdown,用來看 AI 會不會亂動結構。

## 先放結果

下面是一張圖:

<figure>
<img src="/bloger/images/submodule-pointer.svg" alt="submodule 指標示意圖" />
<figcaption>submodule 的指標每次都要多一個 commit</figcaption>
</figure>

## 指令

```bash
git submodule update --remote
git add content
git commit -m "bump content"
```

先這樣,測完就刪。
