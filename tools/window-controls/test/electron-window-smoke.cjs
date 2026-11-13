"use strict";
// Run as an Electron application entry, not under node --test.
const assert = require("node:assert/strict");
const electron = require("electron");
const { app, BrowserWindow, nativeTheme } = electron;
const { createWindowControlsRuntime } = require(process.env.WINDOW_CONTROLS_PAYLOAD);
app.setPath("userData", process.env.WINDOW_CONTROLS_TEST_PROFILE);
app.on("window-all-closed", () => {});
process.on("uncaughtException", error => { console.error(error); app.exit(1); });
app.whenReady().then(async () => {
    const runtime = createWindowControlsRuntime(electron);
    const initialListeners = nativeTheme.listenerCount("updated");
    for (let index = 0; index < 3; index++) {
        const win = new BrowserWindow({ show: false, titleBarStyle: "hidden", titleBarOverlay: runtime.createTitleBarOverlay() });
        const wc = win.webContents;
        const calls = [];
        const nativeSetOverlay = win.setTitleBarOverlay.bind(win);
        win.setTitleBarOverlay = options => { nativeSetOverlay(options); calls.push(options); };
        runtime.installWindowControls(win);
        await win.loadURL("data:text/html,<body style='background:rgb(40,22,70)'>window controls test</body>");
        for (const color of ["#fafafa", "#131313", "rgb(40, 22, 70)"]) {
            runtime.updateWindowControls(win, { color, symbolColor: "#ffffff" });
            assert.equal(calls.at(-1).color, "#00000000");
            assert.equal(calls.at(-1).symbolColor, "#ffffff");
        }
        wc.setZoomFactor(1.5);
        runtime.updateWindowControls(win);
        assert.equal(calls.at(-1).height, 52);
        wc.emit("zoom-changed");
        win.destroy();
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(nativeTheme.listenerCount("updated"), initialListeners);
    }
    console.log("PASS: real Electron windows accept light/dark/custom colors, zoom, queued refresh, and destroyed-window cleanup");
    app.exit(0);
}).catch(error => { console.error(error); app.exit(1); });
