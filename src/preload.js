// Aevidine desktop — the page side (runs before the site's own scripts, in its own isolated world).
//
// One job: "Continue with Google". Google refuses its sign-in page inside an app's window, so the click opens it in the
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
