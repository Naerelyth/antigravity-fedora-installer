"use strict";
const fs = require("node:fs");
const { hash, locked } = require("../asar-patches/contracts");
module.exports = files => {
    const payload = fs.readFileSync(require.resolve("./payload.js"));
    if (hash(payload) !== "20471c2996927cede638e26f32c4c32b3a163c3986bd22ecceb12a88744a18b3") throw new Error("Settings shadow payload drift");
    return new Map([["dist/preload.js", locked(files.get("dist/preload.js"),
        "984196ccc33cdc7193db60d3b17ad2426af2f99a62a05519d99007cc52928670", "aca3899b2dd99c8d692f5b7e658f7abf441c67c5e750e2dd44031df846e9d974",
        source => source + "\n" + payload.toString())]]);
};
