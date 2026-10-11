// HTTP server: dashboard, health, logs, control endpoints, and the
// keep-alive self-ping that stops free hosts sleeping the process.
"use strict";

const express = require("express");
const http = require("http");
const https = require("https");

const config = require("../../settings.json");
const { getLogs } = require("../logger");
const views = require("./views");
const bot = require("../bot/controller");

const PORT = process.env.PORT || 5000;
const SELF_PING_INTERVAL = 10 * 60 * 1000;
const MEMORY_INTERVAL = 5 * 60 * 1000;

const app = express();
app.use(express.json());

// ---- pages -------------------------------------------------------------
app.get("/", (req, res) => res.send(views.dashboard(config)));

app.get("/tutorial", (req, res) => res.send(views.tutorial(config)));

app.get("/logs", (req, res) =>
  res.send(views.logsView(config, getLogs())),
);

// ---- monitoring --------------------------------------------------------
app.get("/health", (req, res) => {
  res.json({
    status: bot.botState.connected ? "connected" : "disconnected",
    uptime: Math.floor((Date.now() - bot.botState.startTime) / 1000),
    coords: bot.bot ? bot.bot.entity.position : null,
    lastActivity: bot.botState.lastActivity,
    reconnectAttempts: bot.botState.reconnectAttempts,
    memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024,
  });
});

app.get("/ping", (req, res) => res.send("pong"));

// ---- control -----------------------------------------------------------
app.post("/start", (req, res) => {
  if (bot.botRunning) return res.json({ success: false, msg: "Already running" });
  bot.botRunning = true;
  bot.createBot();
  bot.addLog("[Control] Bot started");
  res.json({ success: true });
});

app.post("/stop", (req, res) => {
  if (!bot.botRunning) return res.json({ success: false, msg: "Already stopped" });
  bot.botRunning = false;
  if (bot.bot) {
    bot.bot.end();
    bot.bot = null;
  }
  bot.clearAllIntervals();
  bot.addLog("[Control] Bot stopped");
  res.json({ success: true });
});

app.post("/command", (req, res) => {
  const cmd = (req.body.command || "").trim();
  if (!cmd) return res.json({ success: false, msg: "Empty command." });

  bot.addLog(`[Console] > ${cmd}`);

  if (cmd === "/help") {
    const lines = [
      "Available commands:",
      "  /help          - Show this help message",
      "  /pos           - Show bot's current coordinates",
      "  /status        - Show bot connection status",
      "  /list          - Ask server for player list",
      "  /say <message> - Send a chat message in-game",
      "  /<anything>    - Send any Minecraft command directly",
      "  <text>         - Send plain chat (no slash needed)",
    ];
    lines.forEach((l) => bot.addLog(`[Console] ${l}`));
    return res.json({ success: true, msg: lines.join("\n") });
  }

  if (cmd === "/pos" || cmd === "/coords") {
    const pos = bot.bot && bot.bot.entity ? bot.bot.entity.position : null;
    const msg = pos
      ? `Position: X=${Math.floor(pos.x)}  Y=${Math.floor(pos.y)}  Z=${Math.floor(pos.z)}`
      : "Position unavailable (bot not spawned).";
    bot.addLog(`[Console] ${msg}`);
    return res.json({ success: true, msg });
  }

  if (cmd === "/status") {
    const status = bot.botState.connected ? "Connected" : "Disconnected";
    const uptime = Math.floor((Date.now() - bot.botState.startTime) / 1000);
    const msg = `Status: ${status} | Uptime: ${uptime}s | Reconnects: ${bot.botState.reconnectAttempts}`;
    bot.addLog(`[Console] ${msg}`);
    return res.json({ success: true, msg });
  }

  if (!bot.bot || typeof bot.bot.chat !== "function") {
    const msg = bot.bot
      ? "Bot is still connecting â€” try again in a moment."
      : "Bot is not running.";
    bot.addLog(`[Console] ${msg}`);
    return res.json({ success: false, msg });
  }

  try {
    bot.bot.chat(cmd);
    bot.addLog(`[Console] Sent to server: ${cmd}`);
    return res.json({ success: true, msg: `Sent: ${cmd}` });
  } catch (err) {
    bot.addLog(`[Console] Error: ${err.message}`);
    return res.json({ success: false, msg: err.message });
  }
});

function start() {
  // PING: free hosts sleep idle web services, so hit ourselves periodically.
  // Only active where the host advertises its own URL (e.g. Render).
  const renderUrl = process.env.RENDER_EXTERNAL_URL;
  if (!renderUrl) {
    bot.addLog(
      "[KeepAlive] No RENDER_EXTERNAL_URL set - self-ping disabled (running locally)",
    );
  } else {
    setInterval(() => {
      const protocol = renderUrl.startsWith("https") ? https : http;
      protocol
        .get(`${renderUrl}/ping`, () => {})
        .on("error", (err) => bot.addLog(`[KeepAlive] Self-ping failed: ${err.message}`));
    }, SELF_PING_INTERVAL);
    bot.addLog("[KeepAlive] Self-ping system started (every 10 min)");
  }

  setInterval(() => {
    const heapMB = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2);
    bot.addLog(`[Memory] Heap: ${heapMB} MB`);
  }, MEMORY_INTERVAL);

  const server = app.listen(PORT, "0.0.0.0", () => {
    bot.addLog(`[Server] HTTP server started on port ${server.address().port} `);
  });

  // Fall back to the next port if something already holds this one.
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      const fallbackPort = PORT + 1;
      bot.addLog(`[Server] Port ${PORT} in use - trying port ${fallbackPort} `);
      server.listen(fallbackPort, "0.0.0.0");
    } else {
      bot.addLog(`[Server] HTTP server error: ${err.message} `);
    }
  });

  return server;
}

module.exports = { app, start };