"use strict";

// aternos-afk-bot — entry point.
//
// Starts the bot connection and the HTTP dashboard, then keeps both running.
// The real work lives in src/:
//   src/client/   Minecraft protocol (26.3 / 777) client
//   src/bot/      reconnect policy, modules, Discord webhook
//   src/http/     dashboard, health, logs, control endpoints

const { addLog } = require("./src/logger");
const config = require("./settings.json");
const controller = require("./src/bot/controller");
const httpServer = require("./src/http/server");

addLog("=".repeat(50));
addLog(`  ${config.name} v2.6.0`);
addLog("=".repeat(50));
addLog(`Server: ${config.server.ip}:${config.server.port}`);
addLog(`Version: ${config.server.version}`);
addLog(
  `Auto-Reconnect: ${config.utils["auto-reconnect"] ? "Enabled" : "Disabled"}`,
);
addLog("=".repeat(50));

httpServer.start();
controller.createBot();

module.exports = { controller, httpServer };