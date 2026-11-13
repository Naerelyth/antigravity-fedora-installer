"use strict";

function startupColors(settingsPath, isLight, fs = require("node:fs")) {
    const defaults = isLight
        ? { backgroundColor: "#F9F9F9", foregroundColor: "#101010" }
        : { backgroundColor: "#101010", foregroundColor: "#cccccc" };
    try {
        const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8")).userSettings;
        const seeds = settings?.[isLight ? "customThemeSeedsLight" : "customThemeSeedsDark"];
        // Theme seed fields are opaque hex RGB. Do not interpolate arbitrary CSS
        // from the settings file into the loading page HTML.
        const valid = value => typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
        return {
            backgroundColor: valid(seeds?.background) ? seeds.background : defaults.backgroundColor,
            foregroundColor: valid(seeds?.foregroundOverride) ? seeds.foregroundOverride : defaults.foregroundColor,
        };
    }
    catch { return defaults; }
}

function prepareWindowCorners(win, views) {
    const update = () => {
        const radius = win.isMaximized() || win.isFullScreen() ? 0 : 8;
        for (const view of views) view.setBorderRadius(radius);
    };
    const events = ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen"];
    for (const event of events) win.on(event, update);
    update();
    win.once("closed", () => {
        for (const event of events) win.off(event, update);
    });
}

function prepareLoadingView(win, view, backgroundColor, options = {}) {
    const loadingContents = view.webContents;
    let ready = false;
    let colors = { backgroundColor, foregroundColor: options.foregroundColor };
    const repaint = () => {
        if (!ready || loadingContents.isDestroyed()) return;
        void loadingContents.executeJavaScript(`(() => {
            document.body.style.backgroundColor = ${JSON.stringify(colors.backgroundColor)};
            document.body.style.color = ${JSON.stringify(colors.foregroundColor)};
            document.querySelector('.logo').style.color = ${JSON.stringify(colors.foregroundColor)};
        })()`).catch(error => {
            if (!loadingContents.isDestroyed()) console.warn("[startup-appearance] Loading theme update failed", error);
        });
    };
    const onLoaded = () => { ready = true; if (options.nativeTheme) repaint(); };
    const onThemeUpdated = () => {
        try {
            const settings = require("node:fs").readFileSync(options.settingsPath, "utf8");
            if (!JSON.parse(settings).userSettings?.themeMode?.includes("INHERIT")) return;
            colors = startupColors(options.settingsPath, !options.nativeTheme.shouldUseDarkColors,
                { readFileSync: () => settings });
            dispose.backgroundColor = colors.backgroundColor;
            view.setBackgroundColor(colors.backgroundColor);
            options.updateControls(colors);
            repaint();
        }
        catch (error) { console.warn("[startup-appearance] Failed to follow system theme", error); }
    };
    loadingContents.once?.("did-finish-load", onLoaded);
    options.nativeTheme?.on("updated", onThemeUpdated);
    // The extra native view otherwise paints square corners over the window.
    view.setBackgroundColor(backgroundColor);
    // Match the current Linux window's 8 DIP corners. A larger child radius
    // exposes the main renderer beneath it as an inner crescent during loading.
    const update = () => view.setBorderRadius(win.isMaximized() || win.isFullScreen() ? 0 : 8);
    const events = ["maximize", "unmaximize", "enter-full-screen", "leave-full-screen"];
    for (const event of events) win.on(event, update);
    update();
    let disposed = false;
    const dispose = () => {
        if (disposed) return;
        disposed = true;
        options.nativeTheme?.off("updated", onThemeUpdated);
        loadingContents.off?.("did-finish-load", onLoaded);
        for (const event of events) win.off(event, update);
        win.off("closed", dispose);
        if (!loadingContents.isDestroyed()) loadingContents.close();
    };
    dispose.backgroundColor = backgroundColor;
    win.once("closed", dispose);
    return dispose;
}

// Executed in the main page. did-finish-load alone precedes React's persisted
// theme hydration. Keep the loading view until the expected theme is painted.
function paintedTheme(backgroundColor, timeout = 10000, page = window) {
    return new Promise(resolve => {
        const canvas = page.document.createElement("canvas");
        const context = canvas.getContext("2d", { willReadFrequently: true });
        const rgb = value => {
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = value;
            context.fillRect(0, 0, 1, 1);
            return Array.from(context.getImageData(0, 0, 1, 1).data).join(",");
        };
        const expected = rgb(backgroundColor);
        let frame, readyFrames = 0, done = false;
        const finish = ready => {
            if (done) return;
            done = true;
            page.clearTimeout(timer);
            page.cancelAnimationFrame(frame);
            resolve(ready);
        };
        const timer = page.setTimeout(() => finish(false), timeout);
        const check = () => {
            const doc = page.document;
            const ready = doc.body && doc.querySelector('[data-testid="title-menu-bar"]')
                && rgb(page.getComputedStyle(doc.body).backgroundColor) === expected;
            readyFrames = ready ? readyFrames + 1 : 0;
            if (readyFrames >= 2) finish(true);
            else frame = page.requestAnimationFrame(check);
        };
        frame = page.requestAnimationFrame(check);
    });
}

async function waitForPaintedTheme(contents, backgroundColor) {
    if (contents.isDestroyed()) return;
    const throttled = contents.getBackgroundThrottling();
    try {
        // The native loading view can occlude the main renderer. Its readiness
        // frames must continue even while that view (or another app) covers it.
        contents.setBackgroundThrottling(false);
        const deadline = Date.now() + 10000;
        const resolveColor = typeof backgroundColor === "function" ? backgroundColor : () => backgroundColor;
        do {
            const expected = resolveColor();
            const timeout = typeof backgroundColor === "function" ? Math.min(200, Math.max(1, deadline - Date.now())) : 10000;
            const ready = await contents.executeJavaScript(`(${paintedTheme.toString()})(${JSON.stringify(expected)}, ${timeout})`);
            if (contents.isDestroyed() || (ready && expected === resolveColor())) return;
        } while (Date.now() < deadline && !contents.isDestroyed());
        console.warn("[startup-appearance] Theme readiness timed out; revealing main page");
    }
    catch (error) {
        if (!contents.isDestroyed()) console.warn("[startup-appearance] Theme readiness failed", error);
    }
    finally {
        if (!contents.isDestroyed()) contents.setBackgroundThrottling(throttled);
    }
}

module.exports = { startupColors, prepareWindowCorners, prepareLoadingView, paintedTheme, waitForPaintedTheme };
