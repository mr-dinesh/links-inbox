# links-inbox

A share target for [mrdee.in/links](https://mrdee.in/links/). Share a link from any app on the phone, add a line about why it's worth reading, and it waits in a queue. Every night at 23:30 IST the day's links are committed to the blog repo as one page, and Cloudflare Pages publishes it.

```
phone share sheet ──► links-inbox Worker ──► KV queue ──(cron 23:30 IST)──► GitHub: content/links/<date>.md ──► mrdee.in/links
```

## What it does with a link

- Finds the URL even when the sharing app puts it inside text ("look at this https://…")
- Strips click-tracking parameters (`utm_*`, `fbclid`, `gclid`, `si`, …) and Chrome's `#:~:text=` fragments. `ref` and `r` are left alone: some sites use them for real (GitHub's `?ref=` is a branch)
- Fetches the page title when the share didn't include one (reads only up to `</head>`, 5 s timeout)
- Skips links already in the queue
- Escapes `< > &` and Markdown syntax in titles and notes. The blog renders raw HTML, and titles come from other people's pages

Until publishing, you can delete queued links from the app. **Publish now** pushes the queue immediately.

## Files

| File | What it is |
|---|---|
| `worker.js` | API (`/api/queue`, `/api/links`, `/api/publish`) and the nightly cron |
| `public/` | The installable web app: page, script, styles, manifest with `share_target`, service worker, icons, `_headers` (CSP) |
| `wrangler.toml` | KV binding `LINKS`, cron `0 18 * * *`, target repo and branch |

## Setup

```bash
wrangler kv namespace create LINKS        # put the id in wrangler.toml
wrangler secret put ADMIN_PASSWORD        # what the phone app sends
wrangler secret put GITHUB_TOKEN          # fine-grained PAT: one repo, Contents read/write only
wrangler deploy
```

With no `ADMIN_PASSWORD` set, every API call is refused. There is no default password.

Then open the Worker URL on the phone, unlock it, and use **Install** / **Add to Home screen**. "Links" then appears in the share menu.

## Local development

```bash
echo 'ADMIN_PASSWORD=localtest' > .dev.vars   # gitignored
wrangler dev --local
```

Publishing needs `GITHUB_TOKEN`. Without it, `/api/publish` returns a clear error and leaves the queue alone.

## Output

Each day's page in the blog repo looks like this:

```markdown
---
title: "Links · 8 November 2026"
date: 2026-11-08T00:00:00+05:30
description: "Things I found on the web on 8 November 2026."
---

- [Page title](https://example.com/article) · example.com\
  Why it's worth reading
```

Commits are authored as the blog owner. The queue is only cleared after GitHub confirms the commit.
