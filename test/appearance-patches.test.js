"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { EventEmitter } = require("node:events");
const vm = require("node:vm");
const { refactorAsar, readArchive, encodeAsarHeader } = require("../tools/window-controls/refactor-asar");
const { applyPatches } = require("../tools/asar-patches/apply");
const { startupColors, prepareWindowCorners, prepareLoadingView, paintedTheme, waitForPaintedTheme } = require("../tools/startup-appearance/payload");

test("handoff requires the target theme and titlebar for two consecutive frames", async () => {
    let callback, deadline, cancelled = false, marker = false;
    const body = { backgroundColor: "default" };
    const context = { clearRect() {}, fillRect() {}, getImageData() { return { data: [this.fillStyle] }; } };
    const page = {
        document: { body, createElement: () => ({ getContext: () => context }), querySelector: () => marker },
        getComputedStyle: element => element,
        requestAnimationFrame: fn => { callback = fn; return 1; }, cancelAnimationFrame: () => { cancelled = true; },
        setTimeout: fn => { deadline = fn; return 2; }, clearTimeout() {},
    };
    let result;
    const pending = paintedTheme("custom", 100, page).then(value => { result = value; });
    const frame = async () => { callback(); await Promise.resolve(); };
    await frame(); assert.equal(result, undefined);
    body.backgroundColor = "custom"; await frame(); assert.equal(result, undefined);
    marker = true; await frame(); assert.equal(result, undefined);
    body.backgroundColor = "default"; await frame(); assert.equal(result, undefined);
    body.backgroundColor = "custom"; await frame(); assert.equal(result, undefined);
    await frame(); await pending; assert.equal(result, true); assert.equal(cancelled, true);
    const fallback = paintedTheme("missing", 100, page); deadline(); assert.equal(await fallback, false);
});

test("handoff restores background throttling after success, rejection or close", async () => {
    for (const scenario of ["ready", "rejected", "closed", "unthrottled"]) {
        let destroyed = false; const calls = [];
        const contents = {
            isDestroyed: () => destroyed,
            getBackgroundThrottling: () => scenario !== "unthrottled",
            setBackgroundThrottling: value => calls.push(value),
            executeJavaScript: async () => {
                if (scenario === "closed") destroyed = true;
                if (["rejected", "closed"].includes(scenario)) throw Error("navigation/close");
                return true;
            },
        };
        const warn = console.warn;
        try { console.warn = () => {}; await waitForPaintedTheme(contents, "#123456"); }
        finally { console.warn = warn; }
        assert.deepEqual(calls, scenario === "closed" ? [false] : [false, scenario !== "unthrottled"]);
    }
});

test("startup uses the selected custom seeds, safe defaults and rejects CSS injection", () => {
    const settings = { userSettings: { customThemeSeedsDark: { background: "#24273A", foregroundOverride: "#CAD3F5" },
        customThemeSeedsLight: { background: "#FAF4E5", foregroundOverride: "#435155" } } };
    const mock = { readFileSync: () => JSON.stringify(settings) };
    assert.deepEqual(startupColors("settings", false, mock), { backgroundColor: "#24273A", foregroundColor: "#CAD3F5" });
    assert.deepEqual(startupColors("settings", true, mock), { backgroundColor: "#FAF4E5", foregroundColor: "#435155" });
    settings.userSettings.customThemeSeedsDark.background = "</style><script>bad()</script>";
    assert.equal(startupColors("settings", false, mock).backgroundColor, "#101010");
    assert.deepEqual(startupColors("settings", true, { readFileSync: () => "invalid" }), { backgroundColor: "#F9F9F9", foregroundColor: "#101010" });
});

test("loading follows system colors before and after load, respects fixed modes and removes listeners", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "startup-theme-"));
    try {
        const settingsPath = path.join(dir, "config.json"), nativeTheme = new EventEmitter();
        const settings = { userSettings: { themeMode: "INHERIT", customThemeSeedsLight: { background: "#faf4e5", foregroundOverride: "#435155" },
            customThemeSeedsDark: { background: "#24273a", foregroundOverride: "#cad3f5" } } };
        fs.writeFileSync(settingsPath, JSON.stringify(settings));
        const win = new EventEmitter(), contents = new EventEmitter(); let closed = false;
        Object.assign(win, { isMaximized: () => false, isFullScreen: () => false });
        const scripts = [], palettes = [], backgrounds = [];
        Object.assign(contents, { isDestroyed: () => closed, close: () => { closed = true; },
            executeJavaScript: async script => { scripts.push(script); } });
        const view = { webContents: contents, setBorderRadius() {}, setBackgroundColor: color => backgrounds.push(color) };
        const dispose = prepareLoadingView(win, view, "#24273a", { nativeTheme, settingsPath,
            foregroundColor: "#cad3f5", updateControls: colors => palettes.push(colors) });
        nativeTheme.shouldUseDarkColors = false; nativeTheme.emit("updated");
        assert.equal(dispose.backgroundColor, "#faf4e5"); assert.equal(scripts.length, 0);
        contents.emit("did-finish-load"); await Promise.resolve();
        assert.match(scripts.at(-1), /#faf4e5/); assert.match(scripts.at(-1), /#435155/);
        nativeTheme.shouldUseDarkColors = true; nativeTheme.emit("updated");
        assert.equal(backgrounds.at(-1), "#24273a"); assert.equal(palettes.at(-1).foregroundColor, "#cad3f5");
        assert.match(scripts.at(-1), /#24273a/);
        settings.userSettings.themeMode = "DARK"; fs.writeFileSync(settingsPath, JSON.stringify(settings));
        const calls = scripts.length; nativeTheme.shouldUseDarkColors = false; nativeTheme.emit("updated");
        assert.equal(scripts.length, calls); assert.equal(dispose.backgroundColor, "#24273a");
        dispose(); assert.equal(nativeTheme.listenerCount("updated"), 0);
        nativeTheme.emit("updated"); assert.equal(scripts.length, calls);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("theme handoff rechecks a target changed during renderer readiness", async () => {
    let color = "#24273a"; const scripts = [], throttle = [];
    await waitForPaintedTheme({ isDestroyed: () => false, getBackgroundThrottling: () => true,
        setBackgroundThrottling: value => throttle.push(value), executeJavaScript: async script => {
            scripts.push(script); if (scripts.length === 1) color = "#faf4e5"; return true;
        } }, () => color);
    assert.equal(scripts.length, 2); assert.match(scripts[0], /#24273a/); assert.match(scripts[1], /#faf4e5/);
    assert.deepEqual(throttle, [false, true]);
});

test("persistent window layers retain matching corners after loading view disposal", () => {
    const win = new EventEmitter(); let maximized = false, full = false;
    win.isMaximized = () => maximized; win.isFullScreen = () => full;
    const views = Array.from({ length: 2 }, () => ({ setBorderRadius(value) { this.radius = value; } }));
    prepareWindowCorners(win, views);
    const check = radius => views.forEach(view => assert.equal(view.radius, radius));
    check(8);
    const disposeLoading = prepareLoadingView(win, { setBackgroundColor() {}, setBorderRadius() {},
        webContents: { isDestroyed: () => false, close() {} } }, "#101010");
    disposeLoading();
    maximized = true; win.emit("maximize"); check(0);
    maximized = false; win.emit("unmaximize"); check(8);
    full = true; win.emit("enter-full-screen"); check(0);
    full = false; win.emit("leave-full-screen"); check(8);
    win.emit("closed"); assert.equal(win.eventNames().length, 0);
});

test("loading view rounds normal windows, squares maximized/fullscreen, cleans up", () => {
    const win = new EventEmitter(); let maximized = false, full = false, radius, closed = 0;
    win.isMaximized = () => maximized; win.isFullScreen = () => full;
    const view = { setBackgroundColor: value => assert.equal(value, "#24273A"), setBorderRadius: value => { radius = value; },
        webContents: { isDestroyed: () => closed > 0, close: () => closed++ } };
    const dispose = prepareLoadingView(win, view, "#24273A");
    assert.equal(radius, 8);
    maximized = true; win.emit("maximize"); assert.equal(radius, 0);
    maximized = false; win.emit("unmaximize"); assert.equal(radius, 8);
    full = true; win.emit("enter-full-screen"); assert.equal(radius, 0);
    full = false; win.emit("leave-full-screen"); assert.equal(radius, 8);
    delete view.webContents; // Electron clears this getter after destruction.
    win.emit("closed"); dispose(); assert.equal(closed, 1); assert.equal(win.eventNames().length, 0);
});

test("appearance patches are independent, preserve files, reject drift and are byte-idempotent", async () => {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "appearance-test-"));
    try {
        const base = path.join(temp, "window.asar");
        await refactorAsar(process.env.ANTIGRAVITY_TEST_ASAR, base);
        const original = fs.readFileSync(base), archive = readArchive(base);
        const shadow = path.join(temp, "shadow.asar"), startup = path.join(temp, "startup.asar"), both = path.join(temp, "both.asar"), again = path.join(temp, "again.asar");
        assert.deepEqual(applyPatches(base, shadow, ["settings-shadow"]).changedFiles, ["dist/preload.js"]);
        assert.deepEqual(applyPatches(base, startup, ["startup-appearance"]).changedFiles, ["dist/utils.js", "dist/loadingOverlay.js", "dist/startupAppearance.js"]);
        applyPatches(shadow, both, ["startup-appearance"]); applyPatches(both, again);
        assert.deepEqual(fs.readFileSync(both), fs.readFileSync(again));
        const result = readArchive(both);
        await checkLoadingLayout(result.extractFile("dist/loadingOverlay.js").toString());
        await checkLoadingClose(result.extractFile("dist/loadingOverlay.js").toString());
        const allowed = new Set(["dist/preload.js", "dist/utils.js", "dist/loadingOverlay.js"]);
        function check(dir, prefix = "") { for (const [name, entry] of Object.entries(dir.files)) {
            const filename = prefix + name;
            if (entry.files) check(entry, filename + "/");
            else if (!entry.unpacked && !entry.link && !allowed.has(filename)) assert.deepEqual(result.extractFile(filename), archive.extractFile(filename));
        } }
        check(archive.header);
        assert.deepEqual(fs.readFileSync(base), original);
        assert.throws(() => applyPatches(base, base), /new output/);
        const header = structuredClone(archive.header), payload = archive.buffer.subarray(8 + archive.headerSize);
        const drift = Buffer.concat([archive.extractFile("dist/loadingOverlay.js"), Buffer.from("\n")]);
        header.files.dist.files["loadingOverlay.js"] = { size: drift.length, offset: String(payload.length) };
        const bad = path.join(temp, "bad.asar"), rejected = path.join(temp, "rejected.asar");
        fs.writeFileSync(bad, Buffer.concat([encodeAsarHeader(header), payload, drift]));
        assert.throws(() => applyPatches(bad, rejected), /SHA-256/); assert.equal(fs.existsSync(rejected), false);
        assert.throws(() => applyPatches(base, rejected, ["unknown"]), /Unknown/);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

// Run the actual transformed module, including subscription and handoff cleanup.
async function checkLoadingLayout(source) {
    const win = new EventEmitter(), root = new EventEmitter();
    let bounds = { x: 0, y: 0, width: 1400, height: 900 }, child, closed = false, releaseTheme;
    const themeReady = new Promise(resolve => { releaseTheme = resolve; });
    Object.assign(root, {
        getBounds: () => bounds,
        addChildView: view => { child = view; },
        removeChildView: view => assert.equal(view, child),
    });
    Object.assign(win, {
        contentView: root, webContents: new EventEmitter(), isDestroyed: () => false,
        getContentSize: () => [1400, 900], // Stale during the native resize event.
    });
    class WebContentsView {
        webContents = { loadURL: async () => {} };
        setBounds(value) { this.bounds = { ...value }; }
    }
    const exports = {};
    vm.runInNewContext(source, { exports, require: name => {
        if (name === "electron") return { WebContentsView };
        if (name === "./utils") return { getHubWebContents: () => win.webContents };
        assert.equal(name, "./startupAppearance");
        return { prepareLoadingView: () => () => { closed = true; }, waitForPaintedTheme: () => themeReady };
    } });
    exports.attachLoadingOverlay(win, "#cccccc", "#101010");
    assert.deepEqual(child.bounds, bounds);
    assert.equal(root.listenerCount("bounds-changed"), 1);
    assert.equal(win.listenerCount("resize"), 0);
    for (const [width, height] of [[1024, 768], [801, 601], [1444, 781], [640, 480]]) {
        win.emit("resize"); // Upstream observed this before the new layout.
        bounds = { x: 0, y: 0, width, height };
        root.emit("bounds-changed");
        assert.deepEqual(child.bounds, bounds);
    }
    win.webContents.emit("did-finish-load");
    await new Promise(setImmediate);
    assert.equal(closed, false, "upstream cleanup must wait for the actual Hub theme");
    assert.equal(root.listenerCount("bounds-changed"), 1);
    releaseTheme();
    await new Promise(setImmediate); // Drain the async listener's VM-realm promises.
    assert.equal(root.listenerCount("bounds-changed"), 0);
    assert.equal(closed, true);
    bounds = { ...bounds, width: 900 };
    root.emit("bounds-changed");
    assert.equal(child.bounds.width, 640, "removed loading view must stop tracking layout");
    win.emit("closed"); // Upstream close cleanup remains idempotent after handoff.
}

// Model Electron clearing WebContentsView.webContents after contents destruction.
// Exercise the real appearance disposer together with the transformed upstream.
async function checkLoadingClose(source) {
    for (const phase of ["before-load", "waiting-theme", "after-handoff"]) {
        const win = new EventEmitter(), root = new EventEmitter();
        let child, destroyed = false, closes = 0, releaseTheme;
        const ready = new Promise(resolve => { releaseTheme = resolve; });
        Object.assign(win, { contentView: root, webContents: new EventEmitter(),
            isDestroyed: () => destroyed, isMaximized: () => false, isFullScreen: () => false });
        Object.assign(root, { getBounds: () => ({ width: 800, height: 600 }),
            addChildView: view => { child = view; }, removeChildView() {} });
        class WebContentsView {
            constructor() {
                this.webContents = { loadURL: async () => {}, isDestroyed: () => closes > 0,
                    close: () => { closes++; this.webContents = undefined; } };
            }
            setBounds() {} setBackgroundColor() {} setBorderRadius() {}
        }
        const exports = {};
        vm.runInNewContext(source, { exports, require: name => {
            if (name === "electron") return { WebContentsView };
            if (name === "./utils") return { getHubWebContents: () => win.webContents };
            assert.equal(name, "./startupAppearance");
            return { prepareLoadingView, waitForPaintedTheme: () => ready };
        } });
        exports.attachLoadingOverlay(win, "#cccccc", "#101010");
        if (phase !== "before-load") win.webContents.emit("did-finish-load");
        if (phase === "after-handoff") { releaseTheme(); await new Promise(setImmediate); }
        destroyed = true;
        assert.doesNotThrow(() => win.emit("closed"), phase);
        releaseTheme(); await new Promise(setImmediate);
        assert.equal(closes, 1, `${phase}: loading contents must close exactly once`);
        assert.equal(child.webContents, undefined);
        assert.equal(win.webContents.listenerCount("did-finish-load"), 0);
    }
}
