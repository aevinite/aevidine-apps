// Aevidine desktop — the page side (runs before the site's own scripts, in its own isolated world).
//
// Two jobs: the update bar (at the end of this file), and "Continue with Google". Google refuses its sign-in page inside an app's window, so the click opens it in the
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

// ── the update bar (updater.js sends its state; this draws it at the bottom of the window) ───────────────────────────
// In its own shadow root, so the site's styles can't change it and it can't change the site.
if (window === window.top) {
  let host = null, last = null;
  const draw = (s) => {
    last = s;
    const show = s && !s.dismissed && (s.phase === "downloading" || s.phase === "ready" || s.phase === "manual");
    if (!show) { if (host) host.remove(); host = null; return; }
    if (!document.body) { document.addEventListener("DOMContentLoaded", () => draw(last), { once: true }); return; }
    if (!host || !host.isConnected) {
      host = document.createElement("div");
      host.setAttribute("data-aevi-update", "");
      host.attachShadow({ mode: "open" });
      document.body.appendChild(host);
    }
    const name = s.appName || "The app";
    const text = s.phase === "downloading" ? `Downloading ${name} ${s.version || ""}… ${s.percent || 0}%`
      : s.phase === "ready" ? `${name} ${s.version} is ready.` : `${name} ${s.version} is out. ${s.why || ""}`;
    const btn = s.phase === "ready" ? `<button id="go">Restart to update</button>` : s.phase === "manual" ? `<button id="dl">Download</button>` : "";
    host.shadowRoot.innerHTML = `<style>
      .b{position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:12px;
         background:#111827;color:#fff;font:500 14px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;padding:10px 10px 10px 16px;
         border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.35);max-width:calc(100vw - 32px)}
      button{border:0;border-radius:8px;padding:8px 14px;font:600 14px system-ui,-apple-system,Segoe UI,sans-serif;cursor:pointer}
      #go,#dl{background:#fff;color:#111827} #later{background:transparent;color:#fff;padding:6px 8px}</style>
      <div class="b" role="status"><span>${text}</span>${btn}${s.phase === "downloading" ? "" : `<button id="later" aria-label="Later">Later</button>`}</div>`;
    const r = host.shadowRoot;
    r.getElementById("go") && r.getElementById("go").addEventListener("click", () => ipcRenderer.invoke("aevi:update-install"));
    r.getElementById("dl") && r.getElementById("dl").addEventListener("click", () => ipcRenderer.invoke("aevi:update-open-download"));
    r.getElementById("later") && r.getElementById("later").addEventListener("click", () => ipcRenderer.invoke("aevi:update-later"));
  };
  ipcRenderer.on("aevi:update", (_e, s) => draw(s));
  ipcRenderer.invoke("aevi:update-state").then(draw).catch(() => {});
}
