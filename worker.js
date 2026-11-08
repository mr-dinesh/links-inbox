// links-inbox: a share target that queues links and, once a day, publishes
// them to mrdee.in/links as content/links/<date>.md in the digital-journal repo.
//
//   GET    /api/queue          queued links, oldest first
//   POST   /api/links          {url?, text?, title?, note?} -> queue one link
//   DELETE /api/links/<key>    drop a queued link before it is published
//   POST   /api/publish        publish the queue now (the cron does this at 23:30 IST)
//
// Every /api call needs `Authorization: Bearer <ADMIN_PASSWORD>`.

// Query parameters that only exist to track the click. Deliberately narrower
// than privyRead's list: "ref" and "r" are real parameters on some sites
// (GitHub uses ?ref= for branches), so stripping them can break a link.
const TRACKERS = new Set([
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
  "utm_id", "utm_source_platform", "utm_creative_format", "utm_marketing_tactic",
  "fbclid", "gclid", "gclsrc", "dclid", "gbraid", "wbraid", "msclkid", "yclid",
  "twclid", "ttclid", "li_fat_id", "igshid", "igsh", "si", "mc_eid", "mc_cid",
  "_hsenc", "_hsmi", "mkt_tok", "s_cid", "epik", "substack_referral",
  "trk", "trkCampaign", "sc_campaign", "share_id", "smid",
]);

const AUTHOR = { name: "M R Dinesh", email: "84651087+mr-dinesh@users.noreply.github.com" };
const IST_MS = 330 * 60 * 1000;
const istDate = (ms = Date.now()) => new Date(ms + IST_MS).toISOString().slice(0, 10);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(req);
    if (!(await authorised(req, env))) return json({ error: "Wrong or missing password" }, 401);

    try {
      if (req.method === "GET" && url.pathname === "/api/queue") return json(await listQueue(env));
      if (req.method === "POST" && url.pathname === "/api/links") return json(await addLink(await req.json(), env), 201);
      if (req.method === "POST" && url.pathname === "/api/publish") return json(await publish(env));
      const del = url.pathname.match(/^\/api\/links\/(.+)$/);
      if (req.method === "DELETE" && del) {
        const key = decodeURIComponent(del[1]);
        if (!key.startsWith("q:")) throw new HttpError(400, "Bad key");
        await env.LINKS.delete(key);
        return json({ ok: true });
      }
      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: e.message }, e.status || 500);
    }
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(publish(env));
  },
};

// ---------- auth ----------
// Fails closed: with no ADMIN_PASSWORD set, nothing gets in. Both sides are
// hashed first so the comparison is constant-time and length-independent.
async function authorised(req, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const given = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, env.ADMIN_PASSWORD].map(s => crypto.subtle.digest("SHA-256", enc.encode(s))));
  return crypto.subtle.timingSafeEqual(a, b);
}

// ---------- queue ----------
function cleanUrl(raw) {
  let u;
  try { u = new URL(raw.trim()); } catch { throw new HttpError(400, "That isn't a valid URL"); }
  if (!/^https?:$/.test(u.protocol)) throw new HttpError(400, "Only http and https links");
  for (const k of [...u.searchParams.keys()]) if (TRACKERS.has(k)) u.searchParams.delete(k);
  if (u.hash.startsWith("#:~:text=")) u.hash = "";      // Chrome's scroll-to-text fragment
  return u.toString();
}

async function addLink(body, env) {
  // Android share sheets put the URL in `url`, or in `text` (often with other words around it)
  const raw = body.url || (String(body.text || "").match(/https?:\/\/\S+/) || [])[0];
  if (!raw) throw new HttpError(400, "No URL found in what was shared");
  const url = cleanUrl(raw);

  const queue = await listQueue(env);
  const dup = queue.find(i => i.url === url);
  if (dup) return { ...dup, duplicate: true };

  let title = tidy(body.title);
  if (!title || /^https?:\/\//.test(title)) title = (await fetchTitle(url)) || new URL(url).hostname;
  const item = { url, title, note: tidy(body.note, 500), ts: Date.now() };
  const key = `q:${istDate(item.ts)}:${item.ts}-${Math.random().toString(36).slice(2, 6)}`;
  await env.LINKS.put(key, JSON.stringify(item));
  return { key, ...item };
}

async function listQueue(env) {
  const keys = [];
  let cursor;
  do {
    const page = await env.LINKS.list({ prefix: "q:", cursor });
    keys.push(...page.keys.map(k => k.name));
    cursor = page.list_complete ? null : page.cursor;
  } while (cursor);
  const items = await Promise.all(keys.map(async key => ({ key, ...JSON.parse(await env.LINKS.get(key)) })));
  return items.sort((a, b) => a.ts - b.ts);
}

const tidy = (s, max = 200) => String(s || "").replace(/\s+/g, " ").trim().slice(0, max);

// Read just enough of the page to find its title. Best effort: any failure
// falls back to the hostname.
async function fetchTitle(url) {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0 (compatible; mrdee-links/1.0)", accept: "text/html" },
      redirect: "follow", signal: AbortSignal.timeout(5000),
    });
    if (!res.ok || !(res.headers.get("content-type") || "").includes("html")) return null;
    const reader = res.body.getReader(), dec = new TextDecoder();
    let html = "";
    while (html.length < 200_000) {
      const { done, value } = await reader.read();
      if (done) break;
      html += dec.decode(value, { stream: true });
      if (/<\/head>/i.test(html)) break;
    }
    reader.cancel().catch(() => {});
    const og = html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
            || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    const t = og ? og[1] : (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1];
    return t ? tidy(decodeEntities(t)) : null;
  } catch {
    return null;
  }
}

function decodeEntities(s) {
  const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10))
                 : named[e.toLowerCase()] ?? m);
}

// ---------- publishing ----------
// The blog renders raw HTML in Markdown (goldmark unsafe = true), and titles come
// from other people's pages, so < > & are escaped as well as Markdown syntax.
const mdText = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
                     .replace(/([\\`*_\[\]])/g, "\\$1");
const mdUrl = u => u.replace(/\(/g, "%28").replace(/\)/g, "%29").replace(/ /g, "%20");

function line(i) {
  const host = new URL(i.url).hostname.replace(/^www\./, "");
  return `- [${mdText(i.title)}](${mdUrl(i.url)}) · ${mdText(host)}` + (i.note ? `\\\n  ${mdText(i.note)}` : "");
}

function newPage(date) {
  const nice = new Date(date + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return `---
title: "Links · ${nice}"
date: ${date}T00:00:00+05:30
description: "Things I found on the web on ${nice}."
showReadingTime: false
showTableOfContents: false
---

`;
}

const b64encode = s => {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};
const b64decode = b => new TextDecoder().decode(Uint8Array.from(atob(b.replace(/\n/g, "")), c => c.charCodeAt(0)));

async function gh(env, path, init = {}) {
  if (!env.GITHUB_TOKEN) throw new HttpError(500, "GITHUB_TOKEN secret is not set");
  return fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/contents/${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${env.GITHUB_TOKEN}`, accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28", "user-agent": "links-inbox", ...(init.headers || {}),
    },
  });
}

async function publish(env) {
  const queue = await listQueue(env);
  const byDate = {};
  for (const i of queue) (byDate[i.key.split(":")[1]] ||= []).push(i);

  const published = [];
  for (const [date, items] of Object.entries(byDate)) {
    const path = `content/links/${date}.md`;
    const cur = await gh(env, `${path}?ref=${env.GITHUB_BRANCH}`);
    let body, sha;
    if (cur.status === 200) {
      const f = await cur.json();
      sha = f.sha;
      body = b64decode(f.content).replace(/\s*$/, "\n");
    } else if (cur.status === 404) {
      body = newPage(date);
    } else {
      throw new HttpError(502, `GitHub read failed (${cur.status}): ${(await cur.text()).slice(0, 200)}`);
    }
    body += items.map(line).join("\n") + "\n";

    const put = await gh(env, path, {
      method: "PUT",
      body: JSON.stringify({
        message: `links: ${date} (+${items.length})`, content: b64encode(body),
        branch: env.GITHUB_BRANCH, author: AUTHOR, committer: AUTHOR, ...(sha && { sha }),
      }),
    });
    if (!put.ok) throw new HttpError(502, `GitHub write failed (${put.status}): ${(await put.text()).slice(0, 200)}`);
    // only drop the queue once the commit has landed
    await Promise.all(items.map(i => env.LINKS.delete(i.key)));
    published.push({ date, count: items.length });
  }
  return { published };
}
