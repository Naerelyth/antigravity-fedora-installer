"use strict";
// Run using an isolated Electron runtime, never the installed application's profile.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { app, BaseWindow, WebContentsView, ipcMain, nativeTheme } = require("electron");
const { startupColors } = require("../tools/startup-appearance/payload");
const { createWindowControlsRuntime } = require("../tools/window-controls/payload/windowControls");
if (!process.env.APPEARANCE_TEST_ASAR || !process.env.APPEARANCE_TEST_PROFILE) throw new Error("Explicit test ASAR and temporary profile required");
app.setPath("userData", process.env.APPEARANCE_TEST_PROFILE);
app.on("window-all-closed", () => {});
setTimeout(() => { console.error("Electron appearance test timed out"); app.exit(1); }, 15000).unref();
process.on("uncaughtException", error => { console.error(error); app.exit(1); });
// Isolate the loading module from the app's unrelated service dependencies.
require.cache[process.env.APPEARANCE_TEST_ASAR + "/dist/utils.js"] = { exports: { getHubWebContents: win => win.webContents } };
const { attachLoadingOverlay } = require(process.env.APPEARANCE_TEST_ASAR + "/dist/loadingOverlay.js");
const { prepareWindowCorners } = require(process.env.APPEARANCE_TEST_ASAR + "/dist/startupAppearance.js");
function createTestWindow(options) {
    const { webPreferences, ...windowOptions } = options;
    const win = new BaseWindow(windowOptions);
    const curtain = new WebContentsView();
    const hub = new WebContentsView({ webPreferences: webPreferences || {} });
    win.contentView.addChildView(curtain);
    win.contentView.addChildView(hub);
    win.cornerRadii = [];
    [curtain, hub].forEach((view, index) => {
        const setRadius = view.setBorderRadius.bind(view);
        view.setBorderRadius = radius => { win.cornerRadii[index] = radius; setRadius(radius); };
    });
    prepareWindowCorners(win, [curtain, hub]);
    assert.deepEqual(win.cornerRadii, [8, 8]);
    curtain.setBackgroundColor(options.backgroundColor || "#101010");
    void curtain.webContents.loadURL("data:text/html,<body style='background:%23101010'></body>");
    Object.defineProperty(win, "webContents", { get: () => hub.webContents });
    win.loadURL = url => hub.webContents.loadURL(url);
    const layout = () => { const { width, height } = win.contentView.getBounds(); for (const view of [curtain, hub]) view.setBounds({ x: 0, y: 0, width, height }); };
    win.contentView.on("bounds-changed", layout); layout();
    const contents = [curtain.webContents, hub.webContents];
    win.once("closed", () => { for (const entry of contents) if (!entry.isDestroyed()) entry.close(); });
    return win;
}
const settleLayout = () => new Promise(resolve => setTimeout(resolve, 350));
async function assertLoadingCentered(win, view) {
    const { width, height } = win.contentView.getBounds();
    assert.deepEqual(view.getBounds(), { x: 0, y: 0, width, height }, "loading view must fill the laid-out content view");
    const center = await view.webContents.executeJavaScript(`(() => {
        const r = document.querySelector('.logo').getBoundingClientRect();
        return [r.x + r.width / 2, r.y + r.height / 2];
    })()`);
    // CSS coordinates -> native DIP, not devicePixelRatio (physical pixels).
    const zoom = view.webContents.getZoomFactor();
    assert.ok(Math.abs(center[0] * zoom - width / 2) <= 1, `logo center X: ${center[0] * zoom}, expected ${width / 2}`);
    assert.ok(Math.abs(center[1] * zoom - height / 2) <= 1, `logo center Y: ${center[1] * zoom}, expected ${height / 2}`);
}
async function closeTestWindow(win) {
    const closed = new Promise(resolve => win.once("closed", resolve));
    win.close();
    await closed;
    // Give delayed destruction/closed callbacks a chance to surface errors.
    await new Promise(resolve => setTimeout(resolve, 50));
}
app.whenReady().then(async () => {
    const runtime = createWindowControlsRuntime(require("electron"));
    const messages = [];
    ipcMain.handle("window:set-title-bar-overlay", (event, options) => {
        messages.push(options);
        runtime.updateWindowControls(BaseWindow.getAllWindows().find(win => win.webContents === event.sender), options);
    });
    const settingsPath = process.env.APPEARANCE_TEST_PROFILE + "/loading-theme.json";
    fs.writeFileSync(settingsPath, JSON.stringify({ userSettings: { themeMode: "INHERIT",
        customThemeSeedsLight: { background: "#faf4e5", foregroundOverride: "#435155" },
        customThemeSeedsDark: { background: "#24273a", foregroundOverride: "#cad3f5" } } }));
    const themeWin = createTestWindow({ show: true, width: 640, height: 480, title: "Startup theme regression",
        backgroundColor: "#24273a", titleBarStyle: "hidden", titleBarOverlay: runtime.createTitleBarOverlay() });
    let overlay; const setOverlay = themeWin.setTitleBarOverlay.bind(themeWin);
    themeWin.setTitleBarOverlay = options => { overlay = options; setOverlay(options); };
    runtime.installWindowControls(themeWin, { symbolColor: "#cad3f5", shouldFollowSystemTheme: () => true });
    attachLoadingOverlay(themeWin, "#cad3f5", "#24273a", { nativeTheme, settingsPath,
        updateControls: colors => runtime.updateWindowControls(themeWin, { symbolColor: colors.foregroundColor }) });
    const themeView = themeWin.contentView.children.at(-1);
    await new Promise(resolve => themeView.webContents.once("did-finish-load", resolve));
    const originalThemeSource = nativeTheme.themeSource;
    for (const [source, bg, fg] of [["light", "rgb(250, 244, 229)", "#435155"], ["dark", "rgb(36, 39, 58)", "#cad3f5"], ["light", "rgb(250, 244, 229)", "#435155"]]) {
        nativeTheme.themeSource = source;
        // Explicitly deliver the initial state too if this was already the OS theme.
        nativeTheme.emit("updated");
        await settleLayout();
        assert.equal(await themeView.webContents.executeJavaScript("getComputedStyle(document.body).backgroundColor"), bg);
        assert.equal(overlay.symbolColor, fg); assert.equal(overlay.color, "#00000000");
        assert.ok(!themeView.webContents.isDestroyed());
    }
    // Handoff must follow the latest light palette, not its initial dark target.
    await themeWin.loadURL("data:text/html," + encodeURIComponent('<body style="background:#faf4e5"><div data-testid="title-menu-bar"></div></body>'));
    const handoffDeadline = Date.now() + 2000;
    while (themeView.webContents && Date.now() < handoffDeadline) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(themeView.webContents, undefined);
    await closeTestWindow(themeWin);
    nativeTheme.themeSource = originalThemeSource;
    // Attach before the first compositor configure, just as createWindow does.
    // Run this entry with --force-device-scale-factor=1.33 as well as normally.
    for (const [width, height] of [[1024, 768], [1400, 900]]) {
        const win = createTestWindow({ show: true, width, height, title: "Startup layout regression test",
            backgroundColor: "#24273a", titleBarStyle: "hidden", titleBarOverlay: runtime.createTitleBarOverlay() });
        attachLoadingOverlay(win, "#cad3f5", "#24273a");
        const view = win.contentView.children.at(-1);
        await new Promise(resolve => view.webContents.once("did-finish-load", resolve));
        await settleLayout();
        await assertLoadingCentered(win, view);
        win.setSize(801, 601);
        await settleLayout();
        await assertLoadingCentered(win, view);
        view.webContents.setZoomFactor(1.33);
        await settleLayout();
        await assertLoadingCentered(win, view);
        view.webContents.setZoomFactor(1);
        await closeTestWindow(win);
    }
    for (const isLight of [true, false]) {
        const colors = startupColors("unused", isLight, { readFileSync: () => JSON.stringify({ userSettings: {
            customThemeSeedsLight: { background: "#FAF4E5", foregroundOverride: "#435155" },
            customThemeSeedsDark: { background: "#24273A", foregroundOverride: "#CAD3F5" },
        } }) });
        const win = createTestWindow({ show: true, width: 640, height: 480, title: "Appearance regression test",
            backgroundColor: colors.backgroundColor, titleBarStyle: "hidden",
            titleBarOverlay: runtime.createTitleBarOverlay({ color: colors.backgroundColor, symbolColor: colors.foregroundColor }) });
        runtime.installWindowControls(win, { color: colors.backgroundColor, symbolColor: colors.foregroundColor });
        await win.loadURL("data:text/html,<body style='margin:0'></body>");
        const originalChildren = win.contentView.children.length;
        attachLoadingOverlay(win, colors.foregroundColor, colors.backgroundColor);
        const view = win.contentView.children.at(-1);
        const loadingContents = view.webContents;
        await new Promise(resolve => view.webContents.once("did-finish-load", resolve));
        const actual = await view.webContents.executeJavaScript("[getComputedStyle(document.body).backgroundColor, getComputedStyle(document.body).color]");
        assert.deepEqual(actual, isLight ? ["rgb(250, 244, 229)", "rgb(67, 81, 85)"] : ["rgb(36, 39, 58)", "rgb(202, 211, 245)"]);
        assert.equal(typeof view.setBorderRadius, "function");
        assert.equal(view.getBounds().width, win.getContentSize()[0]);
        if (process.env.APPEARANCE_TEST_SCREENSHOT) {
            await new Promise(resolve => setTimeout(resolve, 150));
            fs.writeFileSync(process.env.APPEARANCE_TEST_SCREENSHOT + (isLight ? "-light.png" : "-dark.png"), (await win.capturePage()).toPNG());
        }
        const radiusCalls = [], setRadius = view.setBorderRadius.bind(view);
        view.setBorderRadius = value => { radiusCalls.push(value); setRadius(value); };
        const maximized = new Promise(resolve => win.once("maximize", resolve));
        win.maximize(); await maximized; assert.equal(radiusCalls.at(-1), 0);
        assert.deepEqual(win.cornerRadii, [0, 0]);
        await settleLayout(); await assertLoadingCentered(win, view);
        const restored = new Promise(resolve => win.once("unmaximize", resolve));
        win.unmaximize(); await restored; assert.equal(radiusCalls.at(-1), 8);
        assert.deepEqual(win.cornerRadii, [8, 8]);
        await settleLayout(); await assertLoadingCentered(win, view);
        const destroyed = new Promise(resolve => view.webContents.once("destroyed", resolve));
        await win.loadURL("data:text/html," + encodeURIComponent(`<body style="background:#101010"><div data-testid="title-menu-bar">Loaded</div></body>`));
        assert.ok(!loadingContents.isDestroyed(), "document load must not remove the custom themed loading view");
        assert.equal(win.webContents.getBackgroundThrottling(), false);
        await new Promise(resolve => setTimeout(resolve, 150));
        assert.ok(!loadingContents.isDestroyed(), "keep loading view throughout default-theme frames");
        const handoffStart = Date.now();
        await win.webContents.executeJavaScript(`document.body.style.background=${JSON.stringify(colors.backgroundColor)}`);
        await destroyed;
        assert.ok(Date.now() - handoffStart < 2000, "theme handoff must not rely on timeout fallback");
        assert.equal(win.webContents.getBackgroundThrottling(), true);
        assert.equal(win.contentView.children.length, originalChildren);
        assert.ok(loadingContents.isDestroyed());
        const mainMaximized = new Promise(resolve => win.once("maximize", resolve));
        win.maximize(); await mainMaximized; assert.deepEqual(win.cornerRadii, [0, 0]);
        const mainRestored = new Promise(resolve => win.once("unmaximize", resolve));
        win.unmaximize(); await mainRestored; assert.deepEqual(win.cornerRadii, [8, 8]);
        await closeTestWindow(win);
    }
    const win = createTestWindow({ show: true, width: 640, height: 480, title: "Titlebar regression test",
        titleBarStyle: "hidden", titleBarOverlay: runtime.createTitleBarOverlay(), webPreferences: {
            preload: process.env.APPEARANCE_TEST_ASAR + "/dist/preload.js", sandbox: true, contextIsolation: true,
        } });
    const nativeCalls = [], nativeSet = win.setTitleBarOverlay.bind(win);
    win.setTitleBarOverlay = options => { nativeCalls.push(options); nativeSet(options); };
    runtime.installWindowControls(win);
    await win.loadURL("data:text/html," + encodeURIComponent(`<html><head><style>body{margin:0}.settings-modal-backdrop{position:fixed;inset:0;z-index:5000;background:rgba(0,0,0,.3)}.settings-modal-container{position:absolute;inset:80px;background:white;box-shadow:0 25px 50px -12px rgba(0,0,0,.25)}</style></head><body><div data-testid="title-menu-bar" style="height:35px;background:#24273a"></div><div class="settings-modal-backdrop"><div class="settings-modal-container"></div></div></body></html>`));
    for (const color of ["#24273a", "#faf4e5"]) {
        await win.webContents.executeJavaScript(`document.querySelector('[data-testid="title-menu-bar"]').style.background=${JSON.stringify(color)};window.electronNative.setTitleBarOverlay({color:'#ffffff',symbolColor:'#cad3f5'})`);
        assert.equal(messages.at(-1).color, "#00000000");
        assert.equal(nativeCalls.at(-1).color, messages.at(-1).color);
        assert.equal(nativeCalls.at(-1).height, 35);
        assert.equal(await win.webContents.executeJavaScript("getComputedStyle(document.querySelector('.settings-modal-container')).boxShadow"), "none");
    }
    await closeTestWindow(win);
    console.log("PASS: native loading centering/zoom/colors/radius/lifecycle and final sandboxed preload titlebar colors/height/settings shadow");
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
