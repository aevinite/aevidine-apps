// Aevidine desktop — the page side (runs before the site's own scripts, in its own isolated world).
//
// Two jobs: the update pill (at the end of this file), and "Continue with Google". Google refuses its sign-in page inside an app's window, so the click opens it in the
// computer's normal browser; when Google is done there, the browser hands the sign-in back to this app as a two-minute
// code (aevidine://handoff?code=…, lib/appHandoff.ts), which only opens with the secret kept here — exactly the Android
// app's way (public/app-bridge.js). Everything else (print, downloads, alerts, offline) is Chrome's own engine.
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("AevidineDesktop", {
  info: () => ipcRenderer.invoke("aevi:info"),
});

function b64url(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

if (window === window.top) {
  document.addEventListener("click", async (e) => {
    const a = e.target && e.target.closest ? e.target.closest('a[href*="/api/staff-login/google"]') : null;
    if (!a) return;
    let u;
    try { u = new URL(a.href, location.href); } catch { return; }
    if (u.origin !== location.origin) return;
    e.preventDefault();
    e.stopPropagation();
    const { scheme } = await ipcRenderer.invoke("aevi:info");
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    try { localStorage.setItem("aevi.handoff", verifier); } catch { /* the claim page will say the sign-in didn't finish */ }
    u.searchParams.set("next", `/api/app/handoff?challenge=${challenge}&scheme=${scheme}`);
    ipcRenderer.invoke("aevi:open-auth", u.toString());
  }, true);
}

// ── THE UPDATE PILL (owner, 2026-11-20: picked design 2 of five — "the growing pill … whenever it is extended, it should
// have later and schedule option"). Replaces the dark bar at the bottom of the window ("not that good … it should feel
// very premium … I like the VS Code one, which is on the top right").
//   collapsed  a capsule at the top right: the gem, "Updating 42%" with a ring that fills, then "Aevidine 2.6 is ready"
//              + Restart. Scheduled: "Restarts at 11:30 PM". One minute before: "Restarting in 42 s" + Not now.
//   opened     (hover, or a click on the capsule) a card grows out of it: the version you have → the new one, Restart
//              now, Later (in 1 hour · in 4 hours · tomorrow 9 AM) and Schedule (a time, tonight or tomorrow).
// ONE element changed in place, never rebuilt between steps (the old bar was, and jumped). Colours follow the page
// under it (light or dark), the brand serif and gold, and the panels' motion values: enter 280 ms ease-out, leave
// 180 ms, nothing but opacity and transform. In its own shadow root: the site can't restyle it and it can't touch the site.
if (window === window.top) {
  let host = null, root = null, last = null, open = false, sub = "";
  const invoke = (ch, arg) => ipcRenderer.invoke(ch, arg).catch(() => {});
  const nice = (v) => String(v || "").replace(/\.0$/, "");                 // "2.6.0" → "2.6" (the press's own name)
  const clock = (t) => new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const dayWord = (t) => (new Date(t).toDateString() === new Date().toDateString() ? "today" : "tomorrow");
  const isDark = () => {
    for (const el of [document.body, document.documentElement]) {
      const c = el && getComputedStyle(el).backgroundColor;
      const m = c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c) ? c.match(/\d+(\.\d+)?/g) : null;
      if (m) return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255 < 0.45;
    }
    return false;
  };
  const GEM = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4h11l4 5-9.5 11L2.5 9z" fill="#e8b45a"/><path d="M2.5 9h19M8.5 4l-2 5 5.5 11M15.5 4l2 5-5.5 11M6.5 9 12 4l5.5 5" fill="none" stroke="#9a6a24" stroke-width="1.1" stroke-linejoin="round"/></svg>';
  const CSS = `
    :host{all:initial}
    .w{--bg:#fffdf9;--ink:#2c2219;--mute:#766954;--line:rgba(44,34,25,.09);--gold:#9a6a24;--gold-ink:#fff;--soft:#f4ede1;--track:#efe6d6;
       --sh:0 1px 2px rgba(40,28,10,.06),0 12px 32px rgba(40,28,10,.18);
       position:fixed;top:64px;right:16px;z-index:2147483647;display:flex;flex-direction:column;align-items:flex-end;
       font:500 13px/1.4 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:var(--ink);-webkit-font-smoothing:antialiased;
       animation:in .28s cubic-bezier(.22,1,.36,1) both}
    .w[data-skin=dark]{--bg:#211b14;--ink:#f2e9da;--mute:#a8997f;--line:rgba(242,233,218,.1);--gold:#d4a574;--gold-ink:#1d1812;--soft:#2a2219;--track:#352c20;
       --sh:0 1px 2px rgba(0,0,0,.3),0 16px 40px rgba(0,0,0,.55)}
    .w.out{animation:out .18s cubic-bezier(.4,0,.2,1) both;pointer-events:none}
    @keyframes in{from{opacity:0;transform:translate3d(0,-8px,0) scale(.97)}}
    @keyframes out{to{opacity:0;transform:translate3d(0,-6px,0) scale(.98)}}
    .pill{display:flex;align-items:center;gap:10px;height:40px;padding:0 6px 0 7px;border-radius:999px;background:var(--bg);
       box-shadow:0 0 0 1px var(--line),var(--sh);cursor:pointer;user-select:none}
    .pill:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
    .gem{flex:none;width:27px;height:27px;border-radius:50%;background:#14110d;display:grid;place-items:center}
    .gem svg{width:16px;height:16px}
    .lbl{font-weight:600;white-space:nowrap;font-variant-numeric:tabular-nums}
    .ring{width:26px;height:26px;margin-right:4px}
    .ring circle{fill:none;stroke-width:3}
    .ring .bg{stroke:var(--track)}
    .ring .fg{stroke:var(--gold);stroke-linecap:round;transform:rotate(-90deg);transform-origin:50% 50%;transition:stroke-dashoffset .25s linear}
    button{font:600 13px/1 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;border:0;cursor:pointer;border-radius:999px;
       height:30px;padding:0 13px;white-space:nowrap;transition:transform .1s cubic-bezier(.22,1,.36,1),background-color .18s,opacity .18s}
    button:active{transform:scale(.97)}
    button:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
    .pri{background:var(--gold);color:var(--gold-ink)}
    .sec{background:var(--soft);color:var(--ink)}
    .gh{background:transparent;color:var(--mute)}
    .gh:hover,.sec:hover{background:var(--soft)}
    .card{margin-top:8px;width:330px;padding:16px;border-radius:18px;background:var(--bg);box-shadow:0 0 0 1px var(--line),var(--sh);
       transform-origin:top right;animation:grow .24s cubic-bezier(.22,1,.36,1) both}
    @keyframes grow{from{opacity:0;transform:translate3d(0,-4px,0) scale(.96)}}
    .k{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--gold)}
    .t{margin-top:2px;font:700 19px/1.2 "Playfair Display",Georgia,serif;letter-spacing:-.01em}
    .s{margin-top:3px;color:var(--mute);font-size:12.5px}
    .s b{color:var(--ink);font-weight:600}
    .row{display:flex;gap:8px;margin-top:14px}
    .row .pri{flex:1}
    .opts{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px;padding:10px;border-radius:12px;background:var(--soft)}
    .opts button{background:var(--bg);color:var(--ink);box-shadow:0 0 0 1px var(--line)}
    .opts button:hover{background:var(--gold);color:var(--gold-ink);box-shadow:none}
    .opts .cap{width:100%;margin:0 0 2px;font-size:12px;color:var(--mute)}
    .time{display:flex;gap:8px;align-items:center;width:100%}
    input[type=time]{flex:1;height:32px;padding:0 10px;border-radius:10px;border:0;background:var(--bg);color:var(--ink);
       box-shadow:0 0 0 1px var(--line);font:600 13px Inter,-apple-system,BlinkMacSystemFont,sans-serif;color-scheme:light}
    .w[data-skin=dark] input[type=time]{color-scheme:dark}
    input[type=time]:focus{outline:2px solid var(--gold);outline-offset:1px}
    [hidden]{display:none!important}
    @media (prefers-reduced-motion:reduce){.w,.card,.w.out{animation-duration:.12s;animation-name:fade}@keyframes fade{from{opacity:0}}}`;
  const C = 2 * Math.PI * 10;
  const build = () => {
    host = document.createElement("div");
    host.setAttribute("data-aevi-update", "");
    root = host.attachShadow({ mode: "open" });
    root.innerHTML = `<style>${CSS}</style><div class="w" role="status" aria-live="polite">
      <div class="pill" tabindex="0" aria-expanded="false"><span class="gem">${GEM}</span><span class="lbl"></span>
        <svg class="ring" viewBox="0 0 26 26" aria-hidden="true"><circle class="bg" cx="13" cy="13" r="10"/><circle class="fg" cx="13" cy="13" r="10" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>
        <button class="pri" data-a="restart">Restart</button><button class="sec" data-a="notnow">Not now</button></div>
      <div class="card" hidden><div class="k"></div><div class="t"></div><div class="s"></div>
        <div class="row" data-main><button class="pri" data-a="restart">Restart now</button><button class="sec" data-a="later">Later</button><button class="sec" data-a="schedule">Schedule</button></div>
        <div class="row" data-sched hidden><button class="pri" data-a="restart">Restart now</button><button class="sec" data-a="unschedule">Cancel schedule</button></div>
        <div class="opts" data-sub="later" hidden><p class="cap">Remind me</p><button data-later="3600000">In 1 hour</button><button data-later="14400000">In 4 hours</button><button data-later="tomorrow">Tomorrow, 9 AM</button></div>
        <div class="opts" data-sub="schedule" hidden><p class="cap">Restart into the update at</p><div class="time"><input type="time" value="23:30" aria-label="Time"><button class="pri" data-a="set">Set</button></div></div>
      </div></div>`;
    const w = root.querySelector(".w"), pill = root.querySelector(".pill");
    const setOpen = (v) => { open = v; if (!v) sub = ""; draw(last); };
    // Hover opens it on a computer; a click (or Enter) opens and keeps it open; leaving closes it unless a choice is half-made.
    w.addEventListener("mouseenter", () => { if (!open) setOpen(true); });
    w.addEventListener("mouseleave", () => { if (open && !sub) setOpen(false); });
    pill.addEventListener("click", (e) => { if (!e.target.closest("button")) setOpen(!open); });
    pill.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setOpen(!open); } if (e.key === "Escape") setOpen(false); });
    root.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      const a = b.getAttribute("data-a");
      if (a === "restart") { root.querySelector(".lbl").textContent = "Restarting…"; invoke("aevi:update-install"); }
      else if (a === "notnow" || a === "unschedule") invoke("aevi:update-unschedule");
      else if (a === "download") invoke("aevi:update-open-download");
      else if (a === "later" || a === "schedule") { sub = sub === a ? "" : a; draw(last); if (sub === "schedule") root.querySelector("input[type=time]").focus(); }
      else if (a === "set") {
        const [h, m] = (root.querySelector("input[type=time]").value || "23:30").split(":").map(Number);
        const at = new Date(); at.setHours(h, m, 0, 0);
        if (at.getTime() < Date.now() + 60_000) at.setDate(at.getDate() + 1);       // a time already gone = tomorrow
        sub = ""; invoke("aevi:update-schedule", at.getTime());
      } else if (b.hasAttribute("data-later")) {
        let ms = Number(b.getAttribute("data-later"));
        if (b.getAttribute("data-later") === "tomorrow") { const t = new Date(); t.setDate(t.getDate() + 1); t.setHours(9, 0, 0, 0); ms = t.getTime() - Date.now(); }
        sub = ""; open = false; out(() => invoke("aevi:update-later", ms));
      }
    });
    document.body.appendChild(host);
  };
  const out = (then) => {
    const w = root && root.querySelector(".w");
    if (!w) { then && then(); return; }
    w.classList.add("out");
    setTimeout(() => { if (host) host.remove(); host = null; root = null; then && then(); }, 180);
  };
  // Words and buttons change in place — the same pill from "Updating 5%" to "Restart".
  const draw = (s) => {
    last = s;
    ticking(s);
    const show = s && !s.dismissed && (s.phase === "downloading" || s.phase === "ready" || s.phase === "manual");
    if (!show) { if (host) out(); return; }
    if (!document.body) { document.addEventListener("DOMContentLoaded", () => draw(last), { once: true }); return; }
    if (!host || !host.isConnected) { open = false; sub = ""; build(); }
    const $ = (q) => root.querySelector(q), $$ = (q) => root.querySelectorAll(q);
    $(".w").setAttribute("data-skin", isDark() ? "dark" : "light");
    const name = s.appName || "Aevidine", v = nice(s.version), ready = s.phase === "ready";
    const sched = ready && s.scheduledAt, count = sched && s.countdown;
    const left = count ? Math.max(0, Math.round((s.scheduledAt - Date.now()) / 1000)) : 0;
    $(".lbl").textContent = s.phase === "downloading" ? `Updating ${s.percent || 0}%`
      : count ? `Restarting in ${left} s` : sched ? `Restarts at ${clock(s.scheduledAt)}`
      : ready ? `${name} ${v} is ready` : `${name} ${v} is out`;
    $(".ring").style.display = s.phase === "downloading" ? "" : "none";
    $(".fg").style.strokeDashoffset = String(C * (1 - (s.percent || 0) / 100));
    $(".pill [data-a=restart]").hidden = !ready || !!sched || open;   // opened: the card's "Restart now" is the one
    $(".pill [data-a=notnow]").hidden = !count;
    $(".pill").setAttribute("aria-expanded", String(open));
    // The card: only when it has something to offer (ready or the manual case), and only while opened.
    const card = $(".card");
    card.hidden = !open || s.phase === "downloading";
    $(".k").textContent = sched ? "Update scheduled" : ready ? "Update ready" : "Update available";
    $(".t").textContent = `${name} ${v}`;
    $(".s").innerHTML = sched ? `Restarts ${dayWord(s.scheduledAt)} at <b>${clock(s.scheduledAt)}</b> — about 5 seconds, your work is saved.`
      : ready ? `You have <b>${nice(s.current) || "an older version"}</b>. Restarting takes about 5 seconds.` : (s.why || "Download the new version to update.");
    $("[data-main]").hidden = !ready || !!sched;
    $("[data-sched]").hidden = !sched;
    $$(".opts").forEach((o) => { o.hidden = o.getAttribute("data-sub") !== sub; });
    if (s.phase === "manual") { $("[data-main]").hidden = false; $$("[data-main] button").forEach((b) => { b.hidden = b.getAttribute("data-a") !== "restart"; }); $("[data-main] .pri").textContent = "Download"; $("[data-main] .pri").setAttribute("data-a", "download"); }
  };
  // The countdown's seconds tick here (only during that last minute), so the main process only says "countdown started".
  let tick = null;
  const ticking = (s) => { if (s && s.countdown) { if (!tick) tick = setInterval(() => draw(last), 1000); } else if (tick) { clearInterval(tick); tick = null; } };
  ipcRenderer.on("aevi:update", (_e, s) => draw(s));
  ipcRenderer.invoke("aevi:update-state").then(draw).catch(() => {});
}
