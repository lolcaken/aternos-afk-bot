// Post-spawn behaviour: the optional one-shot chat message.
//
// Movement, combat, beds and pathfinder modules are intentionally absent.
// The client holds one fixed position, so there is no physics to simulate and
// nothing to gain from walking. See src/client/index.js.

"use strict";

const config = require("../../settings.json");
const { addLog } = require("../logger");
const state = require("./state");

// Waits for the fifth reconnect, so the message lands on a session that has
// actually held instead of one that is kicked a second after joining.
const CHAT_AFTER_SPAWNS = 5;

function initializeModules(bot) {
  const spawnCount = state.incSpawnCount();
  state.touchSpawn();
  addLog("[Modules] Initializing all modules...");

  const cm = config.utils["chat-messages"];
  if (cm && cm.enabled && !state.chatMessageSent && spawnCount > CHAT_AFTER_SPAWNS) {
    state.markChatSent();
    const messages = cm.messages;
    addLog(
      `[Chat] Queueing one-shot message (spawn #${spawnCount}): ${messages.join(", ")}`,
    );

    if (cm.repeat) {
      let i = 0;
      const id = setInterval(() => {
        if (!state.bot || !state.botState.connected) return;
        state.bot.chat(messages[i]);
        state.botState.lastActivity = Date.now();
        i = (i + 1) % messages.length;
      }, cm["repeat-delay"] * 1000);
      state.registerInterval(id);
    } else {
      messages.forEach((msg, idx) => {
        setTimeout(() => {
          if (!state.bot || !state.botState.connected) {
            addLog("[Chat] Skipped - bot not connected");
            return;
          }
          try {
            state.bot.chat(msg);
            addLog(`[Chat] Sent one-shot message: ${msg}`);
          } catch (e) {
            addLog(`[Chat] Failed to send: ${e.message}`);
          }
        }, idx * 1000);
      });
    }
  }

  addLog("[Modules] All modules initialized!");
}

module.exports = { initializeModules, CHAT_AFTER_SPAWNS };