"use strict";

// Embedded in the sandboxed preload; no Node APIs or page-world injection.
function installModalThemeSync(send, page = window) {
    const doc = page.document;
    let palette = null;
    let last = "";
    let frame = 0;
    let until = 0;
    let stopped = false;
    let observer;
    let context;

    function rgba(value) {
        if (!value || !page.CSS.supports("color", value)) return null;
        context ||= doc.createElement("canvas").getContext("2d", { willReadFrequently: true });
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data);
    }

    function composite(base, layer, opacity) {
        const alpha = layer[3] / 255 * opacity;
        return base.map((v, i) => i === 3 ? 255 : v * (1 - alpha) + layer[i] * alpha);
    }

    function color(value) {
        return `rgb(${value.slice(0, 3).map(Math.round).join(", ")})`;
    }

    function sync() {
        if (!palette || stopped) return Promise.resolve();
        let bg = rgba(palette.color);
        let fg = rgba(palette.symbolColor);
        if (!bg || !fg) return Promise.resolve();
        // Read the painted stack inside the controls' titlebar area. Do not
        // dim for dialogs whose backdrop does not cover the titlebar.
        const stack = doc.elementsFromPoint(Math.max(1, page.innerWidth - 2), 18);
        const layers = stack.filter(element => {
            const style = page.getComputedStyle(element);
            if (style.position !== "fixed" && style.position !== "absolute") return false;
            if (!(parseInt(style.zIndex, 10) > 0)) return false;
            const rect = element.getBoundingClientRect();
            return rect.top <= 0 && rect.left <= 0 && rect.right >= page.innerWidth - 1
                && rect.bottom >= page.innerHeight - 1;
        }).reverse();
        for (const element of layers) {
            const style = page.getComputedStyle(element);
            const layer = rgba(style.backgroundColor);
            if (!layer || layer[3] === 0) continue;
            const opacity = Number(style.opacity);
            bg = composite(bg, layer, opacity);
            fg = composite(fg, layer, opacity);
        }
        const options = { ...palette, color: color(bg), symbolColor: color(fg) };
        const key = JSON.stringify(options);
        if (last === key) return Promise.resolve();
        last = key;
        return Promise.resolve(send(options)).catch(() => { last = ""; });
    }

    function tick(time) {
        frame = 0;
        if (stopped) return;
        void sync();
        if (time < until) frame = page.requestAnimationFrame(tick);
    }

    function schedule() {
        if (stopped) return;
        until = page.performance.now() + 400;
        if (!frame) frame = page.requestAnimationFrame(tick);
    }

    function start() {
        observer = new page.MutationObserver(schedule);
        observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true,
            attributeFilter: ["class", "style", "hidden", "data-state", "aria-hidden"] });
        schedule();
    }
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
    for (const event of ["animationstart", "animationend", "transitionrun", "transitionend"]) doc.addEventListener(event, schedule, true);
    page.addEventListener("resize", schedule);
    page.addEventListener("pagehide", () => {
        stopped = true;
        observer?.disconnect();
        if (frame) page.cancelAnimationFrame(frame);
    }, { once: true });
    return options => {
        palette = { ...options };
        schedule();
        return sync();
    };
}

if (typeof module !== "undefined") module.exports = { installModalThemeSync };
