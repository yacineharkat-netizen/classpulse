// Shared helpers for all ClassPulse pages.
(window.CP_FILES = window.CP_FILES || {})["common.js"] = "32.1"; // file version, checked by common.js

const db = supabase.createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true },
});

// Error codes raised by the database functions -> message shown to the user.
const ERROR_MESSAGES = {
  CONFIRM_TITLE: "Type the exact name to confirm the deletion.",
  SAME_QUESTION_TWICE: "The same question is twice in the quiz.",
  SESSION_ENDED: "This session is ended: reopen it first.",
  NOT_YOURS: "Only the person who created it can change it.",
  UNKNOWN_GROUP: "No student of this class is in this group.",
  BAD_KEY: "A locked part has a wrong name (letters, digits, - and _ only).",
  BAD_POINTS: "Points: at least 0.25.",
  SESSION_NOT_FOUND: "Unknown session code. Check the code on the screen.",
  UNKNOWN_DEVICE: "This phone is not registered for this class.",
  ALREADY_REGISTERED: "This student number is already linked to another device. Use \"Sign in\": you can then ask the teacher to allow this device.",
  ASK_TEACHER_RESET: "This student number is linked to another device. Ask the teacher to allow a new device.",
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
  EMPTY_MESSAGE: "Write a message first.",
  MESSAGE_TOO_LONG: "This message is too long.",
  NO_RECIPIENT: "Nobody to send this message to.",
  TOO_MANY_MESSAGES: "Too many messages today. Try again tomorrow, or see the teacher.",
  BAD_TARGET: "Choose who receives the message.",
  ALREADY_SUBMITTED: "You have already submitted this test: your answers can no longer change.",
  BAD_MARK: "The mark must be between 0 and the maximum of the quiz.",
  BAD_LEVEL: "Unknown access level.",
  LOCKED: "You are locked. Ask the teacher.",
  EMPTY_ANSWER: "Choose at least one answer.",
  NOT_LOGGED_IN: "Please log in again.",
  CLASS_NOT_FOUND: "Class not found.",
  QUIZ_NOT_FOUND: "Quiz not found.",
  QUIZ_FINISHED: "This quiz is finished. To run it again: Reset it (answers erased) or Duplicate it (new quiz).",
  TITLE_REQUIRED: "Type a title.",
  FILE_TOO_BIG: "This file is bigger than 5 MB: put it on Google Drive or GitHub and share the link in the thread.",
  PROJECT_FULL: "The files of this project reach 100 MB: delete old versions, or share big files as links.",
  MATRICULE_ALREADY_IN_CLASS: "This student number is already in the list.",
  MEMBER_NAME_REQUIRED: "This student is in none of your classes: type his last and first name.",
  BAD_STATUS: "Unknown status.",
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
  PIN_LOCKED: "Too many wrong PINs. Try again in 5 minutes, or ask the teacher to unlock you now.",
  QUIZ_NOT_FINISHED: "This quiz is not finished: its results do not exist yet.",
  ANOTHER_QUIZ_RUNNING: "Another quiz is running in this session: finish it before showing these results.",
  TEACHER_ONLY: "Only the teacher of the class can do this (lab assistants cannot).",
  ASSISTANT_TP_ONLY: "Your assistant role does not cover this type of session or quiz.",
  NO_SUCH_ACCOUNT: "No ClassPulse account with this e-mail. Create it first in Supabase (Authentication > Users > Add user).",
  BAD_QUESTIONS: "Select at least one question.",
  NAME_DOES_NOT_MATCH: "The name typed is not the name of the class: nothing was deleted.",
  NOT_ALLOWED: "Your assistant role does not include this. Ask the teacher of the class.",
  ACCOUNT_NOT_ALLOWED: "This account has no class yet. An assistant types his invitation code (login page, or Classes tab).",
  NOT_A_TEACHER: "Only a teacher account creates classes. Assistants join a class with an invitation code.",
  BAD_INVITE: "This invitation code is not valid (wrong, already used, or expired). Ask the teacher for a new one.",
  BAD_ROLE: "Unknown role.",
  BAD_PERMISSION: "Unknown permission.",
  NO_MAKEUP: "No make-up for you in this quiz.",
  MAKEUP_EXPIRED: "The time for this make-up is over. See the teacher.",
  CLASS_DEVICE_ONLY: "A make-up is taken on your class device (the phone or computer you use in class).",
  BAD_DATE: "Choose a date and time in the future.",
  NETWORK: "Network problem. Check your connection.",
  NOT_YOUR_SESSION: "A lab assistant can only edit or delete the sessions he created himself.",
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
// v28.1: every call is timed (window.CP_NET), so that a slow network can be told from a slow server.
const CP_NET = window.CP_NET = { calls: [], inFlight: 0, maxInFlight: 0 };
async function rpc(fn, args) {
  const t0 = performance.now();
  CP_NET.inFlight++; CP_NET.maxInFlight = Math.max(CP_NET.maxInFlight, CP_NET.inFlight);
  let result;
  // v28.2: a call never hangs: after 12 s without an answer it is given up (the next poll tries again).
  // Without this, one request lost on a bad network froze the phone on the same screen.
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  // v31: a big upload (a PDF, a file of a project) or a download of a file gets 2 minutes, not 12 s
  const big = (args && Object.values(args).some((v) => typeof v === "string" && v.length > 100000)) || RPC_BIG.test(fn);
  const timer = ctl ? setTimeout(() => ctl.abort(), big ? 120000 : RPC_TIMEOUT_MS) : null;
  try {
    const call = db.rpc(fn, args || {});
    result = await (ctl && call.abortSignal ? call.abortSignal(ctl.signal) : call);
  } catch (err) {
    result = { data: null, error: { message: "Network problem: " + (err && err.message || err) } };
  }
  finally {
    clearTimeout(timer);
    CP_NET.inFlight--;
    CP_NET.calls.push({ fn, ms: Math.round(performance.now() - t0), at: Date.now() });
    if (CP_NET.calls.length > 300) CP_NET.calls.splice(0, 100);
  }
  const { data, error } = result;
  if (error) {
    const e = new Error(errorText(error));
    e.code = (error.message || "").split(":")[0].trim();
    // v28.2: no answer from the server (network down, timeout): the caller may try again
    e.network = !error.code && /fetch|network|abort|timeout|load failed/i.test(error.message || "");
    if (e.network) { CP_NET.lastFail = Date.now(); e.code = "NETWORK"; } else CP_NET.lastOk = Date.now();
    throw e;
  }
  CP_NET.lastOk = Date.now();
  return data;
}
const RPC_TIMEOUT_MS = 12000;
const RPC_BIG = /file_get|^s_doc$|document_content|demo_file/;   // calls that may bring back a big file
// Summary of the last calls: median and slowest time, per function.
function netSummary(lastMs) {
  const since = Date.now() - (lastMs || 120000);
  const list = CP_NET.calls.filter((c) => c.at >= since);
  const med = (a) => { if (!a.length) return 0; const b = a.slice().sort((x, y) => x - y); return b[Math.floor(b.length / 2)]; };
  const per = {};
  list.forEach((c) => (per[c.fn] = per[c.fn] || []).push(c.ms));
  return { count: list.length, median: med(list.map((c) => c.ms)), max: list.reduce((m, c) => Math.max(m, c.ms), 0),
    inFlight: CP_NET.inFlight, maxInFlight: CP_NET.maxInFlight,
    perFunction: Object.entries(per).map(([fn, a]) => ({ fn, n: a.length, median: med(a), max: Math.max(...a) })).sort((a, b) => b.median * b.n - a.median * a.n) };
}

// v28.1: a repeated refresh that never piles up. The next call starts only when the previous one is over;
// it waits longer when the network is slow (at least twice the last duration), and pauses while the page is hidden
// or while when() says no. run() refreshes now: if a call is already running, one more call follows it (never two
// at the same time) and run() resolves when that fresh call is over.
function poller(fn, everyMs, when) {
  const p = { busy: false, timer: null, stopped: false, next: null };
  const schedule = (lastMs) => {
    clearTimeout(p.timer);
    if (!p.stopped) p.timer = setTimeout(tick, Math.max(everyMs, 2 * (lastMs || 0)));
  };
  async function tick() {
    if (document.visibilityState === "hidden" || (when && !when())) { schedule(0); return; }
    await p.run();
  }
  async function exec() {
    p.busy = true;
    clearTimeout(p.timer);
    const t0 = performance.now();
    try { await fn(); } catch (e) { /* the next round tries again */ }
    p.busy = false;
    if (p.next) { const n = p.next; p.next = null; await exec(); n.resolve(); return; }
    schedule(performance.now() - t0);
  }
  p.run = () => {
    if (!p.busy) return exec();
    if (!p.next) { let resolve; const promise = new Promise((r) => (resolve = r)); p.next = { promise, resolve }; }
    return p.next.promise;
  };
  p.stop = () => { p.stopped = true; clearTimeout(p.timer); };
  p.start = () => { p.stopped = false; schedule(0); return p; };
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !p.stopped && !p.busy && (!when || when())) p.run();
  });
  return p.start();
}

function $(id) { return document.getElementById(id); }

// ------------------------------------------------------------------ student account (version 21)
// A phone is "linked" to the student (attendance, quizzes). Any other device only reads the documents.
function isPhone() {
  return /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 0 && Math.min(screen.width, screen.height) < 820);
}
function deviceKind() { return isPhone() ? "phone" : "computer"; }
// Keeps the tokens returned by s_account_register / s_account_login: one per course.
// "cp_device_<class>" = the class device (attendance, quizzes); "cp_reader_<class>" = documents only;
// "cp_keep_<class>" = the class-device key kept after "Sign out", so that the same browser is recognised again (v24).
function storeAccount(account) {
  account.classes.forEach((c) => {
    try {
      if (c.kind === "device") { localStorage.setItem("cp_device_" + c.class_id, c.token); localStorage.removeItem("cp_reader_" + c.class_id); localStorage.removeItem("cp_keep_" + c.class_id); }
      else {
        const kept = localStorage.getItem("cp_keep_" + c.class_id);
        if (kept && !localStorage.getItem("cp_device_" + c.class_id)) { localStorage.setItem("cp_device_" + c.class_id, kept); localStorage.removeItem("cp_keep_" + c.class_id); }
        localStorage.setItem("cp_reader_" + c.class_id, c.token);
      }
    } catch (e) { /* private mode */ }
  });
}
// A reader token that the server now knows as the class device (first session, or request accepted).
function promoteToken(classId) {
  try {
    const r = localStorage.getItem("cp_reader_" + classId);
    // never over an existing class-device key: that one is the key the server knows
    if (r && !localStorage.getItem("cp_device_" + classId)) { localStorage.setItem("cp_device_" + classId, r); localStorage.removeItem("cp_reader_" + classId); }
  } catch (e) { /* private mode */ }
}
async function accountCall(fn, args) {
  const r = await rpc(fn, Object.assign({ p_bind: isPhone() }, args));
  if (r.error) { const e = new Error(errorText({ message: r.error })); e.code = r.error; throw e; }
  storeAccount(r);
  return r;
}
// bind = true forces the link of this device (sign-in started from a session: it is the class phone).
function accountLogin(matricule, pin, bind) {
  const args = { p_matricule: matricule, p_pin: pin };
  if (bind) args.p_bind = true;
  return accountCall("s_account_login", args);
}
// Text shown under the application name on the student pages (config.js may override it with homeLine).
const HOME_LINE = (typeof CONFIG !== "undefined" && CONFIG.homeLine) || "Dr Yacine Harkat · Telecommunications Department · FGE · USTHB";
function accountRegister(matricule, lastName, firstName, pin, email) {
  return accountCall("s_account_register", { p_matricule: matricule, p_last_name: lastName, p_first_name: firstName, p_pin: pin, p_email: email });
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
    keys.forEach((k) => {
      // the class-device key is kept aside: signing in again on this browser gives the class device back
      if (k.indexOf("cp_device_") === 0) localStorage.setItem("cp_keep_" + k.slice(10), localStorage.getItem(k));
      localStorage.removeItem(k);
    });
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


// v27: a text of the teacher's page exists in three languages: English first, then French, then Arabic.
function triText(v) { return v == null ? "" : typeof v === "string" ? v : (v.en || v.fr || v.ar || ""); }
// v27: the personal page of the teacher, next to ClassPulse (…/classpulse/ -> …/), or CONFIG.personalPage.
function personalPageUrl(extra) {
  const base = (typeof CONFIG !== "undefined" && CONFIG.personalPage) || new URL("../", location.href).href;
  return base + (extra || "");
}

// ------------------------------------------------------------------ v31: shared by the supervision pages (teacher and team)
const PROJECT_TYPE = { pfe: "Final-year project", master: "Master thesis", licence: "Licence project", mini: "Mini-project", phd: "PhD", other: "Project" };
const PROJECT_STATUS = { in_progress: "in progress", submitted: "report submitted", defended: "defended", stopped: "stopped" };
function whenText(t) { return t ? new Date(t).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : ""; }
function dayText(d) { return d ? new Date(String(d).slice(0, 10) + "T12:00:00").toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short", year: "numeric" }) : ""; }
function agoText(t) {
  if (!t) return "never";
  const d = Math.floor((Date.now() - new Date(t).getTime()) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "yesterday" : d + " days ago";
}
function sizeText(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB"; }
// A file chosen by the user, as base64 (without the "data:...;base64," prefix).
function fileToBase64(file) {
  return new Promise((ok, ko) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = () => ko(r.error); r.readAsDataURL(file); });
}
// Save a file received as base64.
function saveBase64(name, mime, b64) {
  const bin = atob(b64), bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime || "application/octet-stream" }));
  const a = document.createElement("a"); a.href = url; a.download = name || "file"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
// The last commits of a public GitHub repository (60 calls per hour without a key: kept 10 minutes in this browser).
async function githubCommits(repoUrl) {
  const m = String(repoUrl || "").match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i);
  if (!m) return { error: "Not a GitHub repository address (https://github.com/owner/name)." };
  const repo = m[1] + "/" + m[2].replace(/\.git$/i, ""), key = "cp_gh_" + repo;
  try { const c = JSON.parse(sessionStorage.getItem(key) || "null"); if (c && Date.now() - c.at < 600000) return c.v; } catch (e) { /* no cache */ }
  let v;
  try {
    const r = await fetch("https://api.github.com/repos/" + repo + "/commits?per_page=5", { headers: { Accept: "application/vnd.github+json" } });
    if (r.status === 404) v = { repo, error: "Repository not found or private: only the commits of a public repository can be shown." };
    else if (r.status === 403 || r.status === 429) v = { repo, error: "GitHub limits the number of reads: try again in a while." };
    else if (!r.ok) v = { repo, error: "GitHub answered " + r.status + "." };
    else v = { repo, commits: (await r.json()).map((c) => ({ msg: (c.commit.message || "").split("\n")[0], who: (c.commit.author || {}).name || "", at: (c.commit.author || {}).date, url: c.html_url })) };
  } catch (e) { return { repo, error: "GitHub could not be reached." }; }
  try { sessionStorage.setItem(key, JSON.stringify({ at: Date.now(), v })); } catch (e) { /* ignore */ }
  return v;
}
function githubHtml(g) {
  if (!g) return "";
  if (g.error) return `<span class="muted">${esc(g.error)}</span>`;
  if (!g.commits.length) return `<span class="muted">No commit yet.</span>`;
  return `<ul class="gh-list">` + g.commits.map((c) => `<li><a href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.msg)}</a> <span class="muted">· ${esc(c.who)} · ${esc(whenText(c.at))}</span></li>`).join("") + `</ul>`;
}
// The thread of a project (the same for the supervisors and for the team).
function projectPostsHtml(posts, fileAttr) {
  if (!posts.length) return `<p class="muted">No message yet. Say hello to the team!</p>`;
  return posts.map((p) => `<div class="post ${p.staff ? "staff" : ""}"><div class="msg-head"><strong>${esc(p.who || "")}</strong><span class="muted">${esc(whenText(p.at))}</span></div>
    <div class="msg-body">${esc(p.body).replace(/\n/g, "<br>")}</div>
    ${p.file_id && p.file_name ? `<div style="margin-top:4px"><a href="#" ${fileAttr}="${p.file_id}">📎 ${esc(p.file_name)}</a></div>` : ""}</div>`).join("");
}
