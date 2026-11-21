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
  let host = null, root = null, last = null, open = false, sub = "", forceOpen = false, slotTimer = null, waitKey = null, settled = false, settleWait = false;
  // THE PANELS SHOW IT IN THEIR OWN MENUS (public/app-update-ui.js — owner 2026-11-21, like WhatsApp): while an update waits,
  // say so through localStorage "aevi.update.waiting" + the "aevi:update-waiting" event; a tap on their row sends
  // "aevi:update-open", which opens this card. Where a page shows it in a menu (it marks <html data-aevi-update-slot>), the
  // bottom-left button below stays away — measured: floating, it covered the owner sidebar's footer, a manager rail
  // button and a waiter's table.
  const syncWaiting = (s) => {
    const on = !!s && (s.phase === "ready" || s.phase === "manual");
    const key = on ? nice(s.version) || "?" : "";
    if (key === waitKey) return;
    waitKey = key;
    try { if (on) localStorage.setItem("aevi.update.waiting", JSON.stringify({ name: nice(s.version), at: Date.now() })); else localStorage.removeItem("aevi.update.waiting"); } catch { /* fine */ }
    try { window.dispatchEvent(new Event("aevi:update-waiting")); } catch { /* fine */ }
  };
  const slotShown = () => {
    const docs = [document];
    for (const f of document.querySelectorAll("iframe")) { try { if (f.contentDocument) docs.push(f.contentDocument); } catch { /* another site */ } }
    return docs.some((d) => d.documentElement && d.documentElement.hasAttribute("data-aevi-update-slot"));
  };
  window.addEventListener("aevi:update-open", () => { forceOpen = true; open = true; sub = ""; draw(last); });
  const invoke = (ch, arg) => ipcRenderer.invoke(ch, arg).catch(() => {});
  // Versions as everyone sees them (docs/VERSIONS.md): the app's "2.7.2" → "2.7.02"; what you HAVE also carries the
  // site's code part from the page (<meta name="aevi-version" content="2.7.01.042">) → "2.7.01.042".
  const nice = (v) => { const m = /^(\d+)\.(\d+)(?:\.(\d+))?/.exec(String(v || "")); return m ? `${m[1]}.${m[2]}.${String(Number(m[3] || 0)).padStart(2, "0")}` : String(v || ""); };
  const have = (v) => { const code = ((document.querySelector('meta[name="aevi-version"]') || {}).content || "").split(".")[3]; return code ? `${nice(v)}.${code}` : nice(v); };
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
  // The Aevidine logo, built in (works on the can't-connect screen too) — written by scripts/build-brand-icons.mjs.
  const LOGO = /* BRAND-LOGO:BEGIN */"data:image/png;base64,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"/* BRAND-LOGO:END */;
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
    .pill{position:relative}
    .dot{position:absolute;top:-1px;right:-1px;width:12px;height:12px;border-radius:50%;background:#e5383b;box-shadow:0 0 0 2px var(--bg)}
    /* AFTER "LATER" (owner, 2026-11-21: like WhatsApp's bottom-left button — "red dot, that something is there, and you open
       it and you can update from there"): the same element moves to the bottom-left as a round logo with a red dot, and stays
       until the update is taken. Hover or click opens the same card, growing upward. */
    .w[data-dock]{top:auto;right:auto;bottom:16px;left:16px;flex-direction:column-reverse;align-items:flex-start;animation-name:inDock}
    @keyframes inDock{from{opacity:0;transform:translate3d(0,8px,0) scale(.97)}}
    .w[data-dock] .pill{width:46px;height:46px;padding:0;gap:0;justify-content:center;border-radius:50%}
    .w[data-dock] .lbl,.w[data-dock] .ring,.w[data-dock] .pill button{display:none!important}
    .w[data-dock] .gem,.w[data-dock] .gem img{width:34px;height:34px}
    .w[data-dock] .card{margin-top:0;margin-bottom:10px;transform-origin:bottom left}
    .gem{flex:none;width:28px;height:28px;display:grid;place-items:center}
    .gem img{width:28px;height:28px;display:block}
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
      <div class="pill" tabindex="0" aria-expanded="false"><span class="gem"><img src="${LOGO}" alt=""></span><span class="dot" hidden></span><span class="lbl"></span>
        <svg class="ring" viewBox="0 0 26 26" aria-hidden="true"><circle class="bg" cx="13" cy="13" r="10"/><circle class="fg" cx="13" cy="13" r="10" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>
        <button class="pri" data-a="restart">Restart</button><button class="sec" data-a="notnow">Not now</button></div>
      <div class="card" hidden><div class="k"></div><div class="t"></div><div class="s"></div>
        <div class="row" data-main><button class="pri" data-a="restart">Restart now</button><button class="sec" data-a="later">Later</button><button class="sec" data-a="schedule">Schedule</button></div>
        <div class="row" data-sched hidden><button class="pri" data-a="restart">Restart now</button><button class="sec" data-a="unschedule">Cancel schedule</button></div>
        <div class="opts" data-sub="later" hidden><p class="cap">Remind me</p><button data-later="3600000">In 1 hour</button><button data-later="14400000">In 4 hours</button><button data-later="tomorrow">Tomorrow, 9 AM</button></div>
        <div class="opts" data-sub="schedule" hidden><p class="cap">Restart into the update at</p><div class="time"><input type="time" value="23:30" aria-label="Time"><button class="pri" data-a="set">Set</button></div></div>
      </div></div>`;
    const w = root.querySelector(".w"), pill = root.querySelector(".pill");
    const setOpen = (v) => { open = v; if (!v) { sub = ""; forceOpen = false; } draw(last); };
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
        sub = ""; open = false; forceOpen = false;
        if (last && last.dismissed) { invoke("aevi:update-later", ms); draw(last); }   // already the bottom-left button: it stays
        else out(() => invoke("aevi:update-later", ms));                              // the pill leaves; it comes back bottom-left
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
    syncWaiting(s);
    const show = s && (s.phase === "downloading" || s.phase === "ready" || s.phase === "manual");
    if (!show) { if (host) out(); return; }
    // Put off ("Later") = the bottom-left button with the red dot, until the update is taken or the reminder brings the pill back.
    const docked = !forceOpen && !!s.dismissed && !s.scheduledAt && (s.phase === "ready" || s.phase === "manual");
    // Docked and this page shows the update in its own menu: no button of ours on top of it (looked at again every 2 s,
    // as panels open, close and change pages).
    if (docked && !slotTimer) slotTimer = setInterval(() => { if (last) draw(last); }, 2000);
    if (!docked && slotTimer) { clearInterval(slotTimer); slotTimer = null; }
    if (docked && slotShown()) { if (host) out(); return; }
    if (host && host.isConnected && root && root.querySelector(".w").hasAttribute("data-dock") !== docked) { out(() => draw(last)); return; }
    // Only once the page has loaded and settled (owner 2026-11-21: "I have not seen the pill"): a pill put into the page
    // before React took it over made React find HTML it didn't draw (error #418) and redraw everything — the pill with it.
    if (!settled) { if (!settleWait) { settleWait = true; const go = () => setTimeout(() => { settled = true; draw(last); }, 1200); if (document.readyState === "complete") go(); else window.addEventListener("load", go, { once: true }); } return; }
    if (!host || !host.isConnected) { open = false; sub = ""; build(); }
    const $ = (q) => root.querySelector(q), $$ = (q) => root.querySelectorAll(q);
    $(".w").setAttribute("data-skin", isDark() ? "dark" : "light");
    $(".w").toggleAttribute("data-dock", docked);
    $(".dot").hidden = !docked;
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
    if (docked) $(".pill").setAttribute("aria-label", `Update ready: ${name} ${v}`); else $(".pill").removeAttribute("aria-label");
    // The card: only when it has something to offer (ready or the manual case), and only while opened.
    const card = $(".card");
    card.hidden = !open || s.phase === "downloading";
    $(".k").textContent = sched ? "Update scheduled" : ready ? "Update ready" : "Update available";
    $(".t").textContent = `${name} ${v}`;
    $(".s").innerHTML = sched ? `Restarts ${dayWord(s.scheduledAt)} at <b>${clock(s.scheduledAt)}</b> — about 5 seconds, your work is saved.`
      : ready ? `You have <b>${have(s.current) || "an older version"}</b>. Restarting takes about 5 seconds.` : (s.why || "Download the new version to update.");
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
