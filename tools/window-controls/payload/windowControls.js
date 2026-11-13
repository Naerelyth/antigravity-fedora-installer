"use strict";

const TITLE_BAR_HEIGHT = 35;
const TRANSPARENT_OVERLAY = "#00000000";
const DARK_SYMBOL_COLOR = "#1f1f1f";
const LIGHT_SYMBOL_COLOR = "#ffffff";

function normalizeZoomFactor(value) {
    return typeof value === "number" && Number.isFinite(value)
        ? Math.min(5, Math.max(0.25, value))
        : 1;
}

function normalizeSymbolColor(value) {
    if (typeof value !== "string") {
        return null;
    }
    const color = value.trim();
    // Electron accepts CSS color strings. Keep the trusted renderer contract
    // broad enough for custom themes while rejecting malformed IPC input.
    return color.length > 0 && color.length <= 64 && !/[\u0000-\u001f\u007f]/.test(color) ? color : null;
}

function createWindowControlsRuntime(electron, platform = process.platform) {
    const controllers = new WeakMap();
    const supported = platform === "win32" || platform === "linux";

    function defaultSymbolColor() {
        return electron.nativeTheme.shouldUseDarkColors ? LIGHT_SYMBOL_COLOR : DARK_SYMBOL_COLOR;
    }

    function createTitleBarOverlay(options = {}) {
        const zoomFactor = normalizeZoomFactor(options.zoomFactor);
        return {
            // Share the renderer's actual background, including modal backdrops.
            // An opaque copy takes a different native color-compositing path.
            color: TRANSPARENT_OVERLAY,
            symbolColor: normalizeSymbolColor(options.symbolColor) || defaultSymbolColor(),
            height: Math.floor(TITLE_BAR_HEIGHT * zoomFactor),
        };
    }

    function installWindowControls(win, options = {}) {
        if (!supported || !win || typeof win.setTitleBarOverlay !== "function") {
            return () => {};
        }
        const installed = controllers.get(win);
        if (installed) {
            return installed.dispose;
        }

        const state = {
            rendererSymbolColor: normalizeSymbolColor(options.symbolColor),
            resolveDefaultSymbolColor: typeof options.resolveDefaultSymbolColor === "function"
                ? options.resolveDefaultSymbolColor
                : null,
            shouldFollowSystemTheme: typeof options.shouldFollowSystemTheme === "function"
                ? options.shouldFollowSystemTheme
                : null,
        };
        let disposed = false;
        let refreshScheduled = false;
        // BrowserWindow.webContents is a native getter and throws after closed.
        const webContents = win.webContents;

        const resolveSymbolColor = () => {
            if (state.rendererSymbolColor) {
                return state.rendererSymbolColor;
            }
            if (state.resolveDefaultSymbolColor) {
                try {
                    const resolved = normalizeSymbolColor(state.resolveDefaultSymbolColor());
                    if (resolved) {
                        return resolved;
                    }
                }
                catch (error) {
                    console.warn("[window-controls] Failed to resolve application theme color", error);
                }
            }
            return defaultSymbolColor();
        };

        const getZoomFactor = () => {
            try {
                return webContents && typeof webContents.getZoomFactor === "function"
                    ? webContents.getZoomFactor()
                    : 1;
            }
            catch {
                return 1;
            }
        };

        const refresh = () => {
            if (disposed || (typeof win.isDestroyed === "function" && win.isDestroyed())) {
                return false;
            }
            try {
                win.setTitleBarOverlay(createTitleBarOverlay({
                    symbolColor: resolveSymbolColor(),
                    zoomFactor: getZoomFactor(),
                }));
                return true;
            }
            catch (error) {
                console.warn("[window-controls] Failed to update titlebar overlay", error);
                return false;
            }
        };

        const scheduleRefresh = () => {
            if (refreshScheduled || disposed) {
                return;
            }
            refreshScheduled = true;
            setImmediate(() => {
                refreshScheduled = false;
                refresh();
            });
        };

        const update = (rendererOptions) => {
            const requestedSymbolColor = normalizeSymbolColor(rendererOptions?.symbolColor);
            if (requestedSymbolColor) {
                const previousSymbolColor = state.rendererSymbolColor;
                if (requestedSymbolColor) state.rendererSymbolColor = requestedSymbolColor;
                if (!refresh()) {
                    state.rendererSymbolColor = previousSymbolColor;
                    refresh();
                }
                return;
            }
            refresh();
        };

        const onNativeThemeUpdated = () => {
            try {
                if (state.shouldFollowSystemTheme?.()) {
                    state.rendererSymbolColor = null;
                }
            }
            catch (error) {
                console.warn("[window-controls] Failed to resolve application theme preference", error);
            }
            refresh();
        };
        const onZoomChanged = () => scheduleRefresh();
        const onClosed = () => dispose();
        const dispose = () => {
            if (disposed) {
                return;
            }
            disposed = true;
            electron.nativeTheme.off("updated", onNativeThemeUpdated);
            webContents?.removeListener?.("zoom-changed", onZoomChanged);
            webContents?.removeListener?.("did-finish-load", onZoomChanged);
            win.removeListener?.("closed", onClosed);
            controllers.delete(win);
        };

        electron.nativeTheme.on("updated", onNativeThemeUpdated);
        webContents?.on?.("zoom-changed", onZoomChanged);
        webContents?.on?.("did-finish-load", onZoomChanged);
        win.on?.("closed", onClosed);
        controllers.set(win, { dispose, update });
        refresh();
        return dispose;
    }

    function updateWindowControls(win, rendererOptions) {
        if (!supported || !win) {
            return false;
        }
        if (!controllers.has(win)) {
            installWindowControls(win);
        }
        const controller = controllers.get(win);
        if (!controller) {
            return false;
        }
        controller.update(rendererOptions);
        return true;
    }

    return {
        createTitleBarOverlay,
        installWindowControls,
        updateWindowControls,
    };
}

let defaultRuntime;
function runtime() {
    if (!defaultRuntime) {
        defaultRuntime = createWindowControlsRuntime(require("electron"));
    }
    return defaultRuntime;
}

module.exports = {
    DARK_SYMBOL_COLOR,
    LIGHT_SYMBOL_COLOR,
    TITLE_BAR_HEIGHT,
    TRANSPARENT_OVERLAY,
    createWindowControlsRuntime,
    createTitleBarOverlay: (...args) => runtime().createTitleBarOverlay(...args),
    installWindowControls: (...args) => runtime().installWindowControls(...args),
    updateWindowControls: (...args) => runtime().updateWindowControls(...args),
};
