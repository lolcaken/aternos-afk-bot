// Shared mutable state for the bot runtime.
//
// Kept in one place so controller.js (lifecycle) and modules.js (post-spawn
// behaviour) can both read and write the same values without a circular
// import. Exported as a frozen shape with getters/setters over module-level
// variables so writes from either module are visible to both.

"use strict";

let bot = null;
let botRunning = true;
let spawnCount = 0;
let chatMessageSent = false;
let lastSpawnAt = 0;

const SETTLE_MS = 15000;

// Reason the last login attempt was refused before spawn, so the reconnect
// backoff can distinguish "server is down" from "server rejected us".
let lastLoginError = null;

// Live connection state, read by the HTTP layer and the dashboard.
let botState = {
  connected: false,
  lastActivity: Date.now(),
  reconnectAttempts: 0,
  startTime: Date.now(),
  errors: [],
  wasThrottled: false,
};

// Timers owned by modules. Tracked centrally so a reconnect can tear them all
// down together instead of leaking intervals from a dead bot.
let activeIntervals = [];

function registerInterval(id) {
  activeIntervals.push(id);
  return id;
}

function addInterval(callback, delay) {
  return registerInterval(setInterval(callback, delay));
}

function clearAllIntervals() {
  activeIntervals.forEach((id) => clearInterval(id));
  activeIntervals = [];
}

module.exports = {
  SETTLE_MS,
  registerInterval,
  addInterval,
  clearAllIntervals,
  get bot() {
    return bot;
  },
  set bot(v) {
    bot = v;
  },
  get botRunning() {
    return botRunning;
  },
  set botRunning(v) {
    botRunning = v;
  },
  get spawnCount() {
    return spawnCount;
  },
  incSpawnCount() {
    spawnCount += 1;
    return spawnCount;
  },
  get chatMessageSent() {
    return chatMessageSent;
  },
  markChatSent() {
    chatMessageSent = true;
  },
  get lastSpawnAt() {
    return lastSpawnAt;
  },
  touchSpawn() {
    lastSpawnAt = Date.now();
    return lastSpawnAt;
  },
  get lastLoginError() {
    return lastLoginError;
  },
  set lastLoginError(v) {
    lastLoginError = v;
  },
  botState,
};