"use strict";

// Bot lifecycle: connection state, reconnect policy, module wiring, console
// commands and crash recovery. Exports bot / botState for the HTTP layer.

const config = require("../../settings.json");
const { addLog } = require("../logger");
const { createClient } = require("../client");
const { sendDiscordWebhook } = require("./discord");
const { initializeModules } = require("./modules");
const state = require("./state");

// Live state (bot, botState, botRunning, spawn counters, intervals) lives in
// ./state so modules.js can read it without importing this module.
const { SETTLE_MS } = state;
const botState = state.botState;

// Local aliases for the mutable pieces of shared state. Reassigned on write,
// so reads below stay terse while the single source of truth remains ./state.
let bot = state.bot;
let botRunning = state.botRunning;
let lastLoginError = state.lastLoginError;

const syncState = () => {
  state.bot = bot;
  state.botRunning = botRunning;
  state.lastLoginError = lastLoginError;
};

// Reconnect timers owned by this module.
let reconnectTimeoutId = null;
let connectionTimeoutId = null;
let isReconnecting = false;

function clearBotTimeouts() {
  if (reconnectTimeoutId) {
    clearTimeout(reconnectTimeoutId);
    reconnectTimeoutId = null;
  }
  if (connectionTimeoutId) {
    clearTimeout(connectionTimeoutId);
    connectionTimeoutId = null;
  }
}

// v2.6 freeze: no movement/look input until the spawn has settled AND the
// position is confirmed finite. Paper kicks ("Invalid move player packet")
// the first malformed position packet, which is what killed every 26.1
// session ~1s after spawn through the Via translation layer.
function hasSettled() {
  const bot = state.bot;
  if (!bot || !state.botState.connected) return false;
  if (Date.now() - state.lastSpawnAt < SETTLE_MS) return false;
  const p = bot.entity && bot.entity.position;
  return !!(
    p &&
    Number.isFinite(p.x) &&
    Number.isFinite(p.y) &&
    Number.isFinite(p.z)
  );
}

function addInterval(callback, delay) {
  return state.addInterval(callback, delay);
}

// Tear down every timer owned by the modules layer in one go.
function clearAllIntervals() {
  state.clearAllIntervals();
}

function getReconnectDelay() {
  if (botState.wasThrottled) {
    botState.wasThrottled = false;
    const throttleDelay = 60000 + Math.floor(Math.random() * 60000);
    addLog(
      `[Bot] Throttle detected - using extended delay: ${throttleDelay / 1000}s`,
    );
    return throttleDelay;
  }

  // v2.6: never spawned this process. Either the server is offline, or the
  // login was refused (online-mode, or a plugin rejection). Both are worth
  // waiting on, but the wording has to say which one happened.
  if (state.spawnCount === 0) {
    const offlineDelay = 600000 + Math.floor(Math.random() * 300000);
    addLog(
      lastLoginError
        ? `[Bot] Login refused (${lastLoginError}) - retrying in ${Math.floor(offlineDelay / 1000)}s`
        : `[Bot] Never spawned - server appears offline, retrying in ${Math.floor(offlineDelay / 1000)}s`,
    );
    return offlineDelay;
  }

  const baseDelay = config.utils["auto-reconnect-delay"] || 60000;
  const maxDelay = config.utils["max-reconnect-delay"] || 60000;

  // Empty server -> reconnect quickly (nobody waiting).
  // Real players on -> stay offline longer so the server can actually idle out.
  const otherPlayers = Math.max(
    0,
    Object.keys(bot && bot.players ? bot.players : {}).length - 1,
  );
  const hasPlayers = otherPlayers > 0;
  const delay = hasPlayers ? maxDelay : baseDelay;

  const jitter = Math.floor(Math.random() * 2000);
  addLog(
    `[Bot] Reconnect delay: ${delay / 1000}s (${otherPlayers} other player${
      otherPlayers === 1 ? "" : "s"
    } online)`,
  );
  return delay + jitter;
}

function createBot() {
  if (isReconnecting) {
    addLog("[Bot] Already reconnecting, skipping...");
    return;
  }

  // Cleanup previous bot properly to avoid ghost bots
  if (bot) {
    clearAllIntervals();
    try {
      bot.removeAllListeners();
      bot.end();
    } catch (e) {
      addLog("[Cleanup] Error ending previous bot:", e.message);
    }
    bot = null;
    syncState();
  }

  addLog(`[Bot] Creating bot instance...`);
  addLog(`[Bot] Connecting to ${config.server.ip}:${config.server.port}`);

  try {
    // pasted-client speaks protocol 777 (26.3) directly, so the server
    // never has to translate through ViaVersion - mistranslated movement
    // packets were what produced "Invalid move player packet received".
    bot = createClient({
      host: config.server.ip,
      port: config.server.port,
      username: config["bot-account"].username,
    });
    syncState();

    let spawnHandled = false;

    bot.once("spawn", () => {
      if (spawnHandled) return;
      spawnHandled = true;

      clearBotTimeouts();
      botState.connected = true;
      botState.lastActivity = Date.now();
      botState.reconnectAttempts = 0;
      isReconnecting = false;
      lastLoginError = null;
      syncState();

      addLog(
        `[Bot] [+] Successfully spawned on server! (Version: ${bot.version})`,
      );
      const onlineCount = Object.keys(bot.players || {}).length;
      const statusLine = `server status: ${onlineCount}/20`;
      addLog(`[Status] ${statusLine}`);

      if (
        config.discord &&
        config.discord.events &&
        config.discord.events.connect
      ) {
        sendDiscordWebhook(statusLine, 0x4ade80);
      }

      initializeModules(bot);
    });

    bot.on("chat", (m) => {
      const message = m && m.text ? m.text : "";
      if (
        message.includes("commands.gamemode.success.self") ||
        message.includes("Set own game mode to Creative Mode")
      ) {
        addLog("[INFO] Bot is now in Creative Mode.");
      }
    });

    // FIX: 'kicked' fires before 'end'. Remove the scheduleReconnect from 'kicked'
    // so that 'end' is the single source of reconnect truth, preventing double-trigger.
    bot.on("kicked", (reason) => {
      // FIX: stringify reason if it's an object to make it readable in logs
      const kickReason =
        typeof reason === "object" ? JSON.stringify(reason) : reason;
      addLog(`[Bot] Kicked: ${kickReason}`);
      botState.connected = false;
      botState.errors.push({
        type: "kicked",
        reason: kickReason,
        time: Date.now(),
      });
      clearAllIntervals();

      // A refusal before we ever spawned (online-mode, auth plugin) is a
      // configuration problem, not a mid-session kick. Record it so the
      // backoff log can say so instead of blaming an offline server.
      if (!state.lastSpawnAt) {
        lastLoginError =
          reason && reason.text ? reason.text : String(kickReason);
        syncState();
      }

      const reasonStr = String(kickReason).toLowerCase();
      if (
        reasonStr.includes("throttl") ||
        reasonStr.includes("wait before reconnect") ||
        reasonStr.includes("too fast")
      ) {
        addLog(
          "[Bot] Throttle kick detected - will use extended reconnect delay",
        );
        botState.wasThrottled = true;
      }

      if (
        config.discord &&
        config.discord.events &&
        config.discord.events.disconnect
      ) {
        sendDiscordWebhook(`[!] **Kicked**: ${kickReason}`, 0xff0000);
      }
      // NOTE: do NOT call scheduleReconnect() here - 'end' will fire right after 'kicked' and handle it
    });

    // FIX: 'end' is the single reconnect trigger
    bot.on("end", (reason) => {
      addLog(`[Bot] Disconnected: ${reason || "Unknown reason"}`);
      botState.connected = false;
      clearAllIntervals();
      spawnHandled = false; // reset for next connection

      if (
        config.discord &&
        config.discord.events &&
        config.discord.events.disconnect
      ) {
        sendDiscordWebhook(
          `[-] **Disconnected**: ${reason || "Unknown"}`,
          0xf87171,
        );
      }

      // ALWAYS reconnect â€” bot must never leave the server
      scheduleReconnect();
    });

    bot.on("error", (err) => {
      const msg = err.message || "";
      addLog(`[Bot] Error: ${msg}`);
      botState.errors.push({ type: "error", message: msg, time: Date.now() });
      // Don't reconnect on error - let 'end' event handle it
    });

    // FIX: connection timeout - end the old bot before reconnecting to avoid ghost bots
    clearBotTimeouts();
    connectionTimeoutId = setTimeout(() => {
      if (!botState.connected) {
        addLog("[Bot] Connection timeout - no spawn received");
        try {
          bot.removeAllListeners();
          bot.end();
        } catch (e) {
          /* ignore */
        }
        bot = null;
        scheduleReconnect();
      }
    }, 150000); // 150s - Aternos servers can take 90-120s to finish spawning a player

    bot.connect();
  } catch (err) {
    addLog(`[Bot] Failed to create bot: ${err.message}`);
    scheduleReconnect();
  }
}

function scheduleReconnect() {
  clearBotTimeouts();

  // FIX: don't stack reconnect if already waiting
  if (isReconnecting) {
    addLog("[Bot] Reconnect already scheduled, skipping duplicate.");
    return;
  }

  isReconnecting = true;
  botState.reconnectAttempts++;

  const delay = getReconnectDelay();
  addLog(
    `[Bot] Reconnecting in ${delay / 1000}s (attempt #${botState.reconnectAttempts})`,
  );

  reconnectTimeoutId = setTimeout(() => {
    reconnectTimeoutId = null;
    isReconnecting = false;
    createBot();
  }, delay);
}

function chatModule(bot) {
  bot.on("chat", (username, message) => {
    if (!bot || username === bot.username) return;

    try {
      // FIX: send chat events to Discord if enabled
      if (
        config.discord &&
        config.discord.enabled &&
        config.discord.events &&
        config.discord.events.chat
      ) {
        sendDiscordWebhook(`ðŸ’¬ **${username}**: ${message}`, 0x7289da);
      }

      if (config.chat && config.chat.respond) {
        const lowerMsg = message.toLowerCase();
        if (lowerMsg.includes("hello") || lowerMsg.includes("hi")) {
          bot.chat(`Hello, ${username}!`);
        }
        if (message.startsWith("!tp ")) {
          const target = message.split(" ")[1];
          if (target) bot.chat(`/tp ${target}`);
        }
      }
    } catch (e) {
      addLog("[Chat] Error:", e.message);
    }
  });
}

// ============================================================
const readline = require("readline");
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

rl.on("line", (line) => {
  if (!bot || !botState.connected) {
    addLog("[Console] Bot not connected");
    return;
  }

  const trimmed = line.trim();
  if (trimmed.startsWith("say ")) {
    bot.chat(trimmed.slice(4));
  } else if (trimmed.startsWith("cmd ")) {
    bot.chat("/" + trimmed.slice(4));
  } else if (trimmed === "status") {
    addLog(
      `Connected: ${botState.connected}, Uptime: ${formatUptime(Math.floor((Date.now() - botState.startTime) / 1000))}`,
    );
  } else {
    bot.chat(trimmed);
  }
});

// ============================================================
// CRASH RECOVERY - IMMORTAL MODE
// FIX: guard against uncaughtException stacking reconnects when isReconnecting is already true
// ============================================================
process.on("uncaughtException", (err) => {
  const msg = err.message || "Unknown";
  addLog(`[FATAL] Uncaught Exception: ${msg}`);
  botState.errors.push({ type: "uncaught", message: msg, time: Date.now() });

  // Cap errors array to prevent memory leak over long uptimes
  if (botState.errors.length > 100) {
    botState.errors = botState.errors.slice(-50);
  }

  const isNetworkError =
    msg.includes("PartialReadError") ||
    msg.includes("ECONNRESET") ||
    msg.includes("EPIPE") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("timed out") ||
    msg.includes("write after end") ||
    msg.includes("This socket has been ended");

  if (isNetworkError) {
    addLog("[FATAL] Known network/protocol error - recovering gracefully...");
  }

  // ALWAYS recover â€” bot must never stay disconnected
  clearAllIntervals();
  botState.connected = false;

  // FIX: reset isReconnecting if it was stuck, then schedule reconnect
  if (isReconnecting) {
    addLog(
      "[FATAL] isReconnecting was stuck - resetting before crash recovery",
    );
    isReconnecting = false;
    // BUG FIX: was referencing non-existent 'reconnectTimeout' â€” correct name is 'reconnectTimeoutId'
    if (reconnectTimeoutId) {
      clearTimeout(reconnectTimeoutId);
      reconnectTimeoutId = null;
    }
  }

  setTimeout(
    () => {
      scheduleReconnect();
    },
    isNetworkError ? 5000 : 10000,
  );
});

process.on("unhandledRejection", (reason) => {
  const msg = String(reason);
  addLog(`[FATAL] Unhandled Rejection: ${reason}`);
  botState.errors.push({ type: "rejection", message: msg, time: Date.now() });
  if (botState.errors.length > 100) {
    botState.errors = botState.errors.slice(-50);
  }

  const isNetworkError =
    msg.includes("ETIMEDOUT") ||
    msg.includes("ECONNRESET") ||
    msg.includes("EPIPE") ||
    msg.includes("ENOTFOUND") ||
    msg.includes("timed out") ||
    msg.includes("PartialReadError");

  if (isNetworkError && !isReconnecting) {
    addLog("[FATAL] Network rejection â€” triggering reconnect...");
    clearAllIntervals();
    botState.connected = false;
    if (bot) {
      try { bot.end(); } catch (_) {}
      bot = null;
    }
    scheduleReconnect();
  }
});

process.on("SIGTERM", () => {
  addLog("[System] SIGTERM received â€” ignoring, bot will stay alive.");
});

process.on("SIGINT", () => {
  addLog("[System] SIGINT received â€” ignoring, bot will stay alive.");
});

// Getters, not snapshots: src/http/server.js reads bot / botRunning at
// request time, and both change during the reconnect cycle.
module.exports = {
  get bot() {
    return bot;
  },
  set bot(v) {
    bot = v;
    syncState();
  },
  get botRunning() {
    return botRunning;
  },
  set botRunning(v) {
    botRunning = v;
    syncState();
  },
  botState,
  createBot,
  scheduleReconnect,
  getReconnectDelay,
  clearAllIntervals,
  addLog,
};
