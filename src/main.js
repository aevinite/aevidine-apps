// Aevidine for Windows, Mac and Linux (owner, 2026-11-13 — docs/APPS-EVERYWHERE.md, P3).
//
// A window around the live site, nothing more: the restaurant app IS the website, so a website release reaches this app
// at once, and this shell only changes when a desktop feature does. Electron carries Chrome's own engine, so printing
// (KOTs, bills), downloads, alerts and offline work exactly as they do in Chrome.
//
// What the shell adds:
//   · one window, remembered size; a second launch focuses it (single instance)
//   · only our site opens inside; any other address opens in the normal browser
//   · Google sign-in in the normal browser (Google refuses embedded windows), handed back to the app with the same
//     one-time, two-minute PKCE code the Android app uses (lib/appHandoff.ts) through the aevidine:// address
//   · downloads go straight to Downloads, with a notification
//   · "Update now": Windows and Linux update themselves (electron-updater, from the public binaries repo); the Mac
//     copy cannot replace itself without an Apple account, so it opens the new download instead
"use strict";
const { app, BrowserWindow, Menu, Notification, dialog, shell, session } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const SITE = (process.env.AEVI_SITE || readSite() || "https://aevinite.shop").replace(/\/+$/, "");
const SITE_ORIGIN = new URL(SITE).origin;
const SCHEME = /(^|\.)test\.aevinite\.shop$/.test(new URL(SITE).hostname) ? "aevidine-test" : "aevidine";
const START = `${SITE}/login`;

function readSite() {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, "site.json"), "utf8")).site; } catch { return null; }
}

let win = null;
let pendingHandoff = null; // an aevidine://handoff?… that arrived before the window existed

// ── one copy at a time; the sign-in hand-back arrives as a second launch on Windows/Linux ─────────────────────────────
if (!app.requestSingleInstanceLock()) { app.quit(); }
else {
  app.on("second-instance", (_e, argv) => {
    const link = argv.find((a) => a.startsWith(`${SCHEME}://`));
    if (link) handleLink(link);
    if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  });
}
// macOS hands the address to the running app instead.
app.on("open-url", (e, url) => { e.preventDefault(); handleLink(url); });
if (process.defaultApp && process.argv.length >= 2) app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
else app.setAsDefaultProtocolClient(SCHEME);

function handleLink(url) {
  let u;
  try { u = new URL(url); } catch { return; }
  if (u.protocol !== `${SCHEME}:` || u.hostname !== "handoff") return;
  if (!win) { pendingHandoff = url; return; }
  // The claim page opens the code with the secret this window kept (public/app-claim.html).
  win.loadURL(`${SITE}/app-claim.html#${u.searchParams.toString()}`);
}

// ── window ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const STATE_FILE = () => path.join(app.getPath("userData"), "window.json");
function loadState() { try { return JSON.parse(fs.readFileSync(STATE_FILE(), "utf8")); } catch { return {}; } }
function saveState() {
  if (!win || win.isDestroyed()) return;
  try { fs.writeFileSync(STATE_FILE(), JSON.stringify({ ...win.getNormalBounds(), max: win.isMaximized() })); } catch { /* next time */ }
}

const ours = (url) => { try { return new URL(url).origin === SITE_ORIGIN; } catch { return false; } };

function createWindow() {
  const st = loadState();
  win = new BrowserWindow({
    width: st.width || 1280, height: st.height || 820, x: st.x, y: st.y, minWidth: 360, minHeight: 500,
    title: "Aevidine", backgroundColor: "#0D1017", show: false, autoHideMenuBar: true,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  if (st.max) win.maximize();
  win.once("ready-to-show", () => win.show());
  win.on("close", saveState);
  win.on("closed", () => { win = null; });

  const wc = win.webContents;
  // Our pages stay inside; anything else (a payment page, a map, a help link) opens in the normal browser.
  wc.on("will-navigate", (e, url) => { if (!ours(url)) { e.preventDefault(); openOutside(url); } });
  wc.setWindowOpenHandler(({ url }) => {
    // The app's print and report windows (about:blank, or our own pages) open as real child windows, like in Chrome.
    if (url === "about:blank" || ours(url)) {
      return { action: "allow", overrideBrowserWindowOptions: { parent: win, autoHideMenuBar: true, backgroundColor: "#ffffff",
        webPreferences: { preload: path.join(__dirname, "preload.js"), contextIsolation: true, sandbox: true } } };
    }
    openOutside(url);
    return { action: "deny" };
  });
  wc.on("did-fail-load", (_e, code, _d, url, isMain) => {
    // No internet and nothing saved yet: say so plainly instead of a blank window.
    if (isMain && code !== -3) wc.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(offlinePage(url))}`);
  });
  win.loadURL(START, { userAgent: `${wc.getUserAgent().replace(/ Electron\/\S+/, "").replace(/ aevidine-desktop\/\S+/, "")} AevidineDesktop/${app.getVersion()}` });
  if (pendingHandoff) { const l = pendingHandoff; pendingHandoff = null; wc.once("did-finish-load", () => handleLink(l)); }
}

function openOutside(url) {
  try { const u = new URL(url); if (u.protocol === "https:" || u.protocol === "http:" || u.protocol === "mailto:" || u.protocol === "tel:") shell.openExternal(url); } catch { /* not an address */ }
}

function offlinePage(url) {
  const safe = String(url).replace(/[<>"&]/g, "");
  return `<!doctype html><meta charset="utf-8"><title>Aevidine</title><body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#0D1017;color:#fff;font:16px/1.5 system-ui,sans-serif"><main style="max-width:420px;padding:24px;text-align:center"><h2 style="margin:0 0 8px">No internet</h2><p style="opacity:.8">Aevidine couldn't reach the restaurant's system. Check the Wi-Fi or cable, then try again.</p><button onclick="location.href='${safe}'" style="border:0;border-radius:10px;padding:10px 18px;font:600 15px system-ui">Try again</button></main>`;
}

// ── downloads: straight to Downloads, then say where ─────────────────────────────────────────────────────────────────
function setupDownloads() {
  session.defaultSession.on("will-download", (_e, item) => {
    const dir = app.getPath("downloads");
    let name = item.getFilename() || "download";
    let target = path.join(dir, name), n = 1;
    const ext = path.extname(name), base = path.basename(name, ext);
    while (fs.existsSync(target)) target = path.join(dir, `${base} (${n++})${ext}`);
    item.setSavePath(target);
    item.once("done", (_ev, state) => {
      if (state !== "completed") return;
      const note = new Notification({ title: "Saved to Downloads", body: path.basename(target) });
      note.on("click", () => shell.showItemInFolder(target));
      note.show();
    });
  });
}

// ── the menu: only what a restaurant needs (copy/paste keys, zoom, reload) ───────────────────────────────────────────
function setupMenu() {
  const isMac = process.platform === "darwin";
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ role: "appMenu" }] : []),
    { label: "File", submenu: [{ label: "Print…", accelerator: "CmdOrCtrl+P", click: () => win && win.webContents.print({}) }, { type: "separator" }, isMac ? { role: "close" } : { role: "quit" }] },
    { role: "editMenu" },
    { label: "View", submenu: [{ role: "reload" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }] },
    { label: "Help", submenu: [
      { label: "Check for updates", click: () => checkForUpdates(true) },
      { label: "Aevidine website", click: () => shell.openExternal("https://aevidine.aevinite.com") },
    ] },
  ]));
}

// ── "Update now" ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Windows (direct download) and Linux AppImage: electron-updater fetches the new version from the public binaries repo,
// then offers "Restart". Mac, the .deb, and a Microsoft Store copy: /app/latest.json says what's newest and the button
// opens the right place (the new .dmg; the Store updates its own copy by itself).
const newer = (a, b) => {
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; }
  return false;
};
function selfUpdating() {
  if (process.windowsStore) return false;                        // the Store updates it
  if (process.platform === "win32") return true;                 // NSIS install
  if (process.platform === "linux") return !!process.env.APPIMAGE;
  return false;                                                  // Mac without an Apple account
}
async function checkForUpdates(byHand) {
  if (!app.isPackaged) { if (byHand) dialog.showMessageBox(win, { message: "Updates are checked only in the installed app." }); return; }
  if (process.windowsStore) { if (byHand) dialog.showMessageBox(win, { message: "The Microsoft Store keeps Aevidine up to date by itself." }); return; }
  if (selfUpdating()) {
    try {
      const { autoUpdater } = require("electron-updater");
      autoUpdater.autoDownload = true;
      autoUpdater.once("update-downloaded", async (info) => {
        const r = await dialog.showMessageBox(win, { type: "info", buttons: ["Restart now", "Later"], defaultId: 0,
          message: `Aevidine ${info.version} is ready.`, detail: "Restart to finish updating. Nothing you were doing is lost — it is all saved on the server." });
        if (r.response === 0) autoUpdater.quitAndInstall();
      });
      const res = await autoUpdater.checkForUpdates();
      if (byHand && (!res || !res.isUpdateAvailable)) dialog.showMessageBox(win, { message: "Aevidine is up to date." });
    } catch { if (byHand) dialog.showMessageBox(win, { message: "Couldn't check for updates. Check the internet and try again." }); }
    return;
  }
  try {
    const r = await fetch(`${SITE}/app/latest.json`, { cache: "no-store" });
    const j = await r.json();
    const plat = process.platform === "darwin" ? j.mac : j.linux;
    if (plat && plat.version && newer(plat.version, app.getVersion())) {
      const link = process.platform === "darwin" ? (process.arch === "arm64" ? plat.dmg : plat.dmgIntel || plat.dmg) : plat.deb || plat.appimage;
      const res = await dialog.showMessageBox(win, { type: "info", buttons: ["Update now", "Later"], defaultId: 0,
        message: `Aevidine ${plat.version} is out.`, detail: process.platform === "darwin"
          ? "Update now downloads it. Open the file and drag Aevidine into Applications, replacing the old one." : "Update now downloads the new version." });
      if (res.response === 0 && link) shell.openExternal(link);
    } else if (byHand) dialog.showMessageBox(win, { message: "Aevidine is up to date." });
  } catch { if (byHand) dialog.showMessageBox(win, { message: "Couldn't check for updates. Check the internet and try again." }); }
}

app.whenReady().then(() => {
  setupDownloads();
  setupMenu();
  createWindow();
  const link = process.argv.find((a) => a.startsWith(`${SCHEME}://`));
  if (link) handleLink(link);
  setTimeout(() => checkForUpdates(false), 20_000);
  setInterval(() => checkForUpdates(false), 6 * 3600 * 1000);
  app.on("activate", () => { if (!win) createWindow(); });
});
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });

// Only the app's own ipc: the page may ask to open the Google sign-in in the browser — for our site's addresses only.
const { ipcMain } = require("electron");
ipcMain.handle("aevi:open-auth", (_e, url) => {
  if (typeof url === "string" && ours(url)) { shell.openExternal(url); return true; }
  return false;
});
ipcMain.handle("aevi:info", () => ({ version: app.getVersion(), platform: process.platform, scheme: SCHEME, store: !!process.windowsStore }));
