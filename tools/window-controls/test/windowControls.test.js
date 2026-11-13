"use strict";

const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const {
    createWindowControlsRuntime,
    TITLE_BAR_HEIGHT,
    TRANSPARENT_OVERLAY,
} = require("../payload/windowControls");

function fixture(platform = "linux") {
    const nativeTheme = new EventEmitter();
    nativeTheme.shouldUseDarkColors = false;
    const webContents = new EventEmitter();
    webContents.zoomFactor = 1;
    webContents.getZoomFactor = () => webContents.zoomFactor;
    const win = new EventEmitter();
    win.webContents = webContents;
    win.isDestroyed = () => false;
    win.setTitleBarOverlayCalls = [];
    win.setTitleBarOverlay = (options) => win.setTitleBarOverlayCalls.push(options);
    const runtime = createWindowControlsRuntime({ nativeTheme }, platform);
    return { nativeTheme, runtime, webContents, win };
}

test("creates a transparent overlay matching the 35px upstream titlebar", () => {
    const { runtime } = fixture();
    assert.deepEqual(runtime.createTitleBarOverlay({ zoomFactor: 1.25, symbolColor: "#abcdef" }), {
        color: TRANSPARENT_OVERLAY,
        symbolColor: "#abcdef",
        height: Math.floor(TITLE_BAR_HEIGHT * 1.25),
    });
});

test("never rounds native height below the page titlebar into the content", () => {
    const { runtime } = fixture();
    for (const zoom of [0.8, 1, 1.1, 1.25, 1.5, 2]) {
        const height = runtime.createTitleBarOverlay({ zoomFactor: zoom }).height;
        assert.equal(height, Math.floor(35 * zoom));
        assert.ok(height <= 35 * zoom);
    }
});

test("updates the installed overlay for application themes", () => {
    const { runtime, win } = fixture();
    runtime.installWindowControls(win, { symbolColor: "#ffffff" });
    assert.equal(win.setTitleBarOverlayCalls.at(-1).symbolColor, "#ffffff");
    assert.equal(runtime.updateWindowControls(win, { color: "#123456", symbolColor: "#202020" }), true);
    assert.deepEqual(win.setTitleBarOverlayCalls.at(-1), {
        color: TRANSPARENT_OVERLAY,
        symbolColor: "#202020",
        height: TITLE_BAR_HEIGHT,
    });
});

test("closed cleanup does not read destroyed BrowserWindow native getters", async () => {
    const { runtime, win, webContents, nativeTheme } = fixture();
    runtime.installWindowControls(win);
    webContents.emit("zoom-changed");
    win.isDestroyed = () => true;
    Object.defineProperty(win, "webContents", { get() { throw new TypeError("Object has been destroyed"); } });
    assert.doesNotThrow(() => win.emit("closed"));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(nativeTheme.listenerCount("updated"), 0);
    assert.equal(webContents.listenerCount("zoom-changed"), 0);
    assert.equal(webContents.listenerCount("did-finish-load"), 0);
});

test("background stays transparent through startup, theme changes and zoom", () => {
    const { runtime, win, webContents } = fixture();
    runtime.installWindowControls(win, { color: "#abcdef" });
    assert.equal(win.setTitleBarOverlayCalls.at(-1).color, TRANSPARENT_OVERLAY);
    for (const color of ["#fafafa", "#131313", "rgb(40, 22, 70)"]) {
        runtime.updateWindowControls(win, { color, symbolColor: "#ffffff" });
        assert.equal(win.setTitleBarOverlayCalls.at(-1).color, TRANSPARENT_OVERLAY);
        webContents.zoomFactor = 1.5;
        runtime.updateWindowControls(win);
        assert.equal(win.setTitleBarOverlayCalls.at(-1).color, TRANSPARENT_OVERLAY);
    }
});

test("accepts CSS colors used by custom application themes", () => {
    const { runtime, win } = fixture();
    runtime.installWindowControls(win);
    runtime.updateWindowControls(win, { symbolColor: "rgba(32, 32, 32, 0.9)" });
    assert.equal(win.setTitleBarOverlayCalls.at(-1).symbolColor, "rgba(32, 32, 32, 0.9)");
});

test("rolls back a renderer color rejected by Electron", () => {
    const { runtime, win } = fixture();
    const originalWarn = console.warn;
    console.warn = () => {};
    try {
        win.setTitleBarOverlay = (options) => {
            if (options.symbolColor === "definitely-not-a-color") {
                throw new Error("Invalid color");
            }
            win.setTitleBarOverlayCalls.push(options);
        };
        runtime.installWindowControls(win, { symbolColor: "#ffffff" });
        runtime.updateWindowControls(win, { symbolColor: "definitely-not-a-color" });
        assert.equal(win.setTitleBarOverlayCalls.at(-1).symbolColor, "#ffffff");
        runtime.updateWindowControls(win);
        assert.equal(win.setTitleBarOverlayCalls.at(-1).symbolColor, "#ffffff");
    }
    finally {
        console.warn = originalWarn;
    }
});

test("refreshes on system theme and zoom changes and cleans up on close", async () => {
    const { nativeTheme, runtime, webContents, win } = fixture();
    runtime.installWindowControls(win);
    nativeTheme.shouldUseDarkColors = true;
    nativeTheme.emit("updated");
    assert.equal(win.setTitleBarOverlayCalls.at(-1).symbolColor, "#ffffff");

    webContents.zoomFactor = 1.5;
    webContents.emit("zoom-changed");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(win.setTitleBarOverlayCalls.at(-1).height, 52);

    const callCount = win.setTitleBarOverlayCalls.length;
    win.emit("closed");
    nativeTheme.emit("updated");
    webContents.emit("zoom-changed");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(win.setTitleBarOverlayCalls.length, callCount);
});

test("system-following themes discard stale renderer colors while fixed custom themes retain them", () => {
    const { nativeTheme, runtime, win } = fixture();
    let followsSystem = false;
    runtime.installWindowControls(win, {
        resolveDefaultSymbolColor: () => nativeTheme.shouldUseDarkColors ? "#ffffff" : "#1f1f1f",
        shouldFollowSystemTheme: () => followsSystem,
    });
    runtime.updateWindowControls(win, { symbolColor: "#abcdef" });

    nativeTheme.shouldUseDarkColors = true;
    nativeTheme.emit("updated");
    assert.equal(win.setTitleBarOverlayCalls.at(-1).symbolColor, "#abcdef");

    followsSystem = true;
    nativeTheme.emit("updated");
    assert.equal(win.setTitleBarOverlayCalls.at(-1).symbolColor, "#ffffff");
});

test("does not install overlays on unsupported platforms", () => {
    const { runtime, win } = fixture("darwin");
    runtime.installWindowControls(win);
    assert.equal(win.setTitleBarOverlayCalls.length, 0);
    assert.equal(runtime.updateWindowControls(win, { symbolColor: "#ffffff" }), false);
});
