// Discord webhook: posts connection status to a channel.
"use strict";

const https = require("https");
const http = require("http");

const config = require("../../settings.json");
const { addLog } = require("../logger");

// Discord rejects bursts, so space sends out.
const DISCORD_RATE_LIMIT_MS = 5000;
let lastDiscordSend = 0;

function sendDiscordWebhook(content, color = 0x0099ff) {
  if (
    !config.discord ||
    !config.discord.enabled ||
    !config.discord.webhookUrl ||
    config.discord.webhookUrl.includes("YOUR_DISCORD")
  ) {
    return;
  }

  const now = Date.now();
  if (now - lastDiscordSend < DISCORD_RATE_LIMIT_MS) {
    addLog("[Discord] Rate limited - skipping webhook");
    return;
  }
  lastDiscordSend = now;

  const protocol = config.discord.webhookUrl.startsWith("https") ? https : http;
  const url = new URL(config.discord.webhookUrl);

  const payload = JSON.stringify({
    username: config.discord.displayName || "Status Bot",
    avatar_url: config.discord.avatarUrl || undefined,
    embeds: [
      {
        description: content,
        color: color,
        timestamp: new Date().toISOString(),
      },
    ],
  });

  const req = protocol.request(
    {
      hostname: url.hostname,
      port: 443,
      path: url.pathname + url.search,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // Buffer.byteLength, not .length: usernames may be multi-byte.
        "Content-Length": Buffer.byteLength(payload, "utf8"),
      },
    },
    () => {},
  );

  req.on("error", (e) => addLog(`[Discord] Error sending webhook: ${e.message}`));

  req.write(payload);
  req.end();
}

module.exports = { sendDiscordWebhook };