"use strict";

// Independent of native window controls: remove only the settings panel shadow.
(() => {
    const install = () => {
        const style = document.createElement("style");
        style.id = "antigravity-settings-shadow-fix";
        style.textContent = ".settings-modal-container { box-shadow: none !important; }";
        document.head.appendChild(style);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
    else install();
})();
