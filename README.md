# aternos-afk-bot

![node](https://img.shields.io/badge/node-%3E%3D18-5FA04E?style=flat-square&logo=node.js)
![protocol](https://img.shields.io/badge/protocol-777%20(26.3)-7B2FBE?style=flat-square)
![deps](https://img.shields.io/badge/dependencies-1-5FA04E?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![status](https://img.shields.io/badge/status-stable-green?style=flat-square)

A headless Minecraft client that keeps an Aternos server alive by holding a
connection open. Speaks **protocol 777 (26.3)** natively — no Minecraft account,
no launcher, no `mineflayer`.

---

## Why this exists

Aternos shuts a server down when it goes idle. A bot that just sits in the
lobby counts as a player and prevents that.

Most AFK bots for this use `mineflayer`, which only knows protocol **775 (26.1)**.
On a 26.3 server, ViaVersion has to translate every packet, and it mistranslates
the movement ones — the client gets kicked about a second after joining:

```
Kicked: Invalid move player packet received
```

This client declares **777** directly, so there is no translation layer and
nothing to mistranslate.

---

## Requirements

- **Node.js 18 or newer** (no native builds, nothing to compile)
- **Aternos server** with **Cracked / offline mode enabled**
- **ViaVersion** on the server (see below)
- Nothing else. One dependency: `express`.

> **Cracked mode is mandatory.** With online-mode on, the server asks for
> Microsoft authentication and an offline bot cannot log in. The client detects
> this and says so instead of hanging.

### Via plugins

This bot speaks **26.3**. Whether your server needs the Via family depends on
which version it runs:

| Server version | Via needed for the bot? |
|---|---|
| 26.3 | No — the bot connects natively, nothing to translate |
| Older than 26.3 | **Yes** — ViaVersion bridges the gap |

The three plugins do different jobs:

- **[ViaVersion](https://hangar.papermc.io/ViaVersion/ViaVersion)** — lets **newer
  clients join older servers**. This is the one the bot needs when your server
  isn't on 26.3.
- **[ViaBackwards](https://hangar.papermc.io/ViaVersion/ViaBackwards)** — lets **older
  clients join newer servers**. Requires ViaVersion. Not needed by the bot;
  useful so your players on 1.10–1.20 can still connect.
- **[ViaRewind](https://hangar.papermc.io/ViaVersion/ViaRewind)** — extends ViaBackwards
  down to **1.7.x / 1.8.x** clients. Requires ViaVersion *and* ViaBackwards.
  For legacy clients only.

Install all three if you want maximum version coverage for your players — the
full set is standard practice on Aternos SMPs and is what the original setup
guide recommends. The bot itself only depends on ViaVersion.

---

## Setup

**1. Get the files**

```bash
git clone https://github.com/lolcaken/pasted-aternos.git
cd pasted-aternos
npm install
```

**2. Enable cracked mode on Aternos**

Server options → **Cracked: ON**. Then install the Via plugins:

- **ViaVersion** — required if your server isn't on 26.3
- **ViaBackwards** + **ViaRewind** — optional, for older players

See [Via plugins](#via-plugins) for what each one actually does.

**3. Edit `settings.json`**

```json
"bot-account": { "username": "botlol" },
"server": {
  "ip": "your-server.aternos.me",
  "port": 12345
}
```

`port` is on the Aternos server page, next to the address.

**4. Run it**

```bash
npm start
```

Watch for the line that means it worked:

```
[Bot] [+] Successfully spawned on server! (Version: 26.3)
[Status] server status: 0/20
```

That's it — leave it running and the server stays up.

---

## Discord status (optional)

Post a message to a Discord channel on every connect, disconnect, and kick.

1. Server Settings → Integrations → **Webhooks** → New Webhook → Copy URL
2. In `settings.json`:

```json
"discord": {
  "enabled": true,
  "displayName": "aternos-afk-bot",
  "avatarUrl": "https://.../avatar.png",
  "webhookUrl": "https://discord.com/api/webhooks/...",
  "events": { "connect": true, "disconnect": true, "chat": false }
}
```

`avatarUrl` is optional. Messages arrive as embeds with your chosen name and
avatar.

> Your webhook URL is a password. Anyone holding it can post to that channel.
> Keep the repo private if you commit it, or use a private fork.

---

## Options

| Key | Default | What it does |
|---|---|---|
| `bot-account.username` | `botlol` | In-game name |
| `server.ip` / `server.port` | — | Your Aternos address |
| `utils.auto-reconnect-delay` | `60000` | Reconnect delay when the server is empty (ms) |
| `utils.max-reconnect-delay` | `180000` | Reconnect delay when real players are online (ms) |
| `utils.chat-messages.enabled` | `false` | Send a chat message after 5 reconnects |
| `utils.chat-messages.messages` | `[]` | The message(s) to send |
| `discord.enabled` | `false` | Post status to Discord |
| `position.enabled` | `false` | Walk to a set coordinate — off by default |
| `movement.circle-walk.enabled` | `false` | Circle-walk around spawn |

**Reconnect logic:** 1 minute when the server is empty, 3 minutes when real
players are on, and 10+ minutes if the server never came online at all.

---

## Dashboard

An Express server starts alongside the bot:

| Route | What it is |
|---|---|
| `/` | Status, uptime, coordinates, live bot controls |
| `/logs` | Live log stream with a built-in console |
| `/health` | JSON status for monitoring |
| `/ping` | Health check (used for keep-alive hosting) |

> `/start`, `/stop` and `/command` are **unauthenticated** — anyone who can reach
> the URL can run Minecraft commands as the bot. Bind to `127.0.0.1` and tunnel
> with SSH, or put an auth proxy in front, if the port is reachable.

### Deploying

Runs anywhere Node does — VPS, Railway, Fly.io, Render, a Raspberry Pi, or your
own machine. The only requirement is outbound TCP to your server's address and
port.

On free Render tiers the service sleeps when idle, so the bot pings itself every
10 minutes to stay awake. That activates automatically when Render sets
`RENDER_EXTERNAL_URL`; nowhere else does anything.

---

## Troubleshooting

**`Online-mode server requires Microsoft authentication`**
Turn on **Cracked** in your Aternos options.

**`Invalid move player packet received`**
The server's version doesn't match what this client speaks. This client speaks
777 (26.3). Confirm the server is on 26.3.

**`server appears offline`**
The bot connected but never reached the play state — the server is genuinely
down or still booting. It retries every 10–15 minutes.

**`ECONNRESET` right after connecting**
Usually Aternos restarting. It backs off automatically.

**Nothing in the console**
Check `npm install` ran and that port 5000 is free (`PORT=8080 npm start` to
change it).

---

## Project structure

```
index.js              entry point — starts the bot and the HTTP server
settings.json         your config (edit this)
src/
  logger.js           timestamped console log + in-memory ring buffer
  client/             the Minecraft 26.3 client
    protocol.js       VarInt/string/double codec, packet ids, connection states
    nbt.js            network-NBT reader (kick/disconnect reasons)
    index.js          connection lifecycle, login, config, play states
  bot/
    state.js          shared mutable state (connection, spawn counters, timers)
    controller.js     reconnect policy, createBot, console commands, crash recovery
    modules.js        post-spawn behaviour (the optional one-shot chat)
    discord.js        webhook sender with rate limiting
  http/
    server.js         routes, health, control endpoints, keep-alive ping
    views.js          dashboard / tutorial / log page markup
    render.js         HTML escaping and log-line colouring
test/
  codec.test.js       protocol encoding checks
```

`src/bot/state.js` exists so `controller.js` and `modules.js` share the spawn
counter and interval list without importing each other.

---

## Tests

```bash
npm test
```

Checks protocol encoding against the [Minecraft Wiki spec](https://minecraft.wiki/w/Java_Edition_protocol/Packets):
VarInt boundaries, packet framing, the unsigned chat payload, slash-command
routing, network-NBT kick reasons, and online-mode detection.

---

## How it works

Minecraft's protocol is plain TCP. A client only has to speak it correctly —
there's no renderer, no window, no assets. This implements the minimum a bot
needs:

```
handshake → login → configuration → play
```

- **handshake** — announce protocol 777, request the login state
- **login** — send the username with a derived offline UUID, enable compression
- **configuration** — client info, known packs, finish
- **play** — confirm teleports, answer keep-alives, send `client_tick_end`,
  hold position

The bot never moves. It repeats its exact confirmed position, so there is no
delta for a translation layer to corrupt, and it answers every keep-alive so it
never times out.

Chat is sent unsigned with all five required fields
(`Timestamp`, `Salt`, absent `Signature`, `Message Count`, `Acknowledged`,
`Checksum`). Slash-commands go out as `chat_command`, which carries no signature
fields at all.

---

## Credits

Protocol research: [Minecraft Wiki — Java Edition protocol](https://minecraft.wiki/w/Java_Edition_protocol/Packets).

Built from a [mineflayer](https://github.com/PrismarineJS/mineflayer) AFK bot
by Lamgerr and Slobos, rewritten to speak 26.3 directly.

## License

MIT