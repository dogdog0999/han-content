# han-content

HAN 部落格的**文章內容**(Markdown)。放在獨立 repo,方便隨手增修、直接 commit,不受站台程式碼的 PR 保護流程拘束。

- `posts/*.md` — 一般部落格文章(可用子資料夾分類,如 `posts/架構筆記/`)。frontmatter 與寫作風格見站台 repo 的 `CLAUDE.md`。
- `images/*` — 文章用的圖、GIF、SVG。建置時會被複製到站台的 `public/images/`,文章裡用絕對路徑 `/bloger/images/檔名` 引用。
- 一旦 push 到 `main`,會透過 `repository_dispatch` 自動觸發站台 repo `vps-blogger` 重新建置與佈署。

> 一篇含圖的文章:把 `.md` 放進 `posts/`、圖放進 `images/`,一起 commit push 就好,不用再去動站台 repo。

> 站台程式碼、版型、搜尋等都在 `vps-blogger`;這裡只放內容。
