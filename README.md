# han-content

HAN 部落格的**文章內容**(Markdown)。放在獨立 repo,方便隨手增修、直接 commit,不受站台程式碼的 PR 保護流程拘束。

- `posts/*.md` — 一般部落格文章。frontmatter 與寫作風格見站台 repo 的 `CLAUDE.md`。
- 一旦 push 到 `main`,會透過 `repository_dispatch` 自動觸發站台 repo `vps-blogger` 重新建置與佈署。

> 站台程式碼、版型、搜尋等都在 `vps-blogger`;這裡只放內容。
