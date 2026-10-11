/* ============================================================================
   Fake data + web components for the README screenshots.
   ----------------------------------------------------------------------------
   Everything on screen in the mockups is generated here from a seed: handles,
   user ids and avatars. No real account, server or message is involved, and the
   same seed always produces the same picture, so the screenshots are
   reproducible (see tools/screenshots.sh).

   The reject button is rendered exactly as the plugin renders it, including the
   `data-voice-reject` / `data-state` attributes its HOVER_CSS and state colours
   key off — so a screenshot can never show a button the plugin would not draw.
   ========================================================================== */

/* --------------------------------------------------------------- randomness */

function fnv1a(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
}

/** mulberry32 — small, fast, deterministic PRNG. */
function rngFrom(seed) {
    let a = typeof seed === "string" ? fnv1a(seed) : seed >>> 0;
    return function next() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const pick = (rng, list) => list[Math.floor(rng() * list.length)];

/* -------------------------------------------------------------- fake users */

/*
 * Handles are built the way people actually pick them: a modifier welded to a
 * noun ("quietember", "lunarlantern"), sometimes with a separator or a number.
 * Random letters alone produced consonant soup that read as obviously fake.
 */
const MODIFIER = ("quiet lost north bitter feral hollow rapid idle solar amber lunar static silent neon rusty pale swift grim vivid dusk ashen vera"
    + " drift night frost ember glass copper paper velvet cobalt gentle"
).split(" ");
const NOUN = ("otter ember harbor wren pixel lantern fox cinder cobalt raven drift moth sparrow quartz willow kestrel onyx thistle lark basalt"
    + " kettle marrow pilcrow teapot sentry nomad beacon turnip abacus fjord gibbon harebell inkwell"
).split(" ");

/** A plausible-looking handle. Deterministic for a given seed. */
function fakeHandle(seed) {
    const rng = rngFrom(seed + ":handle");
    const mod = pick(rng, MODIFIER);
    const noun = pick(rng, NOUN);
    const style = rng();

    if (style < 0.42) return mod + noun;
    if (style < 0.62) return `${mod}_${noun}`;
    if (style < 0.74) return `${mod}${noun}_${10 + Math.floor(rng() * 89)}`;
    if (style < 0.88) return `${mod}.${pick(rng, ["dev", "gg", "io", "tv"])}`;
    return `${noun}${mod.charAt(0)}${pick(rng, ["x", "z", "y"])}`;
}

/** An 18-digit id shaped like a Discord snowflake. */
function fakeId(seed) {
    const rng = rngFrom(seed + ":id");
    let id = String(1 + Math.floor(rng() * 8));
    while (id.length < 18) id += Math.floor(rng() * 10);
    return id;
}

/**
 * A generated avatar, in the spirit of a default identicon: a mirrored 5x5
 * block pattern over a tinted background. Inline SVG, so there is no binary
 * asset and nothing that resembles a real person's picture.
 */
function avatarSvg(seed, px) {
    const rng = rngFrom(seed + ":avatar");
    const hue = Math.floor(rng() * 360);
    const bg = `hsl(${hue} 42% 34%)`;
    const fg = `hsl(${(hue + 40 + Math.floor(rng() * 120)) % 360} 62% ${58 + Math.floor(rng() * 18)}%)`;
    const unit = px / 5;
    const cells = [];

    for (let col = 0; col < 3; col++) {
        for (let row = 0; row < 5; row++) {
            if (rng() > 0.48) continue;
            for (const c of col === 2 ? [2] : [col, 4 - col])
                cells.push(`<rect x="${(c * unit).toFixed(2)}" y="${(row * unit).toFixed(2)}" width="${unit.toFixed(2)}" height="${unit.toFixed(2)}"/>`);
        }
    }

    const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}">`
        + `<rect width="${px}" height="${px}" fill="${bg}"/>`
        + `<g fill="${fg}">${cells.join("")}</g>`
        + `</svg>`;

    return "data:image/svg+xml," + encodeURIComponent(svg);
}

/* ------------------------------------------------------------------ people */

/**
 * The people who appear in the screenshots. Seeded, so the pictures never
 * change between runs. `kal` is the account running the plugin — the plugin's
 * own author in this repository, not a third party.
 */
const PEOPLE = [
    { handle: "kal", seed: "you" },
    ...[1, 2, 3, 4].map(n => ({ seed: `peer-${n}` }))
].map(p => ({ ...p, handle: p.handle ?? fakeHandle(p.seed), id: fakeId(p.seed), avatar: avatarSvg(p.seed, 64) }));

const peer = index => PEOPLE[(Number(index) || 0) + 1] ?? PEOPLE[1];

const LABEL = { idle: "\u2715", busy: "\u2026", done: "\u2713", failed: "!" };
const cssEscape = s => String(s).replace(/"/g, "&quot;").replace(/</g, "&lt;");

/**
 * Discord's row icons are monochrome, so these are too — inline SVG in
 * `currentColor` rather than emoji, which would render as full-colour pictures
 * and give the recreation away.
 */
const ICONS = {
    muted:
        `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">`
        + `<rect x="6" y="1.8" width="4" height="7" rx="2"/><path d="M3.6 7.2a4.4 4.4 0 0 0 8.8 0M8 11.6v2.4M5.6 9.6l6.4 6.4"/></svg>`,
    deafened:
        `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">`
        + `<path d="M3 10.5V8a5 5 0 0 1 10 0v2.5"/><rect x="1.8" y="9.4" width="2.8" height="4.8" rx="1.4"/>`
        + `<rect x="11.4" y="9.4" width="2.8" height="4.8" rx="1.4"/><path d="M2.6 2.6l10.8 10.8"/></svg>`,
    gear:
        `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">`
        + `<circle cx="8" cy="8" r="2.4"/><circle cx="8" cy="8" r="5.2" stroke-dasharray="1.5 2.1"/></svg>`,
    video:
        `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round">`
        + `<rect x="1.8" y="4" width="8.4" height="8" rx="2"/><path d="M10.2 8l4-2.4v4.8z"/></svg>`
};

function iconGlyph(name) {
    const svg = ICONS[name];
    return svg ? `<span class="ico" title="${name}">${svg}</span>` : "";
}

const iconList = value => (value || "").split(" ").filter(Boolean).map(iconGlyph).join("");

/** The plugin's button, attribute for attribute. */
function rejectButton(userId, state = "idle", force = false) {
    const title = state === "failed"
        ? "Could not send the reject command \u2014 check the plugin settings and the log"
        : "Reject this user";

    return `<button class="reject-button${force ? " force" : ""}" data-voice-reject="${userId}"`
        + ` data-state="${state}" title="${cssEscape(title)}">${LABEL[state]}</button>`;
}

function avatarMarkup(seed, size, speaking) {
    return `<dc-avatar seed="${cssEscape(seed)}" size="${size}"${speaking ? " speaking" : ""}></dc-avatar>`;
}

/* --------------------------------------------------------- web components */

/** <dc-avatar seed="x" size="32" speaking> — a generated picture. */
class DcAvatar extends HTMLElement {
    connectedCallback() {
        const size = Number(this.getAttribute("size") || 32);
        this.classList.add("avatar");
        if (this.hasAttribute("speaking")) this.classList.add("speaking");
        this.style.cssText = `display:block;width:${size}px;height:${size}px;flex:none;`
            + `border-radius:50%;background:url("${avatarSvg(this.getAttribute("seed") || "seed", size)}") center/cover;`;
    }
}

/**
 * <dc-member peer="0" state="idle" hovered speaking icons="muted"> — a member
 * list row. This is the surface the plugin injects into: the button is the first
 * child of the row's content wrapper, i.e. the empty gutter left of the avatar.
 */
class DcMember extends HTMLElement {
    connectedCallback() {
        const person = this.hasAttribute("peer") ? peer(this.getAttribute("peer")) : null;
        const seed = this.getAttribute("seed") || person?.seed || "seed";
        const handle = this.getAttribute("handle") || person?.handle || fakeHandle(seed);
        const id = this.getAttribute("userid") || person?.id || fakeId(seed);
        const state = this.getAttribute("state") || "idle";
        const hovered = this.hasAttribute("hovered");
        const icons = iconList(this.getAttribute("icons"));

        this.className = `member${hovered ? " hover" : ""}`;
        this.innerHTML =
            `<div class="member-content" style="position:relative;display:flex;align-items:center;gap:12px;width:100%">`
            + rejectButton(id, state, hovered && state === "idle")
            + avatarMarkup(seed, 32, this.hasAttribute("speaking"))
            + `<div class="name">${cssEscape(handle)}</div>`
            + (icons ? `<div class="icons">${icons}</div>` : "")
            + `</div>`;
    }
}

/**
 * <dc-voice-user peer="0" muted> — a participant row under a voice channel in
 * the channel sidebar.
 */
class DcVoiceUser extends HTMLElement {
    connectedCallback() {
        const person = this.hasAttribute("peer") ? peer(this.getAttribute("peer")) : null;
        const seed = this.getAttribute("seed") || person?.seed || "seed";
        const handle = this.getAttribute("handle") || person?.handle || fakeHandle(seed);

        // Discord shows nothing here unless the member is muted, deafened or
        // sharing — an icon on every row would be a tell.
        const icons = iconList(this.getAttribute("icons"));

        this.className = "voice-user";
        this.innerHTML =
            avatarMarkup(seed, 24, this.hasAttribute("speaking"))
            + `<span class="name">${cssEscape(handle)}</span>`
            + (icons ? `<span class="icons">${icons}</span>` : "");
    }
}

customElements.define("dc-avatar", DcAvatar);
customElements.define("dc-member", DcMember);
customElements.define("dc-voice-user", DcVoiceUser);

/* ------------------------------------------------------------ page filling */

/*
 * Loaded at the end of <body>, so the markup can refer to generated people:
 *   data-peer-id="0"      → that peer's id
 *   data-peer-handle="0"  → that peer's handle
 *   data-seed-art="x"     → generated art as a background, sized by data-size
 */
document.querySelectorAll("[data-peer-id]").forEach(el => {
    el.textContent = peer(el.getAttribute("data-peer-id")).id;
});

document.querySelectorAll("[data-peer-handle]").forEach(el => {
    el.textContent = peer(el.getAttribute("data-peer-handle")).handle;
});

document.querySelectorAll("[data-seed-art]").forEach(el => {
    const size = Number(el.getAttribute("data-size") || 48);
    el.style.background = `url("${avatarSvg(el.getAttribute("data-seed-art"), size)}") center/cover`;
});

window.VoiceRejectMock = { PEOPLE, fakeHandle, fakeId, avatarSvg, rngFrom };
