// Shared helpers for all ClassPulse pages.
(window.CP_FILES = window.CP_FILES || {})["common.js"] = "21"; // file version, checked by common.js

const db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Error codes raised by the database functions -> message shown to the user.
const ERROR_MESSAGES = {
  SESSION_NOT_FOUND: "Unknown session code. Check the code on the screen.",
  UNKNOWN_DEVICE: "This phone is not registered for this class.",
  ALREADY_REGISTERED: "This student number is already linked to another phone. Ask the teacher to allow this phone, then use \"Sign in\".",
  ASK_TEACHER_RESET: "This student number is linked to another phone. Ask the teacher to allow a new phone.",
  WRONG_PIN: "Wrong PIN. If you never chose a PIN for this student number, tell the teacher: he can reset it.",
  ALREADY_HAS_PIN: "This student number is already registered: use \"Sign in\" with your PIN. If you did not register it yourself, tell the teacher: he will reset it.",
  BAD_MATRICULE: "Check your student number.",
  NOT_REGISTERED_YET: "This student number is not registered yet: use \"Register\" first.",
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
  QUIZ_FINISHED: "This quiz is finished. To run it again: Reset it (answers erased) or Duplicate it (new quiz).",
  TITLE_REQUIRED: "Type a title.",
  QUIZ_CLOSED: "This test is not open (not started yet, or already finished).",
  VARIANT_REQUIRED: "Type the number of your board first (top of the page).",
  VARIANT_LOCKED: "The board number cannot change once you have saved answers. Ask the teacher.",
  BAD_VARIANT: "Type the number written on your board (1 to 99).",
  NUMBER_NEEDS_SELF_PACE: "Numeric questions only work in a self-paced quiz (choose 'Self-paced' when you create it).",
  EDIT_BY_IMPORT: "Numeric questions are edited in the Excel file, then imported again.",
  DOC_NOT_AVAILABLE: "This document is not available for your class.",
  PDF_NOT_ALLOWED: "The teacher did not allow the PDF download of this document.",
  EMPTY_DOCUMENT: "Choose at least one file: the page (HTML), the PDF or an attached file.",
  REGISTRATION_CLOSED: "The registration of new phones is closed for this class. Ask the teacher.",
  NOT_IN_OFFICIAL_LIST: "You are not in the official list (check your student number and your last name). The teacher has been told: see him if the list must be corrected.",
  UNKNOWN_CLASS: "This registration link is not valid.",
  PIN_LOCKED: "Too many wrong PINs. Try again in 15 minutes.",
  QUIZ_NOT_FINISHED: "This quiz is not finished: its results do not exist yet.",
  ANOTHER_QUIZ_RUNNING: "Another quiz is running in this session: finish it before showing these results.",
  TEACHER_ONLY: "Only the teacher of the class can do this (lab assistants cannot).",
  ASSISTANT_TP_ONLY: "A lab assistant can only work on lab (TP) sessions and lab tests.",
  NO_SUCH_ACCOUNT: "No ClassPulse account with this e-mail. Create it first in Supabase (Authentication > Users > Add user).",
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

// ------------------------------------------------------------------ student account (version 21)
// A phone is "linked" to the student (attendance, quizzes). Any other device only reads the documents.
function isPhone() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 820);
}
// Keeps the tokens returned by s_account_register / s_account_login: one per course.
function storeAccount(account) {
  account.classes.forEach((c) => {
    try {
      if (c.kind === "device") { localStorage.setItem("cp_device_" + c.class_id, c.token); localStorage.removeItem("cp_reader_" + c.class_id); }
      else if (!localStorage.getItem("cp_device_" + c.class_id)) localStorage.setItem("cp_reader_" + c.class_id, c.token);
    } catch (e) { /* private mode */ }
  });
}
async function accountCall(fn, args) {
  const r = await rpc(fn, Object.assign({ p_bind: isPhone() }, args));
  if (r.error) { const e = new Error(errorText({ message: r.error })); e.code = r.error; throw e; }
  storeAccount(r);
  return r;
}
function accountLogin(matricule, pin) { return accountCall("s_account_login", { p_matricule: matricule, p_pin: pin }); }
function accountRegister(matricule, lastName, firstName, pin) {
  return accountCall("s_account_register", { p_matricule: matricule, p_last_name: lastName, p_first_name: firstName, p_pin: pin });
}
// Tokens kept by this browser: [{ classId, token, phone }]
function accountTokens() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k) continue;
      if (k.indexOf("cp_device_") === 0) out.push({ classId: k.slice(10), token: localStorage.getItem(k), phone: true });
      else if (k.indexOf("cp_reader_") === 0 && !localStorage.getItem("cp_device_" + k.slice(10))) out.push({ classId: k.slice(10), token: localStorage.getItem(k), phone: false });
    }
  } catch (e) { /* private mode */ }
  return out;
}
function accountSignOut() {
  try {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && (k.indexOf("cp_device_") === 0 || k.indexOf("cp_reader_") === 0 || k === "cp_last_session")) keys.push(k); }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch (e) { /* private mode */ }
}

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

