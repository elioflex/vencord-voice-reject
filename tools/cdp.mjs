#!/usr/bin/env node
/*
 * Minimal Chrome DevTools Protocol client — evaluates JS inside the running
 * Discord renderer, so we can inspect webpack modules and the DOM without a
 * 40-second rebuild/restart cycle per question.
 *
 * Usage:
 *   node tools/cdp.mjs 'document.title'
 *   node tools/cdp.mjs --file /tmp/probe.js     (expression read from a file)
 *   CDP_PORT=9222 node tools/cdp.mjs '...'
 *
 * Requires Discord to have been launched with --remote-debugging-port=$CDP_PORT
 * (see OPEN_ARGS in dev.sh). Zero dependencies: Node 22 has a global WebSocket.
 */
import { readFileSync } from "node:fs";

const PORT = process.env.CDP_PORT ?? "9222";
const argv = process.argv.slice(2);

let expression;
const fileFlag = argv.indexOf("--file");
if (fileFlag !== -1) {
    if (!argv[fileFlag + 1]) {
        console.error("cdp: --file needs a path");
        process.exit(2);
    }
    expression = readFileSync(argv[fileFlag + 1], "utf-8");
} else {
    expression = argv.join(" ");
}

if (!expression.trim()) {
    console.error("cdp: no expression given");
    process.exit(2);
}

async function main() {
    let targets;
    try {
        targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
    } catch (err) {
        throw new Error(
            `no CDP endpoint on 127.0.0.1:${PORT} — is Discord running with --remote-debugging-port=${PORT}? (${err.message})`
        );
    }

    const pages = targets.filter(t => t.type === "page" && t.webSocketDebuggerUrl);
    if (!pages.length) throw new Error("CDP reachable but no page target found");

    // Discord has several page targets (splash, main window, devtools); prefer
    // the main app: /channels first, then any discord.com page (incl. canary),
    // then whatever is left.
    const page =
        pages.find(t => t.url.includes("discord.com/channels")) ??
        pages.find(t => t.url.includes("://canary.discord.com")) ??
        pages.find(t => t.url.includes("discord.com") && !t.url.includes("devtools")) ??
        pages[0];

    const ws = new WebSocket(page.webSocketDebuggerUrl);
    const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("CDP evaluate timed out after 30s")), 30_000);
        ws.addEventListener("open", () => {
            ws.send(JSON.stringify({
                id: 1,
                method: "Runtime.evaluate",
                params: {
                    expression,
                    awaitPromise: true,
                    returnByValue: true,
                    userGesture: true,
                    allowUnsafeEvalBlockedByCSP: false
                }
            }));
        });
        ws.addEventListener("message", event => {
            const msg = JSON.parse(event.data);
            if (msg.id !== 1) return;
            clearTimeout(timer);
            resolve(msg);
        });
        ws.addEventListener("error", () => {
            clearTimeout(timer);
            reject(new Error("CDP websocket error"));
        });
    });
    ws.close();

    if (result.error) throw new Error(`CDP error: ${JSON.stringify(result.error)}`);
    const r = result.result;
    if (r.exceptionDetails) {
        const { text, exception } = r.exceptionDetails;
        throw new Error(`evaluation threw: ${text ?? ""} ${exception?.description ?? ""}`.trim());
    }
    console.log(`[target] ${page.url}\n`);
    if (r.result?.type === "undefined") console.log("undefined");
    else console.log(r.result?.value !== undefined ? r.result.value : JSON.stringify(r.result, null, 2));
}

main().catch(err => {
    console.error(`cdp: ${err.message}`);
    process.exit(1);
});
