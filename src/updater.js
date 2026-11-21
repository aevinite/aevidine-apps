// Updates INSIDE the app (owner, 2026-11-13: "updates should come inside the app, like VS Code — no other apps").
//
// One flow on every computer: the app looks for a newer version (at start, every 6 hours, and on Help → Check for
// updates), downloads it in the background, then a pill at the top right of the window says "Aevidine 2.N is ready —
// Restart" (preload.js). One click: the app closes, the new version takes its place, and it opens again. Or Later /
// Schedule (below).
//
//   · Windows (direct download) and Linux AppImage — electron-updater, from the public binaries repo (latest.yml).
//   · Mac — our own updater: electron-updater's Mac path needs an Apple Developer ID, we sign ad-hoc. It downloads the
//     new version's .zip named in latest-mac.yml, checks its SHA-512 and its signature, and swaps the app in place.
//     A file the app downloads itself carries no "downloaded from the internet" mark, so macOS opens it without asking.
//     If the app can't replace itself (run from the disk image, or a folder this user can't write), the bar says so.
//   · Microsoft Store copy — the Store updates it; nothing here. Linux .deb — the bar offers the new download.
//
// Tests only: AEVI_UPDATE_FEED=<url> reads latest*.yml and the files from there instead of GitHub, and
// AEVI_UPDATE_AUTO=1 restarts into the update without waiting for the click, AEVI_UPDATE_NO_RELAUNCH=1 doesn't open
// the new version afterwards, AEVI_UPDATE_TEST_HIDDEN=1 keeps the window hidden, AEVI_USER_DATA=<dir> uses its own
// profile (desktop/tools/update-test.mjs).
// This file is the same in Campus Conveyance's desktop app (campus_conveyance desktop/updater.js) — change both.
"use strict";
const { app, ipcMain, Menu, dialog, shell, nativeImage } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { spawn, spawnSync } = require("node:child_process");

const newer = (a, b) => {
  const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) { if ((x[i] || 0) > (y[i] || 0)) return true; if ((x[i] || 0) < (y[i] || 0)) return false; }
  return false;
};

/** The few fields of electron-builder's latest*.yml we need: version, and each file's url / sha512. */
function parseYml(text) {
  const version = (text.match(/^version:\s*['"]?([^'"\n]+)/m) || [])[1] || null;
  const files = [];
  for (const m of text.matchAll(/-\s+url:\s*['"]?([^'"\n]+)['"]?\s*\n\s+sha512:\s*['"]?([^'"\n]+)/g)) files.push({ url: m[1].trim(), sha512: m[2].trim() });
  return { version, files };
}

module.exports = function createUpdater({ getWindow, repo, appName, downloadPage }) {
  const FEED = (process.env.AEVI_UPDATE_FEED || "").replace(/\/+$/, "");
  const AUTO = process.env.AEVI_UPDATE_AUTO === "1";
  const NO_RELAUNCH = process.env.AEVI_UPDATE_NO_RELAUNCH === "1";
  const base = FEED || `https://github.com/${repo}/releases/latest/download`;
  let state = { phase: "idle" };        // idle | checking | downloading | ready | manual | none | error
  let busy = false;
  let macReady = null;                  // { app: path of the new .app } once downloaded and checked

  const send = () => { const w = getWindow(); if (w && !w.isDestroyed()) w.webContents.send("aevi:update", { ...state, appName, current: app.getVersion() }); };
  const set = (s) => { state = s; send(); refreshMenu(); badge(s.phase === "ready" || s.phase === "manual"); };
  // THE RED DOT ON THE APP'S OWN ICON (owner, 2026-11-21: "it should show like notification, red dot, that something is
  // there"): on the Mac's Dock, the Windows taskbar, and Linux docks that show counts — while an update waits.
  let badged = null;
  const DOT = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAACXBIWXMAAAsTAAALEwEAmpwYAAACN0lEQVRYw9VXy0rDQBTVCnVT/QP7HYJUUXTncyG1LW6KuPexEq3+ga9PsLbubAXxUb/CglqfKChd2GAJ9AXteG+YidNpmpg0sThwIMnczD0z9zH3dnT8t0EI6QUMAkKAJYog/dbjlNJuwALgDFAizUeJyqCs2w7FnYBZwCMxP94Ai4Auq8p7ACcNy9ZqpHJ7RwrnF0SOHynA58pdRpnTGEnTpoEfvIA0v0r1M0e+tndJdnyKvPcPaALnUKaay4kkcC2vmZ2n+R3L0UPyMTzaVLEIlJWjMfFE0oYnAQIu/thr5TKR1iO/VixC2thU1uBGAv1Kj8A8v3MpsmVZuUpibV08iYBeqL0wKfkg2rJyBvkwzhN40gxRGruqw5mxuaFPjIyRqiTxJMJaBM7YLHqyXcoZ8rv7PIFTLc8vMdtnJ2dsJ5CdmOZ9oVQXEfAyxGYqN7e2K2dQktXPGOQJBNlXzGpOEShcpngCczyBVdX7IYE4RUCIhhWewIpKAIQcIxCrI7DMEwioJri4dM4EqSuegL/dTujjCXgAxbaFoZiI8jt79ieiPZ1E1JCKc+1JxXgZPTsRjlg1GV5GlEToD65jv1FBkqwrSFoggf8KBcmxbkHStCSDBIJ2NGNz5djrd36N0Wa9KAUnwitVL0RxDmUEh2PK+6yU5QnNsjyTUS4WtSyH58r9fbOy/PjXO9dpTB4sNCavtDFx2dEhuTF2MYEYtGZFKhO2pTXTMY2PXmCsOQ3Qb55/121/A7bTWsRHyDFjAAAAAElFTkSuQmCC";
  function badge(on) {
    if (on === badged) return;
    badged = on;
    try {
      if (process.platform === "darwin" && app.dock) app.dock.setBadge(on ? "•" : "");
      else if (process.platform === "win32") {
        const w = getWindow();
        if (w && !w.isDestroyed()) w.setOverlayIcon(on ? nativeImage.createFromDataURL(DOT) : null, on ? "Update ready" : "");
      } else app.setBadgeCount(on ? 1 : 0);
    } catch { /* a dock that shows no badges */ }
  }
  let refreshMenu = () => {};

  const kind = () => {
    if (process.windowsStore) return "store";
    if (process.platform === "darwin") return "mac";
    if (process.platform === "win32") return "updater";
    if (process.platform === "linux") return process.env.APPIMAGE ? "updater" : "deb";
    return "none";
  };

  // ── Windows + Linux AppImage: electron-updater ────────────────────────────────────────────────────────────────────
  let eu = null;
  function electronUpdater() {
    if (eu) return eu;
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    if (FEED) autoUpdater.setFeedURL({ provider: "generic", url: FEED });
    autoUpdater.on("update-available", (i) => set({ phase: "downloading", version: i.version, percent: 0 }));
    autoUpdater.on("download-progress", (p) => set({ ...state, phase: "downloading", percent: Math.round(p.percent || 0) }));
    autoUpdater.on("update-downloaded", (i) => { set({ phase: "ready", version: i.version }); if (AUTO) install(); });
    autoUpdater.on("update-not-available", () => set({ phase: "none" }));
    autoUpdater.on("error", (e) => set({ phase: "error", message: String(e && e.message || e).slice(0, 200) }));
    eu = autoUpdater;
    return eu;
  }

  // ── Mac: download, check, swap ────────────────────────────────────────────────────────────────────────────────────
  const currentApp = () => path.resolve(process.execPath, "..", "..", "..");   // …/Aevidine.app/Contents/MacOS/Aevidine
  function canReplaceSelf() {
    const cur = currentApp();
    if (!cur.endsWith(".app") || cur.startsWith("/Volumes/")) return false;     // run from the disk image
    try { fs.accessSync(path.dirname(cur), fs.constants.W_OK); fs.accessSync(cur, fs.constants.W_OK); return true; } catch { return false; }
  }
  async function macCheck() {
    const r = await fetch(`${base}/latest-mac.yml`, { cache: "no-store" });
    if (!r.ok) throw new Error(`latest-mac.yml: ${r.status}`);
    const { version, files } = parseYml(await r.text());
    if (!version || !newer(version, app.getVersion())) { set({ phase: "none" }); return; }
    const arch = process.arch === "arm64" ? "arm64" : "x64";
    const zip = files.find((f) => f.url.endsWith(`-${arch}.zip`)) || files.find((f) => f.url.endsWith(".zip") && !/arm64/.test(f.url) && arch === "x64");
    if (!zip) throw new Error(`no ${arch} zip in latest-mac.yml`);
    if (!canReplaceSelf()) { set({ phase: "manual", version, why: `Move ${appName} into Applications to get updates inside the app.` }); return; }
    set({ phase: "downloading", version, percent: 0 });
    const dir = fs.mkdtempSync(path.join(app.getPath("temp"), "aevi-update-"));
    const zipPath = path.join(dir, "update.zip");
    const url = /^https?:/.test(zip.url) ? zip.url : `${base}/${zip.url}`;
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`download: ${res.status}`);
    const total = Number(res.headers.get("content-length")) || 0;
    const hash = crypto.createHash("sha512");
    const out = fs.createWriteStream(zipPath);
    let got = 0, lastPct = -1;
    for await (const chunk of res.body) {
      hash.update(chunk); out.write(chunk); got += chunk.length;
      const pct = total ? Math.floor((got / total) * 100) : 0;
      if (pct !== lastPct && pct % 5 === 0) { lastPct = pct; set({ phase: "downloading", version, percent: pct }); }
    }
    await new Promise((ok, bad) => { out.end(ok); out.on("error", bad); });
    if (hash.digest("base64") !== zip.sha512) throw new Error("the download does not match its fingerprint");
    const unpack = path.join(dir, "app");
    fs.mkdirSync(unpack);
    if (spawnSync("ditto", ["-x", "-k", zipPath, unpack]).status !== 0) throw new Error("could not unpack the update");
    const newApp = fs.readdirSync(unpack).find((f) => f.endsWith(".app"));
    if (!newApp) throw new Error("the update holds no app");
    const full = path.join(unpack, newApp);
    if (spawnSync("codesign", ["--verify", "--deep", "--strict", full]).status !== 0) throw new Error("the update's signature is broken");
    fs.rmSync(zipPath, { force: true });
    macReady = { app: full, dir };
    set({ phase: "ready", version });
    if (AUTO) install();
  }
  function macInstall() {
    if (!macReady) return;
    const cur = currentApp();
    // After this app has quit: move the old one aside, put the new one in its place (put the old one back if that
    // fails), then open it. A plain shell script, started detached, so it outlives this process.
    const script = `
      while kill -0 ${process.pid} 2>/dev/null; do sleep 0.2; done
      OLD="$1"; NEW="$2"; TMP="$3"
      if mv "$OLD" "$OLD.updating" && mv "$NEW" "$OLD"; then rm -rf "$OLD.updating"; else [ -d "$OLD" ] || mv "$OLD.updating" "$OLD"; fi
      # THE DOCK SHOWS THE NEW ICON (owner, 2026-11-21: "after restart, it shows the old logo"): macOS keeps a picture of
      # each app's icon and does not always notice that the app was swapped. A fresh date on the app and a re-register with
      # Launch Services make it read the new one when the app opens.
      touch "$OLD"; /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$OLD" >/dev/null 2>&1
      rm -rf "$TMP"
      [ "$4" = "norelaunch" ] || open "$OLD"`;
    spawn("/bin/sh", ["-c", script, "sh", cur, macReady.app, macReady.dir, NO_RELAUNCH ? "norelaunch" : ""], { detached: true, stdio: "ignore" }).unref();
    app.quit();
  }

  // ── one entry point for every computer ───────────────────────────────────────────────────────────────────────────
  async function check(byHand) {
    if (!app.isPackaged && !FEED) { if (byHand) dialog.showMessageBox(getWindow(), { message: "Updates are checked only in the installed app." }); return; }
    const k = kind();
    if (k === "store") { if (byHand) dialog.showMessageBox(getWindow(), { message: "The Microsoft Store keeps this app up to date by itself." }); return; }
    if (state.phase === "ready") { send(); return; }
    if (busy) return;
    busy = true;
    try {
      if (byHand) set({ phase: "checking" });
      if (k === "mac") await macCheck();
      else if (k === "updater") await electronUpdater().checkForUpdates();
      else if (k === "deb") {
        const r = await fetch(`${base}/latest-linux.yml`, { cache: "no-store" });
        const { version } = parseYml(r.ok ? await r.text() : "");
        set(version && newer(version, app.getVersion()) ? { phase: "manual", version, why: "Download the new version to update." } : { phase: "none" });
      }
      if (byHand && state.phase === "none") dialog.showMessageBox(getWindow(), { message: `${appName} is up to date (${app.getVersion()}).` });
    } catch (e) {
      set({ phase: "error", message: String(e && e.message || e).slice(0, 200) });
      if (byHand) dialog.showMessageBox(getWindow(), { message: "Couldn't check for updates. Check the internet and try again." });
    } finally { busy = false; }
  }
  function install() {
    if (state.phase !== "ready") return;
    if (kind() === "mac") macInstall();
    else electronUpdater().quitAndInstall(true, !NO_RELAUNCH);      // silent install, then open the new version
  }

  // ── Later and Schedule (owner, 2026-11-20: the pill "should have later and schedule option where it can remind you
  // later or at a particular schedule time") ─────────────────────────────────────────────────────────────────────
  //   later(ms)      the pill goes away and comes back after ms (1 hour, 4 hours, tomorrow 9 AM — the window picks)
  //   schedule(at)   restart into the update at that time; one minute before, the pill counts down with "Not now"
  //   unschedule()   back to plain "ready"
  // Both live while the app runs: quit it and the next start checks again and asks again (Windows also installs a
  // downloaded update on quit by itself). Nothing restarts without the person having picked it.
  let laterTimer = null, schedTimer = null, warnTimer = null;
  const clearTimers = () => { clearTimeout(laterTimer); clearTimeout(schedTimer); clearTimeout(warnTimer); };
  function later(ms) {
    clearTimers();
    const wait = Math.max(60_000, Math.min(Number(ms) || 3600_000, 48 * 3600_000));
    set({ ...state, dismissed: true, remindAt: Date.now() + wait, scheduledAt: null, countdown: false });
    laterTimer = setTimeout(() => set({ ...state, dismissed: false, remindAt: null }), wait);
  }
  function schedule(at) {
    const when = Number(at) || 0;
    if (state.phase !== "ready" || when < Date.now() + 60_000 || when > Date.now() + 48 * 3600_000) return false;
    clearTimers();
    set({ ...state, dismissed: false, remindAt: null, scheduledAt: when, countdown: false });
    warnTimer = setTimeout(() => set({ ...state, countdown: true }), when - Date.now() - 60_000);
    schedTimer = setTimeout(() => install(), when - Date.now());
    return true;
  }
  function unschedule() { clearTimers(); set({ ...state, dismissed: false, remindAt: null, scheduledAt: null, countdown: false }); }

  ipcMain.handle("aevi:update-install", () => { install(); return true; });
  ipcMain.handle("aevi:update-later", (_e, ms) => { later(ms); return true; });
  ipcMain.handle("aevi:update-schedule", (_e, at) => schedule(at));
  ipcMain.handle("aevi:update-unschedule", () => { unschedule(); return true; });
  ipcMain.handle("aevi:update-open-download", () => { shell.openExternal(downloadPage); return true; });
  ipcMain.handle("aevi:update-state", () => ({ ...state, appName, current: app.getVersion() }));

  return {
    check,
    install,
    /** The window loaded a page: show it the current state (the bar survives navigation). */
    resend: send,
    /** Lets the app menu show "Restart to update" while an update is ready. */
    onMenu(fn) { refreshMenu = fn; },
    get ready() { return state.phase === "ready"; },
    get version() { return state.version; },
  };
};
