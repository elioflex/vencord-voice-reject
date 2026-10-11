/*
 * Starting point for a new plugin. Copy this into plugins/<PluginName>.ts —
 * only files inside plugins/ get copied into Vencord by `./dev.sh sync` and
 * built, so a file sitting here stays inert.
 *
 * Replace the authors entry with your real Discord account:
 *   authors: [{ name: "yourname", id: 123456789012345678n }]
 * (the id is a BigInt — keep the trailing `n`, and keep the real numeric id).
 *
 * Docs: https://docs.vencord.dev/ (see the "Writing Plugins" section)
 */
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";

const logger = new Logger("MyPlugin");

export default definePlugin({
    name: "MyPlugin",
    description: "What it does, in one line",
    authors: [{ name: "you", id: 0n }],

    // Dev convenience: makes a brand-new plugin run without ticking it on in
    // Settings > Plugins. Remove it for a plugin you ship to other people.
    enabledByDefault: true,

    // Runs once when the plugin is enabled, after Discord + webpack are up.
    start() {
        logger.info("started");
    },

    // Undo everything start() did. A reload calls stop() then start().
    stop() {
        logger.info("stopped");
    },

    settings: {
        example: {
            description: "An example setting",
            type: OptionType.BOOLEAN,
            default: false
        }
    },

    // Text patches against Discord's minified webpack modules. Keep the `find`
    // string as short and stable as you can — Canary rebuilds often, and long
    // match strings break on every Discord release.
    patches: [],
});
