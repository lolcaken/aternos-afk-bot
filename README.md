# pasted aternos

![node](https://img.shields.io/badge/node-%3E%3D18-5FA04E?style=flat-square&logo=node.js)
![protocol](https://img.shields.io/badge/protocol-777%20(26.3)-7B2FBE?style=flat-square)
![deps](https://img.shields.io/badge/dependencies-1-5FA04E?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)
![status](https://img.shields.io/badge/status-stable-green?style=flat-square)

**How to keep an Aternos server online 24/7 without paying** — an AFK bot that
logs in and holds the connection open so Aternos never sees an idle server.

A headless Minecraft client that keeps an Aternos server alive by holding a
connection open. Speaks **protocol 777 (26.3)** natively — no Minecraft account,
no launcher, no `mineflayer`.

![what it does](https://img.shields.io/badge/keeps-Aternos%20online-7B2FBE?style=for-the-badge&logo=discord&logoColor=white)

> **TL;DR** — `git clone https://github.com/lolcaken/pasted-aternos.git`,
> `npm install`, put your server address in `settings.json`, turn on **Cracked**
> mode in Aternos, then `npm start`.

---

## Why does my Aternos server keep shutting down?

Aternos stops a server after it sits idle with no players. Every free server
gets a countdown, and when it hits zero the server stops. Being the one person
logged in prevents that — and a bot does it for you, forever, without you
having to sit in the client.

This is the "Aternos AFK bot" approach: the bot connects, stays connected, and
answers the server's keep-alives so it is never treated as disconnected.

### Most existing AFK bots don't work on modern servers

Most Aternos AFK bots use `mineflayer`, which only knows protocol **775 (26.1)**.
On a 26.3 server, ViaVersion has to translate every packet, and it mistranslates
the movement ones — the client gets kicked about a second after joining:

```
Kicked: Invalid move player packet received
```

This client declares **777** directly, so there is no translation layer and
nothing to mistranslate.

---

## FAQ

### How do I keep my Aternos server online 24/7 for free?

Run this bot on any always-on machine (VPS, Railway, Render, a Raspberry Pi)
or on your own PC. Start it and leave it. Setup is four steps: clone, `npm
install`, edit `settings.json`, `npm start`. Full instructions below.

### Does it need a paid Minecraft account?

No. It connects in **offline (cracked) mode** with any username. That does
require **Cracked mode enabled** in your Aternos options, because online-mode
servers require Microsoft authentication and will refuse the login.

### Will Aternos ban me for this?

Aternos' terms prohibit using bots to keep servers running. Use it at your own
risk, and expect it to stop working when Aternos updates their detection.

### Why does the bot need to be running 24/7?

Because the bot *is* the uptime. The moment it disconnects, Aternos starts the
idle countdown again. That's why it's built to reconnect automatically — see
[Reconnect behaviour](#reconnect-behaviour).

### Does it work on Bedrock?

No. This speaks the Java Edition protocol only. Bedrock is a different protocol
entirely.

### Can I use it to stay on while playing?

Yes, but that's unnecessary — just log in yourself while you play. This is for
when nobody is on.

---

## Requirements

- **Node.js 18 or newer** (no native builds, nothing to compile)
- **Aternos server** with **Cracked / offline mode enabled**
- Nothing else. One dependency: `express`.

> **Cracked mode is mandatory.** With online-mode on, the server asks for
> Microsoft authentication and an offline bot cannot log in. The client detects
> this and says so instead of hanging.

---

## Setup

**1. Get the files**

```bash
git clone https://github.com/lolcaken/pasted-aternos.git
cd pasted-aternos
npm install
```

**2. Enable cracked mode on Aternos**

Server options → **Cracked: ON**. Also install
`ViaVersion`, `ViaBackwards` and `ViaRewind` if you want older clients to connect.

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
  "displayName": "pasted aternos",
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

### Reconnect behaviour

The bot treats the server like a real player would:

| Situation | Delay |
|---|---|
| Server empty, nothing to protect | 1 minute |
| Real players online | 3 minutes |
| Server never came online | 10–15 minutes |
| Server throttling us | 1–2 minutes |

It also survives being kicked mid-session and reconnects by itself, so you don't
have to babysit it.

---

## Who is this for

Anyone whose **Aternos server shuts down while they're away** — building an SMP,
running events for friends, or just wanting the server to exist without paying
for hosting. Also useful for **keeping a test or event server warm** between
sessions.

Search terms, if you got here from Google: *aternos 24/7*, *aternos afk bot*,
*keep aternos server online*, *aternos server keeps shutting down*, *free
minecraft server 24/7*, *aternos bot 2026*, *minecraft headless client*, *aternos
cracked bot*.

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