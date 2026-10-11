/*
 * Dumps the voice-channel member list from the live client: the DOM around the
 * channel name (that panel in the screenshot), and the React component chain
 * behind it, which is what tells us what to patch.
 *
 * Run through the CDP client:
 *   node tools/cdp.mjs --file tools/vc-inspect.js
 *
 * Re-run this after a Discord update if a patch stops applying.
 */
(() => {
    const wp = Vencord.Webpack;
    const ChannelStore = wp.findStore("ChannelStore");
    const SelectedChannelStore = wp.findStore("SelectedChannelStore");
    const UserStore = wp.findStore("UserStore");
    const VoiceStateStore = wp.findStore("VoiceStateStore");

    const me = UserStore.getCurrentUser();
    const vcId = SelectedChannelStore.getVoiceChannelId?.();
    const channel = vcId ? ChannelStore.getChannel(vcId) : null;

    const out = {
        me: me?.username ?? null,
        voiceChannelId: vcId ?? null,
        voiceChannelName: channel?.name ?? null,
        guildId: channel?.guild_id ?? null
    };

    if (!vcId) {
        out.note = "not connected to a voice channel — join one and re-run";
        return JSON.stringify(out, null, 1);
    }

    out.membersInChannel = Object.keys(VoiceStateStore.getVoiceStatesForChannel(vcId) ?? {});

    const attrsOf = el => {
        const attrs = {};
        for (const a of el.attributes ?? []) attrs[a.name] = a.value.slice(0, 100);
        return attrs;
    };

    const describe = (el, depth = 0) => {
        if (!el) return null;

        const fiberKey = Object.keys(el).find(k => k.startsWith("__reactFiber$"));
        const components = [];
        let fiber = fiberKey ? el[fiberKey] : null;

        while (fiber && components.length < 12) {
            const type = fiber.type;
            const name = typeof type === "function"
                ? type.displayName || type.name
                : typeof type === "string"
                    ? type
                    : type?.displayName || type?.render?.displayName || type?.render?.name || null;

            if (name) {
                const props = fiber.memoizedProps ?? {};
                components.push({
                    name,
                    moduleId: (() => {
                        try {
                            return typeof type === "function" ? wp.findModuleId(type) : null;
                        } catch {
                            return null;
                        }
                    })(),
                    userId: props.userId ? String(props.userId) : props.user?.id ? String(props.user.id) : undefined
                });
            }
            fiber = fiber.return;
        }

        return {
            tag: el.tagName.toLowerCase(),
            attrs: attrsOf(el),
            text: (el.textContent ?? "").trim().slice(0, 60),
            avatars: el.querySelectorAll("img[src*='/avatars/'], [class*='avatar']").length,
            components,
            children: depth < 1 ? [...el.children].slice(0, 10).map(c => describe(c, depth + 1)) : undefined
        };
    };

    // Discord hides the channel name inside the connected-voice panel; use it as
    // the anchor to walk out to the member list.
    const needle = channel.name;
    const seeds = [...document.querySelectorAll("div, span, h1, h2, h3")]
        .filter(el => (el.textContent ?? "").trim() === needle && el.children.length <= 2);
    out.anchorsFound = seeds.length;

    const seed = seeds[0];
    if (seed) {
        let node = seed;
        for (let i = 0; i < 6 && node?.parentElement; i++) {
            if (node.children.length >= 2 && (node.textContent ?? "").trim().length > needle.length + 5) break;
            node = node.parentElement;
        }
        out.container = describe(node);
        out.rows = [...(node?.children ?? [])].slice(0, 12).map(c => describe(c, 1));
    }

    return JSON.stringify(out);
})()
