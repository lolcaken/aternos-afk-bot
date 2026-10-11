// HTML escaping and log-line colour classification.
// Shared by src/http/views.js.

"use strict";

const ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, (m) => ESCAPES[m]);
}

// Picks the CSS class for a log line based on its content.
function classifyLog(line) {
  const lower = String(line).toLowerCase();
  if (lower.includes("error") || lower.includes("fail")) return "error";
  if (lower.includes("warn")) return "warn";
  if (lower.includes("[control]")) return "control";
  if (
    lower.includes("connect") ||
    lower.includes("join") ||
    lower.includes("spawn")
  ) {
    return "success";
  }
  return "default";
}

module.exports = { escapeHTML, classifyLog };