"use strict";
const fs = require("node:fs");
const { hash, locked, replaceOnce } = require("../asar-patches/contracts");
module.exports = files => {
    const payload = fs.readFileSync(require.resolve("./payload.js"));
    if (hash(payload) !== "fb6544a49dd694e7df0b6e1d67567d1e07094f8873f765c7fd9cf19e131cc3f5") throw new Error("Startup appearance payload drift");
    const existing = files.get("dist/startupAppearance.js");
    if (existing && !existing.equals(payload)) throw new Error("Existing startup appearance payload drift");
    const utils = locked(files.get("dist/utils.js"),
        "82f7089e178ae7350f69de08876e5cef014efc2784f44971be06f9291cb75aea", "debafe73cc43de34c42fc4f7ccbe0392242d76e110411a6f6b587d8c82ffda49", source => {
            source = replaceOnce(source, 'const loadingOverlay_1 = require("./loadingOverlay");',
                'const loadingOverlay_1 = require("./loadingOverlay");\nconst startupAppearance_1 = require("./startupAppearance");');
            source = replaceOnce(source,
                "    const backgroundColor = isLight ? '#FAFAFA' : '#131313';\n    const foregroundColor = isLight ? '#383A42' : '#FAFAFA';",
                "    const { backgroundColor, foregroundColor } = startupAppearance_1.startupColors((0, paths_1.getSettingsPbPath)(), isLight);");
            source = replaceOnce(source, "    baseWin.contentView.addChildView(hubWcv);",
                "    baseWin.contentView.addChildView(hubWcv);\n    startupAppearance_1.prepareWindowCorners(baseWin, [curtainView, hubWcv]);");
            return replaceOnce(source,
                "(0, loadingOverlay_1.attachLoadingOverlay)(win, foregroundColor, backgroundColor);",
                "(0, loadingOverlay_1.attachLoadingOverlay)(win, foregroundColor, backgroundColor, {\n        settingsPath: (0, paths_1.getSettingsPbPath)(),\n        nativeTheme: electron_1.nativeTheme,\n        updateControls: colors => (0, windowControls_1.updateWindowControls)(win, { symbolColor: colors.foregroundColor }),\n    });");
        });
    const loading = locked(files.get("dist/loadingOverlay.js"),
        "a4b2cc2ae9e73c81fcec511dee72d60f0d8cb1ba1f02a6170896bb595267bb1f", "a9d520db6f4af092dcf9dfc00a297ac5c8dfd090908c3bade436ef61fda130a3", source => {
            source = replaceOnce(source, 'const electron_1 = require("electron");',
                'const electron_1 = require("electron");\nconst startupAppearance_1 = require("./startupAppearance");');
            source = replaceOnce(source, "function attachLoadingOverlay(win, foregroundColor, backgroundColor) {",
                "function attachLoadingOverlay(win, foregroundColor, backgroundColor, appearanceOptions) {");
            source = replaceOnce(source, "    const html = getLoadingHtml(foregroundColor, backgroundColor);",
                "    const disposeAppearance = startupAppearance_1.prepareLoadingView(win, view, backgroundColor, { foregroundColor, ...appearanceOptions });\n    const html = getLoadingHtml(foregroundColor, backgroundColor);");
            // On Wayland, window resize can precede native content layout and
            // still report the old size. Follow the parent's completed layout.
            source = replaceOnce(source, "const [width, height] = win.getContentSize();",
                "const { width, height } = win.contentView.getBounds();");
            source = replaceOnce(source, "win.on('resize', updateBounds);",
                "win.contentView.on('bounds-changed', updateBounds);");
            source = replaceOnce(source, "    const cleanupOverlay = () => {",
                "    const onLoaded = async () => {\n        await startupAppearance_1.waitForPaintedTheme(hubContents, () => disposeAppearance.backgroundColor ?? backgroundColor);\n        cleanupOverlay();\n    };\n    const cleanupOverlay = () => {");
            source = replaceOnce(source, "        cleanedUp = true;",
                "        cleanedUp = true;\n        disposeAppearance();");
            source = replaceOnce(source, "win.off?.('resize', updateBounds);",
                "win.contentView.off('bounds-changed', updateBounds);");
            source = replaceOnce(source, "hubContents?.once('did-finish-load', cleanupOverlay);",
                "hubContents?.once('did-finish-load', onLoaded);");
            source = replaceOnce(source, "hubContents?.off?.('did-finish-load', cleanupOverlay);",
                "hubContents?.off?.('did-finish-load', onLoaded);");
            // prepareLoadingView owns disposal and retains a stable contents
            // reference. Electron clears view.webContents after it is closed.
            return replaceOnce(source,
                "        if (!view.webContents?.isDestroyed?.()) {\n            view.webContents.close?.();\n        }\n",
                "");
        });
    return new Map([["dist/utils.js", utils], ["dist/loadingOverlay.js", loading], ["dist/startupAppearance.js", payload]]);
};
