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
    const candidates = new Set();
    const dirtyRoots = new Set();
    const colors = new Map();

    function collectMutations(records) {
        for (const record of records) {
            if (record.type === "attributes") dirtyRoots.add(record.target);
            for (const node of record.addedNodes || []) if (node.nodeType === 1) dirtyRoots.add(node);
            for (const node of [...(record.addedNodes || []), ...(record.removedNodes || [])]) {
                if (node.nodeType === 1 && (node.matches("style, link") || node.querySelector("style, link"))) {
                    dirtyRoots.add(doc.documentElement);
                }
            }
            if (record.target.nodeName === "STYLE" || record.target.nodeName === "LINK") dirtyRoots.add(doc.documentElement);
        }
    }

    function refreshCandidates() {
        // Theme setters can call us before MutationObserver's microtask runs.
        collectMutations(observer?.takeRecords() || []);
        const roots = dirtyRoots.has(doc.documentElement) ? [doc.documentElement] : dirtyRoots;
        for (const root of roots) {
            if (!root.isConnected) continue;
            // A body theme change and its descendants need only one traversal.
            let parent = root.parentElement;
            while (parent && !dirtyRoots.has(parent)) parent = parent.parentElement;
            if (parent) continue;
            for (const element of [root, ...root.querySelectorAll("*")]) {
                const style = page.getComputedStyle(element);
                if ((style.position === "fixed" || style.position === "absolute") && parseInt(style.zIndex, 10) > 0) {
                    candidates.add(element);
                }
                else candidates.delete(element);
            }
        }
        dirtyRoots.clear();
        for (const element of candidates) if (!element.isConnected) candidates.delete(element);
    }

    // Paint order follows stacking contexts, not a global z-index sort. This
    // also includes painted pointer-events:none elements that hit testing omits.
    function stackingPath(element) {
        const result = [];
        for (let current = element; current; current = current.parentElement) {
            const style = page.getComputedStyle(current);
            const parentDisplay = current.parentElement && page.getComputedStyle(current.parentElement).display;
            const positioned = style.position !== "static" || /flex|grid/.test(parentDisplay || "");
            if (current === element || current === doc.documentElement
                || (positioned && style.zIndex !== "auto") || /fixed|sticky/.test(style.position)
                || Number(style.opacity) < 1 || style.transform !== "none" || style.filter !== "none"
                || style.perspective !== "none" || style.isolation === "isolate" || style.mixBlendMode !== "normal"
                || /paint|layout|strict|content/.test(style.contain)
                || /transform|opacity|filter/.test(style.willChange)) {
                result.unshift({ element: current, z: parseInt(style.zIndex, 10) || 0 });
            }
        }
        return result;
    }

    function comparePaintOrder(left, right) {
        const a = left.path, b = right.path;
        for (let index = 0; index < Math.min(a.length, b.length); index++) {
            if (a[index].element === b[index].element) continue;
            return a[index].z - b[index].z
                || (a[index].element.compareDocumentPosition(b[index].element) & 4 ? -1 : 1);
        }
        return a.length - b.length;
    }

    function rgba(value) {
        if (!value || !page.CSS.supports("color", value)) return null;
        // Never cache context-dependent colors such as currentColor/system colors.
        const cacheable = /^(?:#[\da-f]{3,8}|rgba?\([\d\s.,%/+\-]+\))$/i.test(value);
        if (cacheable && colors.has(value)) return colors.get(value);
        context ||= doc.createElement("canvas").getContext("2d", { willReadFrequently: true });
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        const result = Array.from(context.getImageData(0, 0, 1, 1).data);
        if (colors.size >= 64) colors.clear();
        if (cacheable) colors.set(value, result);
        return result;
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
        refreshCandidates();
        // Only full-window backdrops affect the titlebar. Cache candidates on
        // DOM changes so animation frames do not repeatedly scan the whole UI.
        const hitStack = new Set(doc.elementsFromPoint(Math.max(1, page.innerWidth - 2), 18));
        const layers = Array.from(candidates).filter(element => {
            const style = page.getComputedStyle(element);
            if (style.visibility !== "visible" || style.display === "none") return false;
            if (style.pointerEvents !== "none" && !hitStack.has(element)) return false;
            const rect = element.getBoundingClientRect();
            return rect.top <= 0 && rect.left <= 0 && rect.right >= page.innerWidth - 1
                && rect.bottom >= page.innerHeight - 1;
        }).map(element => ({ element, path: stackingPath(element) })).sort(comparePaintOrder);
        for (const { element } of layers) {
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
        dirtyRoots.add(doc.documentElement);
        observer = new page.MutationObserver(records => {
            collectMutations(records);
            // Correct theme/backdrop changes in this microtask, not next frame.
            // Context-dependent CSS colors must be resolved again after changes.
            colors.clear();
            void sync();
            schedule();
        });
        observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true,
            attributeFilter: ["class", "style", "hidden", "data-state", "aria-hidden"] });
        schedule();
    }
    if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
    for (const event of ["animationstart", "animationend", "transitionrun", "transitionend"]) doc.addEventListener(event, e => {
        if (e.target.nodeType === 1) dirtyRoots.add(e.target);
        schedule();
    }, true);
    page.addEventListener("resize", () => { dirtyRoots.add(doc.documentElement); schedule(); });
    doc.addEventListener("load", event => {
        if (event.target.nodeName === "LINK") { dirtyRoots.add(doc.documentElement); schedule(); }
    }, true);
    page.addEventListener("pagehide", () => {
        stopped = true;
        observer?.disconnect();
        if (frame) page.cancelAnimationFrame(frame);
    }, { once: true });
    return options => {
        palette = { ...options };
        colors.clear();
        schedule();
        return sync();
    };
}

if (typeof module !== "undefined") module.exports = { installModalThemeSync };
