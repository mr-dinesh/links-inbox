const $ = id => document.getElementById(id);
const KEY = "links-inbox-pw";
const store = {
  get() { try { return localStorage.getItem(KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(KEY, v); } catch {} },
  clear() { try { localStorage.removeItem(KEY); } catch {} },
};

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: { authorization: `Bearer ${store.get()}`, "content-type": "application/json" },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { store.clear(); showLogin("Wrong password."); throw new Error("401"); }
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const say = (msg, kind = "") => { const s = $("status"); s.textContent = msg; s.className = kind; };

function showLogin(msg) {
  $("app").hidden = true; $("login").hidden = false;
  if (msg) say(msg, "err");
  $("pw").focus();
}

async function showApp() {
  $("login").hidden = true; $("app").hidden = false;
  prefillFromShare();
  await refresh();
}

// The share sheet opens /?url=…&text=…&title=…; apps disagree about which field holds the link
function prefillFromShare() {
  const q = new URLSearchParams(location.search);
  if (![...q.keys()].length) return;
  const text = q.get("text") || "";
  const url = q.get("url") || (text.match(/https?:\/\/\S+/) || [])[0] || "";
  const title = q.get("title") || "";
  $("url").value = url;
  $("title").value = /^https?:\/\//.test(title) ? "" : title;
  history.replaceState(null, "", "/");
  $("note").focus();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = ymd => { const [, m, d] = ymd.split("-"); return `${+d} ${MONTHS[m - 1]}`; };
const host = url => { try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; } };
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };

function render(items) {
  $("queue").replaceChildren(...items.map(i => {
    const li = el("li");
    const a = el("a", "title", i.title);
    a.href = i.url; a.target = "_blank"; a.rel = "noopener";
    const date = i.key.split(":")[1];
    const src = el("p", "src");
    src.append(host(i.url), el("span", "sep", "·"));
    const t = el("time", "", shortDate(date)); t.dateTime = date; src.append(t);
    li.append(a, src);
    if (i.note) li.append(el("p", "note", i.note));
    const del = el("button", "del", "×");
    del.type = "button"; del.title = "Remove from queue";
    del.setAttribute("aria-label", `Remove ${i.title}`);
    del.onclick = async () => {
      del.disabled = true;
      try { render((await api(`/api/links/${encodeURIComponent(i.key)}`, { method: "DELETE" })).queue); }
      catch (err) { del.disabled = false; if (err.message !== "401") say(err.message, "err"); }
    };
    li.append(del);
    return li;
  }));
  $("count").textContent = items.length || "";
  $("count").hidden = !items.length;
  $("empty").hidden = items.length > 0;
  $("publish").disabled = items.length === 0;
}

async function refresh() { render(await api("/api/queue")); }

$("login").onsubmit = async e => {
  e.preventDefault();
  store.set($("pw").value);
  $("pw").value = "";
  try { await showApp(); say(""); } catch {}
};

$("add").onsubmit = async e => {
  e.preventDefault();
  $("save").disabled = true;
  say("Saving…");
  try {
    const r = await api("/api/links", {
      method: "POST",
      body: JSON.stringify({ url: $("url").value, title: $("title").value, note: $("note").value }),
    });
    say(r.duplicate ? "Already queued." : `Saved: ${r.item.title}`, "ok");
    $("add").reset();
    render(r.queue);
  } catch (err) {
    if (err.message !== "401") say(err.message, "err");
  } finally {
    $("save").disabled = false;
  }
};

$("publish").onclick = async () => {
  $("publish").disabled = true;
  say("Publishing…");
  try {
    const { published } = await api("/api/publish", { method: "POST" });
    const n = published.reduce((s, p) => s + p.count, 0);
    say(n ? `Published ${n} link${n > 1 ? "s" : ""}. Live on mrdee.in/links in a minute or two.` : "Nothing to publish.", "ok");
    refresh();
  } catch (err) {
    if (err.message !== "401") say(err.message, "err");
    $("publish").disabled = false;
  }
};

$("logout").onclick = () => { store.clear(); showLogin(); };

if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
store.get() ? showApp().catch(() => {}) : showLogin();
