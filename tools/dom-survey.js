/*
 * Which voice UI is actually on screen, and where do member rows live?
 *
 * Discord mangles class names but keeps the readable prefix (e.g.
 * `videoControls_e4cb9a`), and React fibers carry `userId` props. This walks
 * both to locate the component that renders a voice member.
 *
 *   node tools/cdp.mjs --file tools/dom-survey.js
 */
(() => {
    const out = { url: location.href, title: document.title };

    // 1. class-name families currently in the DOM
    const classes = new Set();
    for (const el of document.querySelectorAll("*")) {
        for (const c of el.classList ?? []) classes.add(c.replace(/_[0-9a-f]{5,}$/i, ""));
    }
    const keywords = /voice|member|participant|call|panel|tile|avatar|user|row|list/i;
    out.classFamilies = [...classes].filter(c => keywords.test(c)).sort().slice(0, 90);

    // 2. elements that render an avatar AND carry a userId prop in their fiber
    const fibersOf = el => {
        const key = Object.keys(el).find(k => k.startsWith("__reactFiber$"));
        if (!key) return null;

        const chain = [];
        let fiber = el[key];
        let depth = 0;
        while (fiber && depth < 14) {
            const type = fiber.type;
            const name = typeof type === "function"
                ? type.displayName || type.name
                : typeof type === "string"
                    ? type
                    : null;
            const props = fiber.memoizedProps ?? {};
            const userId = props.userId ?? props.user?.id ?? props.member?.userId;

            if (name || userId) {
                chain.push({
                    name: name ?? null,
                    moduleId: (() => {
                        try {
                            return typeof type === "function" ? Vencord.Webpack.findModuleId(type) : null;
                        } catch {
                            return null;
                        }
                    })(),
                    userId: userId ? String(userId) : null
                });
            }
            fiber = fiber.return;
            depth++;
        }
        return chain.length ? chain : null;
    };

    const avatars = [...document.querySelectorAll('img[src*="/avatars/"]')];
    out.avatarCount = avatars.length;
    out.avatarRows = [];

    for (const img of avatars.slice(0, 8)) {
        let node = img;
        for (let hops = 0; node && hops < 6; hops++) {
            const chain = fibersOf(node);
            if (chain?.some(c => c.userId)) {
                out.avatarRows.push({
                    class: node.className?.toString?.().slice(0, 90) ?? null,
                    text: (node.textContent ?? "").trim().slice(0, 60),
                    parentClass: node.parentElement?.className?.toString?.().slice(0, 90) ?? null,
                    chain: chain.slice(0, 8)
                });
                break;
            }
            node = node.parentElement;
        }
    }

    return JSON.stringify(out, null, 1);
})()
