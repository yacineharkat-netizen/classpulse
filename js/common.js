// Shared helpers for all ClassPulse pages.
(window.CP_FILES = window.CP_FILES || {})["common.js"] = "7"; // file version, checked by common.js

const db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Error codes raised by the database functions -> message shown to the user.
const ERROR_MESSAGES = {
  SESSION_NOT_FOUND: "Unknown session code. Check the code on the screen.",
  UNKNOWN_DEVICE: "This phone is not registered for this class.",
  ALREADY_REGISTERED: "This student number is already registered on another phone. Ask the teacher.",
  ASK_TEACHER_RESET: "This student number is linked to another phone. Ask the teacher to allow a new phone.",
  WRONG_PIN: "Wrong PIN.",
  BAD_PIN: "The PIN must be exactly 4 digits.",
  BAD_MATRICULE: "Invalid student number.",
  NAME_REQUIRED: "Your name is not in the official list yet: please type your first and last name.",
  UNKNOWN_STUDENT: "Unknown student number.",
  NOT_PRESENT: "You are not checked in for this session.",
  QUESTION_CLOSED: "This question is closed.",
  TIME_OVER: "Time is over for this question.",
  LOCKED: "You are locked. Ask the teacher.",
  EMPTY_ANSWER: "Choose at least one answer.",
  NOT_LOGGED_IN: "Please log in again.",
  CLASS_NOT_FOUND: "Class not found.",
  QUIZ_NOT_FOUND: "Quiz not found.",
  BAD_QUESTIONS: "Select at least one question.",
};

function errorText(err) {
  if (!err) return "";
  const msg = err.message || String(err);
  const code = msg.split(":")[0].trim();
  if (ERROR_MESSAGES[code]) return ERROR_MESSAGES[code];
  if (code === "BAD_QUESTION") return "Invalid question in the file: " + msg;
  if (/fetch|network/i.test(msg)) return "Network problem. Check your connection.";
  return msg;
}

// Call a database function. Returns the data, or throws an Error with a readable message.
async function rpc(fn, args) {
  const { data, error } = await db.rpc(fn, args || {});
  if (error) {
    const e = new Error(errorText(error));
    e.code = (error.message || "").split(":")[0].trim();
    throw e;
  }
  return data;
}

function $(id) { return document.getElementById(id); }

function esc(text) {
  return String(text == null ? "" : text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(message, kind) {
  let box = $("toast");
  if (!box) {
    box = document.createElement("div");
    box.id = "toast";
    document.body.appendChild(box);
  }
  box.textContent = message;
  box.className = "show " + (kind || "");
  clearTimeout(box._t);
  box._t = setTimeout(() => { box.className = ""; }, 4000);
}

const LETTERS = "ABCDEFGH";

// Base URL of the site (works on GitHub Pages sub-folders and locally).
function siteUrl(page) {
  return new URL(page, window.location.href).href;
}

// Live channel: the teacher page sends a "ping" after each change; phones and the
// projector re-read the state when they receive it. If the channel is unavailable,
// pages simply poll more often.
function liveChannel(sessionCode, onPing) {
  const state = { connected: false };
  try {
    const ch = db.channel("live-" + sessionCode, { config: { broadcast: { self: false } } });
    ch.on("broadcast", { event: "ping" }, () => onPing());
    ch.subscribe((status) => { state.connected = status === "SUBSCRIBED"; });
    state.channel = ch;
  } catch (e) {
    state.connected = false;
  }
  state.ping = () => {
    if (state.channel && state.connected) state.channel.send({ type: "broadcast", event: "ping", payload: { t: Date.now() } });
  };
  return state;
}

function formatSeconds(ms) {
  return Math.max(0, Math.ceil(ms / 1000));
}

