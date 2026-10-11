/*
 * Vencord, a Discord client mod
 * Copyright (c) 2026 kal
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

/**
 * VoiceReject — a one-click reject button for every other member of the voice
 * channel you are connected to.
 *
 * Clicking a button sends a configurable command (default `.v reject <userId>`)
 * to a text channel you pick per server, then deletes that message after a
 * delay (5s by default).
 *
 * Unlike the Discord_rejecter self-bot this is based on, there is no token and
 * no separate process: the message is sent as you, from your own client.
 */

import { NavContextMenuPatchCallback } from "@api/ContextMenu";
import { showNotification } from "@api/Notifications";
import { definePluginSettings } from "@api/Settings";
import { sendMessage } from "@utils/discord";
import { Logger } from "@utils/Logger";
import definePlugin, { OptionType } from "@utils/types";
import type { User } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { ChannelStore, GuildStore, Menu, SelectedChannelStore, UserStore, useState, VoiceStateStore } from "@webpack/common";

const logger = new Logger("VoiceReject");

/** Discord's message action creators — used to delete the message we sent. */
const MessageActions = findByPropsLazy("deleteMessage", "startEditMessage");

const DEFAULT_COMMAND = ".v reject {userId}";
const DEFAULT_DELAY_SECONDS = 5;

/** Stand-ins used by the settings preview, shaped like a real user. */
const SAMPLE_USER_ID = "123456789012345678";
const SAMPLE_USERNAME = "somebody";

interface ServerConfig {
    /** Channel the reject command is sent to for this server. */
    channelId?: string;
    /** Overrides the global command template. */
    command?: string;
    /** Overrides the global auto-delete delay, in seconds (0 = keep the message). */
    delaySeconds?: number;
}

/* ------------------------------------------------------------------ config */

function readConfig(): Record<string, ServerConfig> {
    try {
        const parsed = JSON.parse(settings.store.perServer || "{}");
        return parsed && typeof parsed === "object" ? parsed : {};
    } catch (err) {
        logger.error("perServer config is not valid JSON — ignoring it", err);
        return {};
    }
}

function writeConfig(config: Record<string, ServerConfig>) {
    settings.store.perServer = JSON.stringify(config, null, 2);
}

function serverConfig(guildId?: string): ServerConfig {
    return (guildId && readConfig()[guildId]) || {};
}

function updateServerConfig(guildId: string, patch: ServerConfig | null) {
    const config = readConfig();

    if (patch === null) delete config[guildId];
    else config[guildId] = { ...config[guildId], ...patch };

    writeConfig(config);
}

/* ------------------------------------------------------------------ sending */

/**
 * Resolves one command template against a user. Kept separate from
 * `buildCommand` so the settings UI can preview a *draft* template — the same
 * code that sends the message renders the preview, so the two cannot drift.
 */
function applyTemplate(template: string, userId: string, usernameOverride?: string): string {
    const username = usernameOverride ?? UserStore.getUser(userId)?.username ?? userId;

    // The placeholder is optional. A plain command like ".v reject" still has to
    // name the user, so the id is appended when the template does not use one —
    // that is what makes setup a single text field for most people.
    const usedPlaceholder = /\{(userId|id|username)\}/i.test(template);

    const command = template
        .replaceAll("{userId}", userId)
        .replaceAll("{id}", userId)
        .replaceAll("{username}", username);

    return usedPlaceholder ? command : `${command} ${userId}`;
}

function buildCommand(userId: string, guildId?: string): string {
    return applyTemplate(serverConfig(guildId).command?.trim() || settings.store.command, userId);
}

/** The voice channel the user is currently connected to, if any. */
function currentVoiceChannelId(): string | undefined {
    return SelectedChannelStore.getVoiceChannelId() ?? undefined;
}

/** Whether `userId` is in the same voice channel as the user. */
function isInMyVoiceChannel(userId: string): boolean {
    const vcId = currentVoiceChannelId();
    if (!vcId) return false;

    return Boolean(VoiceStateStore.getVoiceStatesForChannel(vcId)?.[userId]);
}

/** Sends the reject command and schedules its deletion. Returns what was sent. */
async function rejectUser(userId: string, guildId?: string): Promise<string> {
    const config = serverConfig(guildId);
    if (!config.channelId)
        throw new Error(
            "no reject channel configured for this server — set one in the plugin settings "
            + "(open the channel and press \"Use current channel\", or paste its channel id)"
        );

    const { channelId } = config;
    const content = buildCommand(userId, guildId);
    const delay = config.delaySeconds ?? settings.store.delaySeconds;

    // third arg = waitForChannelReady. It must be false: the target channel is
    // usually not the one you are looking at, so Discord would otherwise queue
    // the message forever waiting for it to load.
    const response = await sendMessage(channelId, { content }, false) as
        { id?: string; body?: { id?: string; }; } | undefined;

    // Discord resolves this with the raw REST response — the created message is
    // in `body`, not the resolved object itself.
    const messageId = response?.id ?? response?.body?.id;
    logger.info(`sent "${content}" to channel ${channelId} (message ${messageId ?? "?"})`);
    if (delay > 0 && messageId) {
        setTimeout(() => {
            Promise.resolve(MessageActions.deleteMessage(channelId, messageId))
                .then(() => logger.info(`deleted ${messageId}`))
                .catch((err: unknown) => logger.error("could not delete the reject message", err));
        }, delay * 1000);
    } else if (delay > 0) {
        logger.warn("sent the command but got no message id back, so it will not be auto-deleted");
    }

    return content;
}

/* --------------------------------------------------------------- the button */

/**
 * The button stays invisible until its row is hovered, so it does not clutter
 * the member list. It also shows while focused (keyboard) and whenever its
 * state is not `idle`, so the busy/✓/! feedback is never invisible.
 *
 * Opacity lives here rather than in `buttonStyle` on purpose: an inline style
 * beats a stylesheet rule, so the hover rule below could never win.
 */
const HOVER_CSS = `
[data-voice-reject] {
    opacity: 0;
    transition: opacity 120ms ease;
}
[class*=voiceUser_]:hover [data-voice-reject],
[data-voice-reject]:focus-visible,
[data-voice-reject]:not([data-state="idle"]) {
    opacity: 1;
}
`;

let styleElement: HTMLStyleElement | undefined;

const buttonStyle = {
    alignItems: "center",
    background: "var(--status-danger, #da373c)",
    border: "none",
    borderRadius: "4px",
    color: "#fff",
    cursor: "pointer",
    display: "flex",
    fontSize: "10px",
    fontWeight: 600,
    height: "16px",
    justifyContent: "center",
    lineHeight: 1,
    padding: 0,
    // Invisible until the row is hovered — see HOVER_CSS.
    // Out of the flex flow on purpose: while it was a normal flex child it took
    // up 20px and pushed the avatar and name right, so rows with a button no
    // longer lined up with rows without one. Absolute positioning lets it sit in
    // the empty strip left of the avatar instead. The row (and the content div
    // it lives in) are `position: relative`, so this anchors to the row's left
    // edge; `overflow` is visible, so the negative offset is not clipped. The
    // offset is tuned so the button sits fully in the empty gutter left of the
    // avatar and just outside the row's left edge.
    position: "absolute",
    left: "-16px",
    top: "50%",
    transform: "translateY(-50%)",
    width: "16px"
} as const;

/**
 * The button injected next to each voice member. Rendered by the row patch.
 */
export function VcRejectButton({ userId, guildId }: { userId: string; guildId?: string; }) {
    const [state, setState] = useState<"idle" | "busy" | "done" | "failed">("idle");

    const label = { idle: "✕", busy: "…", done: "✓", failed: "!" }[state];
    const background = state === "failed"
        ? "var(--status-warning, #f0b132)"
        : state === "done"
            ? "var(--status-positive, #248046)"
            : undefined;

    return (
        <button
            style={background ? { ...buttonStyle, background } : buttonStyle}
            data-voice-reject={userId}
            data-state={state}
            title={
                state === "failed"
                    ? "Could not send the reject command — check the plugin settings and the log"
                    : "Reject this user"
            }
            onClick={async event => {
                event.preventDefault();
                event.stopPropagation();
                if (state === "busy") return;

                setState("busy");
                try {
                    await rejectUser(userId, guildId);
                    setState("done");
                } catch (err) {
                    logger.error("failed to reject user", err);
                    showNotification({
                        title: "VoiceReject could not send the command",
                        body: err instanceof Error ? err.message : String(err)
                    });
                    setState("failed");
                }
                setTimeout(() => setState("idle"), 2000);
            }}
        >
            {label}
        </button>
    );
}

/**
 * Injected into every voice member row by the patch below.
 *
 * It returns an *element* rather than calling the component, so the button's
 * hooks stay inside its own component instance (calling it directly would move
 * the hooks onto the row component and break React's hook order).
 */
function renderRejectButton(userId: string, guildId?: string) {
    // never for yourself, and only for people in your own voice channel
    if (userId === UserStore.getCurrentUser()?.id) return null;
    if (!isInMyVoiceChannel(userId)) return null;

    return <VcRejectButton key="voice-reject" userId={userId} guildId={guildId} />;
}

/* ------------------------------------------------------------ context menu */

interface UserContextProps {
    user: User;
    guildId?: string;
}

/** Adds "Reject from voice" to the right-click menu of members in your voice channel. */
const UserContext: NavContextMenuPatchCallback = (children, { user, guildId }: UserContextProps) => {
    if (!user || !isInMyVoiceChannel(user.id)) return;

    children.splice(-1, 0, (
        <Menu.MenuGroup>
            <Menu.MenuItem
                id="voice-reject-user"
                label="Reject from voice"
                action={async () => {
                    try {
                        await rejectUser(user.id, guildId);
                    } catch (err) {
                        logger.error("failed to reject user from the context menu", err);
                        showNotification({
                            title: "VoiceReject could not send the command",
                            body: err instanceof Error ? err.message : String(err)
                        });
                    }
                }}
            />
        </Menu.MenuGroup>
    ));
};

/* --------------------------------------------------------- settings UI */

const inputStyle = {
    background: "var(--input-background, #1e1f22)",
    border: "1px solid var(--input-border, #2b2d31)",
    borderRadius: "3px",
    color: "var(--text-normal, #dbdee1)",
    fontSize: "12px",
    padding: "4px 6px"
} as const;

const smallButtonStyle = {
    ...inputStyle,
    cursor: "pointer",
    padding: "4px 8px"
} as const;

const labelStyle = {
    fontSize: "11px",
    fontWeight: 600,
    opacity: 0.7,
    textTransform: "uppercase",
    letterSpacing: "0.02em"
} as const;

const hintStyle = {
    fontSize: "11px",
    opacity: 0.55,
    marginTop: "-3px"
} as const;

const TONE_COLOURS = {
    ok: "var(--text-positive, #248046)",
    warn: "var(--status-warning, #f0b132)",
    error: "var(--status-danger, #da373c)"
} as const;

/**
 * Verdict on a channel id typed into the manual field, so a bad paste is caught
 * before you rely on it. Uses the channel's own predicates rather than numeric
 * channel-type constants, which Discord reshuffles between builds.
 */
function describeChannelId(rawId: string, guildId: string): { text: string; tone: keyof typeof TONE_COLOURS; } {
    const id = rawId.trim();
    if (!id)
        return { text: "Empty — the reject button will refuse to send until a channel is set.", tone: "warn" };

    if (!/^\d{16,20}$/.test(id))
        return { text: "That is not a channel id — it should be a long number like 1558949436791591032.", tone: "error" };

    const channel = ChannelStore.getChannel(id);
    if (!channel) return { text: "No channel with that id is known to this account.", tone: "error" };

    // Voice and stage channels are valid targets: Discord gives them a text chat
    // and the message API accepts it. Say so rather than blocking — a red error
    // here would be a lie about a configuration that works.
    const isVoice = channel.isGuildVocal?.() === true;
    const suffix = isVoice ? " (a voice channel — its text chat is used)" : "";

    const label = channel.guild_id ? `#${channel.name}` : channel.isDM?.() ? "a direct message" : channel.name ?? id;

    if (channel.guild_id && channel.guild_id !== guildId) {
        const owner = GuildStore.getGuild(channel.guild_id)?.name ?? "another server";
        return { text: `That is ${label} in ${owner} — allowed, but check it is intended.`, tone: "warn" };
    }

    return { text: `Sends to ${label}${suffix}.`, tone: isVoice ? "warn" : "ok" };
}

/** Auto-updating "here is what actually gets sent" box. */
function CommandPreview({ template, label }: { template: string; label: string; }) {
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "3px" }}>
            <div style={labelStyle}>{label}</div>
            <div
                style={{
                    background: "var(--background-secondary, #2b2d31)",
                    border: "1px solid var(--background-modifier-accent, #3f4147)",
                    borderRadius: "3px",
                    fontFamily: "var(--font-code, monospace)",
                    fontSize: "12px",
                    overflowWrap: "anywhere",
                    padding: "5px 7px",
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-all"
                }}
            >
                {applyTemplate(template, SAMPLE_USER_ID, SAMPLE_USERNAME)}
            </div>
            <div style={hintStyle}>
                Live preview — updates as you type. {"{userId}"} is shown as {SAMPLE_USER_ID}{" "}
                and {"{username}"} as {SAMPLE_USERNAME}; a real click uses the clicked person.
            </div>
        </div>
    );
}

/**
 * One configured server. It keeps its own draft of the two optional fields so
 * the preview updates on every keystroke, while each change is written straight
 * through to the plugin settings.
 */
function ServerCard({ guildId, conf, isCurrentGuild, selectedChannelId, onChange }: {
    guildId: string;
    conf: ServerConfig;
    isCurrentGuild: boolean;
    selectedChannelId?: string;
    onChange: () => void;
}) {
    const [draftCommand, setDraftCommand] = useState(conf.command ?? "");
    const [draftDelay, setDraftDelay] = useState(conf.delaySeconds === undefined ? "" : String(conf.delaySeconds));
    const [draftChannel, setDraftChannel] = useState(conf.channelId ?? "");

    const guildName = GuildStore.getGuild(guildId)?.name ?? `Unknown server (${guildId})`;

    // Which of this server's two optional fields differ from the global defaults.
    // Read off the drafts so the header reacts as you type.
    const overrides = [
        draftCommand.trim() ? "command" : null,
        draftDelay.trim() ? "delay" : null
    ].filter((v): v is string => v !== null);

    // Derived from the draft, not from the saved config, so the header and the
    // verdict below both react to every keystroke.
    const channelVerdict = describeChannelId(draftChannel, guildId);
    const resolved = ChannelStore.getChannel(draftChannel.trim());
    const channelName = draftChannel.trim()
        ? resolved
            ? resolved.guild_id ? `#${resolved.name}` : resolved.name ?? "direct message"
            : draftChannel.trim()
        : "no channel";

    return (
        <div
            style={{
                border: "1px solid var(--background-modifier-accent, #3f4147)",
                borderRadius: "4px",
                display: "flex",
                flexDirection: "column",
                gap: "6px",
                padding: "8px"
            }}
        >
            <div style={{ fontSize: "13px", fontWeight: 600 }}>
                {guildName} <span style={{ opacity: 0.6, fontWeight: 400 }}>→ {channelName}</span>
                <span style={{ fontSize: "11px", fontWeight: 400, marginLeft: "6px", opacity: 0.75, color: overrides.length ? TONE_COLOURS.ok : undefined }}>
                    {overrides.length ? `· custom ${overrides.join(" + ")}` : "· using the defaults"}
                </span>
            </div>

            <div style={labelStyle}>Reject channel</div>
            <div style={{ display: "flex", gap: "6px" }}>
                <input
                    style={{ ...inputStyle, flex: 1, minWidth: 0 }}
                    placeholder="paste a channel id, or use the button"
                    value={draftChannel}
                    onChange={e => {
                        const { value } = e.currentTarget;
                        setDraftChannel(value);

                        // only a plausible id is worth persisting
                        const trimmed = value.trim();
                        updateServerConfig(guildId, { channelId: /^\d{16,20}$/.test(trimmed) ? trimmed : undefined });
                    }}
                />
                {isCurrentGuild && selectedChannelId && (
                    <button
                        style={smallButtonStyle}
                        onClick={() => {
                            setDraftChannel(selectedChannelId);
                            updateServerConfig(guildId, { channelId: selectedChannelId });
                            onChange();
                        }}
                    >
                        Use current channel
                    </button>
                )}
            </div>
            <div style={{ fontSize: "11px", color: TONE_COLOURS[channelVerdict.tone] }}>
                {channelVerdict.text}
            </div>

            <div style={labelStyle}>Command for this server</div>
            <input
                style={inputStyle}
                placeholder={`empty = use the default: ${settings.store.command}`}
                value={draftCommand}
                onChange={e => {
                    const { value } = e.currentTarget;
                    setDraftCommand(value);
                    updateServerConfig(guildId, { command: value || undefined });
                }}
            />
            <div style={hintStyle}>
                {draftCommand.trim()
                    ? "This server sends its own command — other servers are unaffected."
                    : "This server has no command of its own and uses the default above. Type one to give it a different command."}
            </div>

            <CommandPreview
                template={draftCommand.trim() || settings.store.command}
                label={draftCommand.trim() ? "Will send (this server's command)" : "Will send (the default command)"}
            />

            <div style={labelStyle}>Delete after — seconds for this server</div>
            <input
                style={inputStyle}
                type="number"
                min={0}
                step={1}
                placeholder={`empty = ${settings.store.delaySeconds}`}
                value={draftDelay}
                onChange={e => {
                    // a plain number: 1, 2, … (0 = keep the message)
                    const raw = e.currentTarget.value;
                    setDraftDelay(raw);

                    const trimmed = raw.trim();
                    if (trimmed === "") return updateServerConfig(guildId, { delaySeconds: undefined });

                    const seconds = Number(trimmed);
                    if (Number.isFinite(seconds) && seconds >= 0)
                        updateServerConfig(guildId, { delaySeconds: seconds });
                }}
            />

            <div style={{ display: "flex", gap: "8px" }}>
                <button
                    style={smallButtonStyle}
                    onClick={() => {
                        updateServerConfig(guildId, null);
                        onChange();
                    }}
                >
                    Remove this server
                </button>
            </div>
        </div>
    );
}

function ServerSettings() {
    // subscribe so the list re-renders whenever the config changes
    const { perServer } = settings.use(["perServer"]);
    const [, setVersion] = useState(0);

    let config: Record<string, ServerConfig> = {};
    try {
        config = JSON.parse(perServer || "{}") ?? {};
    } catch {
        config = {};
    }

    const selectedChannelId = SelectedChannelStore.getChannelId();
    const selectedChannel = selectedChannelId ? ChannelStore.getChannel(selectedChannelId) : null;
    // only guild text channels can receive the command
    const selectedGuildId: string | undefined = selectedChannel?.guild_id;
    const selectedGuild = selectedGuildId ? GuildStore.getGuild(selectedGuildId) : null;

    const entries = Object.entries(config);

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <div style={{ fontSize: "12px", opacity: 0.8 }}>
                <b>1.</b> Open the text channel the command should be sent to.{" "}
                <b>2.</b> Press &ldquo;Use #channel for …&rdquo; below. That is the whole setup —
                the command and the delay are optional, and their defaults already work.
                <br />
                Every server is configured separately: give one its own command and the others
                keep the default.
                <br />
                Prefer to be explicit, or configuring a channel you cannot open? Paste its
                channel id into the &ldquo;Reject channel&rdquo; box of any server below instead.
            </div>

            {selectedGuild && selectedChannel
                ? (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <button
                            style={smallButtonStyle}
                            onClick={() => {
                                updateServerConfig(selectedGuildId!, { channelId: selectedChannel.id });
                                setVersion(v => v + 1);
                            }}
                        >
                            Use #{selectedChannel.name} for {selectedGuild.name}
                        </button>
                        <span style={{ fontSize: "12px", opacity: 0.7 }}>
                            {config[selectedGuildId!]?.channelId === selectedChannel.id
                                ? "already configured"
                                : "current channel"}
                        </span>
                    </div>
                )
                : (
                    <div style={{ fontSize: "12px", opacity: 0.6 }}>
                        Open a server text channel to configure it.
                    </div>
                )}

            <CommandPreview template={settings.store.command} label="Default command — used by any server that has no command of its own" />

            {entries.length === 0
                ? <div style={{ fontSize: "12px", opacity: 0.6 }}>No server configured yet.</div>
                : entries.map(([guildId, conf]) => (
                    <ServerCard
                        key={guildId}
                        guildId={guildId}
                        conf={conf}
                        isCurrentGuild={selectedGuildId === guildId}
                        selectedChannelId={selectedChannel?.id}
                        onChange={() => setVersion(v => v + 1)}
                    />
                ))}
        </div>
    );
}

const settings = definePluginSettings({
    command: {
        type: OptionType.STRING,
        description: "Command sent when you click a reject button. The user id is appended for you; " +
            "optionally place {userId} or {username} yourself to put it somewhere else in the command.",
        default: DEFAULT_COMMAND
    },
    delaySeconds: {
        type: OptionType.NUMBER,
        description: "Seconds before the sent command is deleted — a plain number like 1 or 2 (0 = keep it).",
        default: DEFAULT_DELAY_SECONDS
    },
    servers: {
        type: OptionType.COMPONENT,
        component: ServerSettings
    },
    perServer: {
        type: OptionType.STRING,
        description: "Raw per-server config, managed by the UI above.",
        default: "{}",
        hidden: true
    }
});

export default definePlugin({
    name: "VoiceReject",
    description: "One-click reject button next to every member of the voice channel you are in",
    authors: [{ name: "kal", id: 1510574590013866020n }],
    enabledByDefault: true,
    settings,

    contextMenus: {
        "user-context": UserContext
    },

    start() {
        styleElement = document.createElement("style");
        styleElement.textContent = HOVER_CSS;
        document.head.append(styleElement);
        logger.info("ready");
    },

    stop() {
        styleElement?.remove();
        styleElement = undefined;
    },

    // Rendered by the patch below — `$self` resolves to this plugin object.
    renderRejectButton,

    patches: [
        {
            // The voice-channel member row. `"VoiceUser"` is an experiment key
            // unique to the module rendering the `voiceUser_*` rows.
            find: '"VoiceUser"',
            replacement: {
                // The row's content wrapper: prepending to its children array
                // puts the button before the avatar, i.e. to its left.
                match: /className:a\(\)\((\i)\.Qs,\{\[\1\.zq\]:\i\}\),children:\[/,
                replace: "$&$self.renderRejectButton(Y.id,K),"
            }
        }
    ]
});
