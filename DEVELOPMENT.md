# Development

Everything needed to build, reload, inspect and repair VoiceReject — and to write
another userplugin the same way.

## Layout

```
vencord-voice-reject/          this repo — the files you edit
  plugins/VoiceReject.tsx      the plugin (this is what gets built)
  _template.ts                 starting point for a new plugin (not built)
  tools/cdp.mjs                dependency-free Chrome DevTools Protocol client
  tools/vc-inspect.js          dump the voice member list + its React chain
  tools/dom-survey.js          find the row elements and their fibre chain
  dev.sh                       the dev loop
```

`VENCORD_DIR` defaults to `~/Vencord`. Only files inside `plugins/` are deployed;
anything at the repo root (like `_template.ts`) stays inert.

`dev.sh` is written for **macOS**: it assumes `/Applications/<App>.app`, uses
`open -a` to launch with a captured log, and matches the main process by path. The
plugin itself is platform-independent, so on Linux or Windows the build, deploy
and reload steps still apply — swap the `restart`/`logs` parts for however you
launch Discord with `--remote-debugging-port`.

## How it is wired

- `plugins/*.ts(x)` are **copied** into `$VENCORD_DIR/src/userplugins` by
  `./dev.sh sync`. Not symlinked: esbuild resolves a symlink to its real path,
  which lands outside Vencord's tsconfig root and breaks the `@utils/*` path
  aliases. `sync` also removes symlinks left over from the older setup, and
  undeploys any plugin that used to exist here but no longer does (tracked in
  `.deployed`, which is gitignored).
- `src/userplugins` is gitignored by Vencord, so the Vencord checkout stays clean
  and this repo remains the source of truth.
- Vencord is installed as a **dev install**: the patched app's
  `Contents/Resources/app.asar` is a ~192 byte stub that does
  `require("<VENCORD_DIR>/dist/patcher.js")`, with the original kept beside it as
  `_app.asar`. Both the stable and Canary clients can be patched this way and both
  load the *same* `dist`, so one build serves them both.
- `Info.plist`'s `ElectronAsarIntegrity` only covers `Resources/default_app.asar`,
  not the patched `app.asar`, so the integrity check does not reject the stub.
- Discord forwards renderer `console` output to the main process stdout, so
  `open -a "<App>" --stdout <log>` captures every Vencord and plugin log line.
  That is what makes automated verification possible.

## The loop

```bash
./dev.sh sync                 # copy plugins/*.tsx? into src/userplugins
./dev.sh build                # rebuild Vencord (esbuild, ~15s)
./dev.sh reload               # reload the renderer over CDP — this is what picks up the build
./dev.sh restart              # full app restart, captures stdout to $LOG
./dev.sh logs                 # show Vencord lines
./dev.sh logs VoiceReject     # filter for this plugin
./dev.sh cycle VoiceReject    # sync + build + reload + logs
```

Env overrides: `VENCORD_DIR`, `DISCORD_APP` (default `Discord Canary`), `LOG`,
`CDP_PORT`, `OPEN_ARGS`.

`reload` needs Discord started with `OPEN_ARGS="--remote-debugging-port=9222"`
(either `OPEN_ARGS=... ./dev.sh restart`, or launch it that way once).

### Two rules that waste the most time

- **A rebuilt bundle needs a real document reload.** Discord's login → app
  transition is client-side, so the app will silently keep running the old bundle.
  `./dev.sh reload` is the fix.
- **`pnpm build` does not typecheck** (esbuild only). From `$VENCORD_DIR`, run
  `pnpm testTsc` for real type errors and
  `npx eslint src/userplugins/VoiceReject.tsx` for lint. Lint the **file**, not the
  directory: `src/userplugins` is a shared drop-in folder, so a directory-wide lint
  also reports whatever other plugins you have sitting there.

## Working with the stable client (Discord.app)

Stable `Discord.app` is patched exactly like Canary and loads the *same* `dist`, so
one `./dev.sh build` updates both. Only the parts that name the app differ, and they
default to Canary:

```bash
# launch stable with its own debug port (Canary keeps 9222)
DISCORD_APP="Discord" LOG=/tmp/discord-stable.log \
    OPEN_ARGS="--remote-debugging-port=9223" ./dev.sh restart

# talk to whichever client you relaunched that way
CDP_PORT=9223 ./dev.sh reload
CDP_PORT=9223 node tools/cdp.mjs 'document.title'
```

One port cannot serve both clients, so give each its own and set `CDP_PORT` to
match. Without a debug port, neither `reload` nor `cdp.mjs` can reach the renderer.

## Inspecting the live client

`tools/cdp.mjs` is a dependency-free CDP client: it evaluates JS inside the running
renderer, which is how you find webpack modules and inspect the DOM without a
rebuild per question. It picks the main app target out of the several page targets
Discord exposes (splash, devtools, …).

```bash
node tools/cdp.mjs 'document.title'
node tools/cdp.mjs --file tools/vc-inspect.js   # voice member list + React chain
node tools/cdp.mjs --file tools/dom-survey.js   # row elements + fibre chain
```

Useful entry points: `Vencord.Webpack.findAll/findByProps`,
`Vencord.Webpack.Common.<Store>`, and
`Vencord.Plugins.plugins.VoiceReject.settings`. Note that
`Vencord.Webpack.Common.ChannelStore` is the Flux store; the full store with
`getChannel` comes from `findByProps("getChannel", "getDMFromUserId")`.

## How the patch works

The button is injected by a text patch, not by DOM hacking:

- **Target module:** the module that renders the `voiceUser_*` member rows
  (module id `936520` in the build this was written against — ids change, the
  `find` anchor is what matters).
- **`find`:** `"VoiceUser"` — an experiment key unique to that module. Verified
  unique across all loaded module factories at the time of writing.
- **`replacement.match`:** the row's content wrapper opening
  (`className:a()(\i.Qs,{[\i.zq]:\i}),children:[`), so the injected call becomes
  the row's first child and the button lands left of the avatar.
- **`$self`** resolves to the plugin object, and `$&` passes through to
  `String.replace`, which is why the replacement is `"$&$self.renderRejectButton(Y.id,K),"`.
- **`K`** is the guild id handed to the row — it is what selects the per-server
  config, so the row and the config must stay keyed the same way.

### Placement

The button is `position: absolute` with `left: -16px`, so it sits in the empty
gutter left of the row's own left edge and takes **no** space in the flex row. Rows
with and without a button line up identically — verify by comparing
`getBoundingClientRect().left` of the avatars, which must be equal.

### Hover-only visibility

The button is `opacity: 0`, from a `<style>` element injected in `start()` and
removed in `stop()`, and revealed by:

```css
[class*=voiceUser_]:hover [data-voice-reject],
[data-voice-reject]:focus-visible,
[data-voice-reject]:not([data-state="idle"]) { opacity: 1; }
```

The last selector keeps the busy/✓/! feedback visible even without hover. The
opacity and transition deliberately live in the stylesheet and **not** in
`buttonStyle`: an inline style beats a stylesheet rule, so the hover rule could
never win.

### Per-server configuration

Every server is configured separately; the global command and delay are only
fallbacks. `buildCommand` resolves
`serverConfig(guildId).command ?? settings.store.command`, and
`updateServerConfig` merges into a single guild's slot — the two never interact.

The `{userId}` placeholder is optional: `applyTemplate` appends the id when the
template uses no placeholder. The settings UI calls the *same* `applyTemplate` the
sender uses, so the preview cannot drift from what is actually sent.

## When Discord updates and the button disappears

You will see `Patch by VoiceReject had no effect` in the log and no button.

1. `node tools/cdp.mjs --file tools/dom-survey.js` to find the row elements and
   their React chain.
2. Walk the fibre's `type.toString()` and search loaded module sources for a slice
   of it to locate the new module id.
3. Re-read the module source, find the new shape of the row's children array, and
   update `match` in the patch.

A fast way to confirm a patch really landed in a given client — rather than
trusting the absence of a warning — is to ask for the module source and look for
your own call:

```bash
CDP_PORT=9223 node tools/cdp.mjs 'Vencord.Webpack.findAll(m => typeof m === "function" && m.toString().includes("VoiceUser")).map(m => m.toString().includes("renderRejectButton"))'
```

Then confirm the injected call actually resolves at runtime, since a missing
`$self` property would only throw when the row renders:

```bash
CDP_PORT=9223 node tools/cdp.mjs 'typeof Vencord.Plugins.plugins.VoiceReject.renderRejectButton'
```

## Verifying behaviour, not just build success

A green build proves nothing about the plugin. Send the real message and read the
result back out of Discord's own API:

- Send with `MessageActions.sendMessage`, then query
  `GET /channels/<id>/messages` through the webpack HTTP module and assert the
  content. Snapshot message ids **before** and delete only the ids that appeared
  after, so cleanup never touches anyone else's messages.
- To check the button's geometry and the row it lives in, query the DOM through
  `cdp.mjs` and compare rects rather than eyeballing a screenshot.

### Verifying the hover rule

Do not trust a plain `getComputedStyle(...).opacity` read after a synthetic hover
while the Discord window is in the background: the button's
`transition: opacity 120ms` is driven by the animation clock, and an occluded
window produces no frames, so the value stays at its start value even though the
rule applies. Measured here: the shipped CSS read `0` while hovered, while the
*same* selectors with `transition: none` read `1`.

Reliable checks, in order of directness:

1. `CSS.getMatchedStylesForNode` — lists the injected rule for the button once the
   row is hovered, i.e. the selector genuinely matches.
2. Re-test with `transition: none !important` injected and compare.
3. `CSS.forcePseudoState` with `["hover"]` on the row.
4. A real hover with the Discord window in the foreground.

## Discord APIs worth remembering

- `sendMessage(channelId, data, waitForChannelReady)` — the default `true` waits
  for the channel to be *loaded in the client*, so sending to a channel you are not
  viewing never resolves. Pass `false`.
- It resolves with the raw **REST response** (`{ ok, status, body, text }`), not
  the created message — the message id is at `response.body.id`. Reading
  `response.id` silently yields `undefined`, which is how the auto-delete quietly
  skipped itself at first.
- Voice and stage channels accept messages: Discord gives them a text chat, so
  "you cannot send there" is false and must not be validated as an error.

## Environment gotchas

- **You must be logged in for most plugins to start.** Plugin start stages are
  `Init` → `DOMContentLoaded` → `WebpackReady` (default). `WebpackReady` waits on
  `onceReady`, which resolves only after the client has a gateway connection. At
  the login screen only plugins with an explicit earlier `startAt` run, and
  anything with `patches` (i.e. nearly everything) needs webpack, so log in.
- New plugins are **disabled by default**. Either set `enabledByDefault: true`
  (dev-only, handy) or enable it in Settings → Vencord Plugins.
- The captured log only receives **startup** output: console messages logged after
  boot (e.g. from a button click) do not land there. Verify runtime behaviour
  through CDP instead — trigger the action and read the consequence back out of
  Discord's own stores or API.
- Canary is a newer build than stable, so upstream plugins with long patch strings
  can emit `Patch by X had no effect` warnings. Prefer short, stable `find`
  strings in your own patches.
- A Discord update can wipe the injection. Re-run:
  ```bash
  cd "$VENCORD_DIR" && VENCORD_USER_DATA_DIR=$PWD VENCORD_DEV_INSTALL=1 \
      ./dist/Installer/VencordInstallerCli-darwin -install -branch canary
  ```
