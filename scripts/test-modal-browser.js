"use strict";
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawnSync } = require("node:child_process");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "antigravity-modal-browser-"));
try {
    const result = spawnSync(process.env.BROWSER_BIN || "google-chrome", [
        "--headless", "--no-sandbox", "--disable-gpu", "--disable-background-networking",
        "--no-first-run", "--no-default-browser-check", `--user-data-dir=${profile}`,
        "--virtual-time-budget=15000", "--dump-dom",
        pathToFileURL(path.resolve(__dirname, "../tools/window-controls/test/modal-browser.html")).href,
    ], { encoding: "utf8", timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    if (result.status !== 0 || !result.stdout.includes('<pre id="result">PASS</pre>')) {
        throw new Error(result.error?.message || result.stdout || result.stderr || `Browser exited ${result.status}`);
    }
    console.log("PASS: real browser modal colors, pointer-events:none, geometry, visibility, stacking contexts and restoration");
}
finally { fs.rmSync(profile, { recursive: true, force: true }); }
