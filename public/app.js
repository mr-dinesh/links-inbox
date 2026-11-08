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

async function refresh() {
  const items = await api("/api/queue");
  const ul = $("queue");
  ul.replaceChildren(...items.map(i => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = i.url; a.textContent = i.title; a.target = "_blank"; a.rel = "noopener";
    const meta = document.createElement("span");
    meta.className = "meta";
    meta.textContent = `${new URL(i.url).hostname.replace(/^www\./, "")} · ${i.key.split(":")[1]}`;
    li.append(a, meta);
    if (i.note) { const n = document.createElement("span"); n.className = "note"; n.textContent = i.note; li.append(n); }
    const del = document.createElement("button");
    del.className = "del"; del.textContent = "×"; del.title = "Remove from queue";
    del.setAttribute("aria-label", `Remove ${i.title}`);
    del.onclick = async () => { del.disabled = true; await api(`/api/links/${encodeURIComponent(i.key)}`, { method: "DELETE" }); refresh(); };
    li.append(del);
    return li;
  }));
  $("count").textContent = items.length ? `(${items.length})` : "";
  $("empty").hidden = items.length > 0;
  $("publish").disabled = items.length === 0;
}

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
    say(r.duplicate ? "Already queued." : `Saved: ${r.title}`, "ok");
    $("add").reset();
    refresh();
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
