# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## 1.0.0 - 2026-10-12

First release. Verified against Discord **0.0.415** (stable) and **0.0.1368**
(Canary).

### Added

- A reject button next to every other member of the voice channel you are
  connected to, injected by a Vencord text patch on the module that renders the
  `voiceUser_*` rows. The button is hidden until you hover the row and takes no
  layout space, so the member list never shifts.
- **Reject from voice** in the member context menu.
- A configurable command per server, defaulting to `.v reject {userId}` and to a
  global fallback. `{userId}`, `{id}` and `{username}` placeholders, all optional —
  a template with no placeholder has the user id appended.
- Per-server auto-delete delay, in whole seconds (`0` keeps the message).
- Per-server reject channel, chosen by pressing *Use current channel* while
  viewing it, or by pasting a channel id with live validation.
- Live **Will send** preview in the settings, rendered by the same function the
  sender uses so it cannot drift from what is actually sent.
- `· custom command` / `· using the defaults` badges so it is clear which servers
  override the global settings.

### Notes

- Sending to a voice or stage channel is allowed: Discord gives them a text chat,
  and the channel field says so instead of flagging it as an error.
- Two Discord APIs required care: `sendMessage` defaults to
  `waitForChannelReady = true`, which never resolves for a channel that is not
  loaded in the client, and it resolves with the raw REST response rather than the
  created message (the id is at `response.body.id`).
