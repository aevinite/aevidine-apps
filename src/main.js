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
//   · updates inside the app on every computer: a bar says "1.0.N is ready — Restart to update" (updater.js)
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

// Tests only (desktop/tools/update-test.mjs): a profile folder of its own, so a test never meets — or blocks — the
// copy of the app someone has open.
if (process.env.AEVI_USER_DATA) app.setPath("userData", process.env.AEVI_USER_DATA);

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
  win.once("ready-to-show", () => { if (process.env.AEVI_UPDATE_TEST_HIDDEN !== "1") win.show(); });
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
  wc.on("did-finish-load", () => updater.resend());
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
      updater.ready
        ? { label: `Restart to update (${updater.version})`, click: () => updater.install() }
        : { label: "Check for updates", click: () => updater.check(true) },
      { label: "Aevidine website", click: () => shell.openExternal("https://aevidine.aevinite.com") },
    ] },
  ]));
}

// ── updates inside the app (updater.js — the same file in Campus Conveyance's desktop app) ─────────────────────────
// OBITUARY (2026-11-13): the Mac "Update now" used to open the new .dmg for the person to drag into Applications, and
// Windows asked with a pop-up. One in-window bar now does it everywhere (owner: "updates inside the app, like VS Code").
const updater = require("./updater")({
  getWindow: () => win,
  repo: "aevinite/aevidine-apps",
  appName: "Aevidine",
  downloadPage: "https://aevidine.aevinite.com/download/",
});
updater.onMenu(() => setupMenu());

app.whenReady().then(() => {
  setupDownloads();
  setupMenu();
  createWindow();
  const link = process.argv.find((a) => a.startsWith(`${SCHEME}://`));
  if (link) handleLink(link);
  setTimeout(() => updater.check(false), process.env.AEVI_UPDATE_FEED ? 3_000 : 20_000);
  setInterval(() => updater.check(false), 6 * 3600 * 1000);
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
