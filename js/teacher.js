// ClassPulse - teacher console.
(window.CP_FILES = window.CP_FILES || {})["teacher.js"] = "21"; // file version, checked by common.js

let classId = null;
let sessionId = null;
let sessionCode = null;
let live = null;              // last t_live result
let channel = null;
let pollTimer = null;
let attendanceTimer = null;
let autoTimer = null;
let allQuestions = [];
let activeTab = "live";
let checkLocation = false;    // this session asks the phone position at check-in
let classNames = {};          // class id -> "name year"
let classRoles = {};          // class id -> "teacher" | "assistant"
let classInfo = {};           // class id -> row of t_list_classes (registration settings...)
function isAssistant() { return classId && classRoles[classId] === "assistant"; }

// Each class gets its own colour, always the same, so that the current class is obvious on every tab.
const CLASS_COLORS = ["#1B7F8C", "#E8741E", "#6A4C93", "#2E7D4F", "#B83227", "#1F5FA8", "#8A6D0B", "#C2185B"];
function classColor(id) {
  let h = 0;
  for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return CLASS_COLORS[h % CLASS_COLORS.length];
}

function updateBanner() {
  const color = classId ? classColor(classId) : "#5A6B7D";
  document.documentElement.style.setProperty("--class-color", color);
  document.documentElement.style.setProperty("--class-bg", color + "1A");
  $("bannerName").textContent = classId ? classNames[classId] : "no class yet - create one in the Classes tab";
  const notes = {
    questions: "The question bank is shared by all your classes (sorted by module).",
    resources: "Resources are shared by all your classes.",
    classes: "",
  };
  $("bannerNote").textContent = notes[activeTab] || "";
}

// ------------------------------------------------------------------ login
async function init() {
  $("autoDelay").textContent = CONFIG.autoNextDelayS;
  $("dropLowest").textContent = CONFIG.dropLowest;
  $("newSessionDate").value = new Date().toISOString().slice(0, 10);
  $("newSessionTime").value = new Date().toTimeString().slice(0, 5);
  $("signedHours").textContent = CONFIG.signedLinkHours;
  $("maxMb").textContent = CONFIG.maxFileMb;
  const { data } = await db.auth.getSession();
  if (data.session) await showApp(); else $("loginView").classList.remove("hidden");
}

$("loginBtn").onclick = async () => {
  const { error } = await db.auth.signInWithPassword({ email: $("email").value.trim(), password: $("password").value });
  if (error) { toast("Login failed: " + error.message, "error"); return; }
  $("loginView").classList.add("hidden");
  await showApp();
};

$("logoutBtn").onclick = async () => { await db.auth.signOut(); location.reload(); };

async function showApp() {
  $("appView").classList.remove("hidden");
  const { data } = await db.auth.getUser();
  $("whoAmI").textContent = data && data.user ? data.user.email : "";
  await loadClasses();
  loadAttempts(); setInterval(loadAttempts, 60000);
  await loadResources();
  await loadDemos();
}

// ------------------------------------------------------------------ navigation
document.querySelectorAll("nav button[data-tab]").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("nav button[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll("main section").forEach((s) => s.classList.toggle("hidden", s.id !== "tab-" + b.dataset.tab));
    activeTab = b.dataset.tab;
    updateBanner();
    const loaders = { students: loadStudents, questions: loadQuestions, classes: () => loadClasses().then(loadAssistants), resources: loadResources,
      sessions: loadSessions, demos: loadDemos, space: () => loadDocs().then(loadDocStats) };
    if (loaders[b.dataset.tab]) loaders[b.dataset.tab]();
  };
});

// ------------------------------------------------------------------ classes
async function loadClasses() {
  const classes = await rpc("t_list_classes");
  classNames = {};
  classes.forEach((c) => { classNames[c.id] = `${c.name} ${c.year}`; classRoles[c.id] = c.role || "teacher"; classInfo[c.id] = c; });
  const keep = classId || localStorage.getItem("cp_class");
  $("classSelect").innerHTML = classes.map((c) => `<option value="${c.id}">${esc(c.name)} ${esc(c.year)}</option>`).join("") ||
    `<option value="">- create a class first -</option>`;
  if (keep && classes.some((c) => c.id === keep)) $("classSelect").value = keep;
  $("classesTable").innerHTML = `<table><tr><th>Class</th><th>Year</th><th>Students</th><th>Sessions</th></tr>` +
    classes.map((c) => `<tr><td>${esc(c.name)}${c.role === "assistant" ? ' <span class="badge info">assistant</span>' : ""}</td><td>${esc(c.year)}</td><td>${c.students}</td><td>${c.sessions}</td></tr>`).join("") + `</table>`;
  await selectClass($("classSelect").value || null);
}

$("classSelect").onchange = () => selectClass($("classSelect").value);

// Lab assistant: hide what he cannot do, force the lab (TP) type.
function applyRole() {
  const a = !!isAssistant();
  document.body.classList.toggle("assistant", a);
  if (a) {
    $("newSessionKind").value = "tp"; $("quizKind").value = "tp";
    const active = document.querySelector("nav button[data-tab].active");
    if (active && active.classList.contains("teacher-only")) document.querySelector("nav button[data-tab=live]").click();
  }
  $("newSessionKind").disabled = a;
  $("quizKind").disabled = a;
}

async function selectClass(id) {
  const changed = id !== classId, previous = classId;
  classId = id;
  if (id) localStorage.setItem("cp_class", id);
  applyRole();
  updateBanner();
  // Forget the session only when the teacher switches to another class (not on a page reload, where classId starts empty).
  if (changed && previous) { sessionId = null; localStorage.removeItem("cp_session"); }
  await loadSessions();
  // refresh the tab currently shown, so that it always matches the selected class
  if (changed && activeTab === "students") await loadStudents();
  if (changed && activeTab === "space") { $("statsDetail").dataset.doc = ""; $("statsDetail").innerHTML = ""; await loadDocs(); await loadDocStats(); }
  if (activeTab === "classes" && !isAssistant()) loadAssistants();
}

$("createClassBtn").onclick = async () => {
  try {
    classId = await rpc("t_create_class", { p_name: $("className").value, p_year: $("classYear").value });
    toast("Class created.", "ok");
    await loadClasses();
  } catch (e) { toast(e.message, "error"); }
};

// ------------------------------------------------------------------ sessions
const SESSION_KIND = { course: "Course", td: "TD", tp: "TP" };
let allSessions = [];

async function loadSessions() {
  if (!classId) { $("sessionSelect").innerHTML = ""; $("sessionsTable").innerHTML = ""; return; }
  allSessions = await rpc("t_list_sessions", { p_class: classId });
  const keep = sessionId || localStorage.getItem("cp_session");
  $("sessionSelect").innerHTML = `<option value="">- choose a session -</option>` +
    allSessions.map((s) => `<option value="${s.id}" data-code="${s.code}">${esc(s.date)} ${timeRange(s)} · ${SESSION_KIND[s.kind] || ""} · ${esc(s.title)} · code ${s.code} · ${s.present} present</option>`).join("");
  if (keep && allSessions.some((s) => s.id === keep)) $("sessionSelect").value = keep;
  renderSessionsTable();
  await selectSession($("sessionSelect").value || null);
}

// "09:40-11:10", or only the start time when no end time is set.
function timeRange(s) { return (s.time || "") + (s.end_time ? "-" + s.end_time : ""); }

function renderSessionsTable() {
  $("sessionsTable").innerHTML = allSessions.length === 0 ? `<p class="muted">No session yet. Create one in the Live session tab.</p>` :
    `<table><tr><th>Date</th><th>Time</th><th>Type</th><th>Title</th><th>Code</th><th>Present</th><th>Quizzes</th><th></th></tr>` +
    allSessions.map((s) => `<tr data-id="${s.id}"><td class="c-date">${esc(s.date)}</td><td class="c-time">${timeRange(s)}${s.ended_at ? ' <span class="badge closed">ended</span>' : ""}</td>
      <td class="c-kind"><span class="kind ${s.kind}">${SESSION_KIND[s.kind] || s.kind}</span></td><td class="c-title">${esc(s.title)}</td>
      <td>${s.code}</td><td>${s.present}</td><td>${s.quizzes}</td>
      <td style="white-space:nowrap"><button class="small green" data-open="${s.id}">Open</button>
        <button class="small secondary" data-sedit="${s.id}">Edit</button> <button class="small red teacher-only" data-sdel="${s.id}">Delete</button></td></tr>`).join("") + `</table>`;
  $("sessionsTable").querySelectorAll("[data-open]").forEach((b) => b.onclick = async () => {
    $("sessionSelect").value = b.dataset.open;
    await selectSession(b.dataset.open);
    document.querySelector("nav button[data-tab=live]").click();
  });
  $("sessionsTable").querySelectorAll("[data-sdel]").forEach((b) => b.onclick = async () => {
    const s = allSessions.find((x) => x.id === b.dataset.sdel);
    if (!confirm(`Delete the session "${s.title}" of ${s.date}?\nIts attendance (${s.present} present) and its ${s.quizzes} quiz(zes) with all answers are deleted too.`)) return;
    try {
      await rpc("t_delete_session", { p_session: s.id });
      if (sessionId === s.id) { sessionId = null; localStorage.removeItem("cp_session"); }
      toast("Session deleted.", "ok"); loadSessions();
    } catch (e) { toast(e.message, "error"); }
  });
  $("sessionsTable").querySelectorAll("[data-sedit]").forEach((b) => b.onclick = () => {
    const tr = b.closest("tr"), s = allSessions.find((x) => x.id === b.dataset.sedit);
    tr.querySelector(".c-date").innerHTML = `<input type="date" class="e-date" value="${s.date}" style="width:150px">`;
    tr.querySelector(".c-time").innerHTML = `<input type="time" class="e-time" value="${s.time || ""}" style="width:110px" title="Start">
      <input type="time" class="e-end" value="${s.end_time || ""}" style="width:110px" title="End">`;
    tr.querySelector(".c-kind").innerHTML = `<select class="e-kind" style="width:auto" ${isAssistant() ? "disabled" : ""}>${Object.entries(SESSION_KIND).map(([k, v]) => `<option value="${k}" ${k === s.kind ? "selected" : ""}>${v}</option>`).join("")}</select>`;
    tr.querySelector(".c-title").innerHTML = `<input class="e-title" value="${esc(s.title)}">`;
    b.textContent = "Save"; b.className = "small green";
    b.onclick = async () => {
      try {
        await rpc("t_update_session", { p_session: s.id, p_title: tr.querySelector(".e-title").value, p_date: tr.querySelector(".e-date").value,
          p_time: tr.querySelector(".e-time").value || null, p_kind: tr.querySelector(".e-kind").value });
        await rpc("t_set_session_end_time", { p_session: s.id, p_end_time: tr.querySelector(".e-end").value || null });
        toast("Session updated.", "ok"); loadSessions();
      } catch (e) { toast(e.message, "error"); }
    };
  });
}

$("sessionSelect").onchange = () => selectSession($("sessionSelect").value);

$("createSessionBtn").onclick = async () => {
  try {
    const s = await rpc("t_create_session", { p_class: classId, p_title: $("newSessionTitle").value || "Session", p_date: $("newSessionDate").value,
      p_time: $("newSessionTime").value || null, p_kind: $("newSessionKind").value });
    sessionId = s.id;
    if ($("newSessionEnd").value) await rpc("t_set_session_end_time", { p_session: s.id, p_end_time: $("newSessionEnd").value });
    toast("Session created, code " + s.code, "ok");
    await loadSessions();
  } catch (e) { toast(e.message, "error"); }
};

async function selectSession(id) {
  sessionId = id || null;
  clearInterval(pollTimer); clearInterval(attendanceTimer);
  $("liveArea").classList.toggle("hidden", !sessionId);
  $("sessionCodeBox").classList.toggle("hidden", !sessionId);
  $("sessionOptions").classList.toggle("hidden", !sessionId);
  $("noSessionHelp").classList.toggle("hidden", !!sessionId);
  if (!sessionId) { $("sessionUrl").textContent = ""; $("projMini").removeAttribute("src"); $("nowPill").classList.add("hidden"); return; }
  const miniSrc = "projector.html?session=" + sessionId + "&mini=1";
  if ($("projMini").getAttribute("src") !== miniSrc) $("projMini").setAttribute("src", miniSrc);
  localStorage.setItem("cp_session", sessionId);
  sessionCode = $("sessionSelect").selectedOptions[0].dataset.code;
  const url = siteUrl("student.html") + "?s=" + sessionCode;
  $("sessionCodeBig").textContent = sessionCode;
  $("sessionUrl").innerHTML = `Student address: <a href="${url}" target="_blank">${url}</a><br>The session code identifies the session and never changes. The projector also shows an <strong>attendance code</strong>
    that changes every few seconds (it is inside the QR code): it proves that the student is in the room when he checks in.`;
  channel = liveChannel(sessionCode, () => {});
  await loadQuizzes();
  await refreshLive();
  await refreshAttendance();
  renderDrawn();
  pollTimer = setInterval(refreshLive, CONFIG.teacherPollMs);
  attendanceTimer = setInterval(refreshAttendance, 5000);
}

// Every change: tell the phones through the live channel, then refresh.
async function act(fn, args, okMessage) {
  try {
    await rpc(fn, args);
    if (channel) channel.ping();
    if (okMessage) toast(okMessage, "ok");
    if (fn.startsWith("t_quiz_")) { const keep = $("quizSelect").value; await loadQuizzes(); if (keep) $("quizSelect").value = keep; }
    await refreshLive();
  } catch (e) { toast(e.message, "error"); }
}

$("attOnBtn").onclick = () => act("t_set_attendance_open", { p_session: sessionId, p_open: true }, "Attendance open.");
$("attOffBtn").onclick = () => act("t_set_attendance_open", { p_session: sessionId, p_open: false }, "Attendance closed.");

// Leaving the quiz screen while a question is running: ask first.
function questionRunning() { return live && live.session.activity === "quiz" && live.quiz && live.quiz.phase === "question"; }
$("idleBtn").onclick = () => {
  if (questionRunning() && !confirm("A question is running. The phones will leave the quiz (you can come back with 'Show the quiz'). Continue?")) return;
  act("t_set_activity", { p_session: sessionId, p_activity: "idle" });
};
$("showQuizBtn").onclick = () => act("t_set_activity", { p_session: sessionId, p_activity: "quiz" }, "The phones show the quiz again.");
$("linkModeBtn").onclick = () => {
  const s = live && live.session;
  if (!s || !s.link_url) return;
  if (questionRunning() && !confirm("A question is running. The phones will leave the quiz. Continue?")) return;
  act("t_set_activity", { p_session: sessionId, p_activity: "link", p_link_url: s.link_url, p_link_label: s.link_label }, "The phones show the link again.");
};

async function saveSessionOptions() {
  await act("t_set_session_options", { p_session: sessionId, p_att_window: Number($("optWindow").value), p_check_location: $("optLocation").checked }, "Session settings saved.");
}
$("optWindow").onchange = saveSessionOptions;
$("optLocation").onchange = saveSessionOptions;
// ------------------------------------------------------------------ projector: ONE window, two-way channel
// The console and the projector window talk through a BroadcastChannel (same browser).
// The projector answers with its status (what it shows over the normal screen), so that the buttons
// of the console always say the truth: "Show join QR" / "Hide join QR", "Projector open"...
const PROJECTOR_NAME = "classpulse_projector";
let projBc = null, projBcSession = null;
let projStatus = { at: 0, overlay: "", screen: null };
let lastDrawMsg = null;
function projectorUrl() { return "projector.html?session=" + sessionId; }
function projectorAlive() { return Date.now() - projStatus.at < 4500; }
function projectorChannel() {
  if (!window.BroadcastChannel || !sessionId) return null;
  if (projBc && projBcSession === sessionId) return projBc;
  if (projBc) projBc.close();
  projBc = new BroadcastChannel("classpulse_projector_" + sessionId);
  projBcSession = sessionId;
  projStatus = { at: 0, overlay: "", screen: null };
  projBc.onmessage = (e) => {
    const m = e.data || {};
    if (m.type === "status") { projStatus = { at: Date.now(), overlay: m.overlay || "", screen: m.screen || null }; updateProjectorButtons(); }
  };
  projBc.postMessage({ type: "ping" });
  return projBc;
}
function projectorSend(msg) {
  const bc = projectorChannel();
  if (bc) bc.postMessage(msg);
}
// Open the projector window the first time; afterwards only bring it to the front (no reload, no new tab).
function openProjector(quiet) {
  let w = null;
  try { w = window.open("", PROJECTOR_NAME); } catch (e) { w = null; }
  if (!w) { toast("The browser blocked the projector window: allow pop-ups for this site.", "error"); return false; }
  let current = "";
  try { current = w.location.href; } catch (e) { current = ""; }
  const wanted = new URL(projectorUrl(), location.href).href;
  if (current !== wanted) { w.location.href = wanted; if (!quiet) toast("Projector window opened: move it to the projector screen and press F.", "ok"); }
  else if (!quiet) toast("The projector is already open.", "ok");
  try { w.focus(); } catch (e) { /* ignore */ }
  return true;
}
// Send a message to the projector, opening it first if needed.
function toProjector(msg) {
  if (projectorAlive()) { projectorSend(msg); return; }
  if (!openProjector(true)) return;
  setTimeout(() => projectorSend(msg), 2500);
}
function updateProjectorButtons() {
  const alive = projectorAlive();
  $("projState").textContent = alive ? "● open" : "not open";
  $("projState").className = "proj-state " + (alive ? "on" : "off");
  $("projectorBtn").textContent = alive ? "🖥 Bring to front" : "🖥 Open projector";
  const join = alive && projStatus.overlay === "join";
  $("joinQrBtn").textContent = join ? "✕ Hide join QR" : "📱 Show join QR";
  $("joinQrBtn").className = "small " + (join ? "red" : "orange");
  const draw = alive && projStatus.overlay === "draw";
  $("drawHideBtn").textContent = draw ? "Hide from projector" : "Show again on projector";
  $("drawHideBtn").disabled = !draw && !lastDrawMsg;
  updateScreenBtn();
}
setInterval(() => { if (sessionId) { projectorChannel(); updateProjectorButtons(); } }, 2000);
$("projectorBtn").onclick = () => openProjector(false);
$("joinQrBtn").onclick = () => {
  if (projectorAlive() && projStatus.overlay === "join") { projectorSend({ type: "join", show: false }); projStatus.overlay = ""; }
  else { toProjector({ type: "join", show: true }); projStatus.overlay = "join"; }
  updateProjectorButtons();
};

// ------------------------------------------------------------------ random student
let lastAttendance = [];
function drawKey() { return "cp_drawn_" + sessionId; }
function loadDrawn() { try { return JSON.parse(localStorage.getItem(drawKey()) || "[]"); } catch (e) { return []; } }
function saveDrawn(list) { try { localStorage.setItem(drawKey(), JSON.stringify(list)); } catch (e) { /* ignore */ } }
function drawPool() {
  const drawn = new Set(loadDrawn().map((d) => d.id));
  return lastAttendance.filter((r) => (r.status === "present" || r.status === "late") && !drawn.has(r.student_id));
}
function updateDrawInfo() {
  if (!$("drawPoolInfo")) return;
  const present = lastAttendance.filter((r) => r.status === "present" || r.status === "late").length;
  $("drawPoolInfo").textContent = `${drawPool().length} can be drawn out of ${present} checked in`;
}
function renderDrawn() {
  const list = loadDrawn();
  const label = { bonus: '<span class="badge open">+0.25 given</span>', passed: '<span class="badge closed">passed</span>' };
  $("drawList").innerHTML = list.slice().reverse().map((d) => `<tr><td class="name">${esc(d.name)}</td>
    <td class="muted">${new Date(d.at).toLocaleTimeString()}</td>
    <td>${d.result ? label[d.result] : `<button class="small green" data-draw-bonus="${d.id}">✓ +0.25</button>
      <button class="small secondary" data-draw-pass="${d.id}">Pass</button>`}</td></tr>`).join("");
  $("drawList").querySelectorAll("[data-draw-bonus]").forEach((b) => b.onclick = async () => {
    try {
      await rpc("t_add_bonus", { p_session: sessionId, p_student: b.dataset.drawBonus, p_points: 0.25 });
      setDrawResult(b.dataset.drawBonus, "bonus");
      toast("Bonus +0.25 recorded.", "ok");
      refreshAttendance();
    } catch (e) { toast(e.message, "error"); }
  });
  $("drawList").querySelectorAll("[data-draw-pass]").forEach((b) => b.onclick = () => setDrawResult(b.dataset.drawPass, "passed"));
  updateDrawInfo();
}
function setDrawResult(id, result) {
  const list = loadDrawn();
  for (let i = list.length - 1; i >= 0; i--) if (list[i].id === id && !list[i].result) { list[i].result = result; break; }
  saveDrawn(list);
  renderDrawn();
}
async function drawStudents(n) {
  if (!sessionId) return;
  await refreshAttendance();
  const pool = drawPool();
  if (!pool.length) { toast("Nobody left to draw: every checked-in student has been drawn. Click Reset.", "error"); return; }
  const winners = [];
  const bag = pool.slice();
  for (let i = 0; i < n && bag.length; i++) winners.push(bag.splice(Math.floor(Math.random() * bag.length), 1)[0]);
  const spinMs = 2200;
  lastDrawMsg = { type: "draw", pool: pool.map((r) => r.name), winners: winners.map((r) => r.name), spinMs };
  if ($("drawOnProjector").checked) toProjector(lastDrawMsg);
  const list = loadDrawn();
  winners.forEach((w) => list.push({ id: w.student_id, name: w.name, at: Date.now(), result: "" }));
  saveDrawn(list);
  // show the result on the console after the projector animation, so the teacher does not spoil it
  setTimeout(renderDrawn, $("drawOnProjector").checked ? spinMs : 0);
  if (winners.length < n) toast(`Only ${winners.length} student(s) left to draw.`, "error");
}
$("draw1Btn").onclick = () => drawStudents(1);
$("draw3Btn").onclick = () => drawStudents(3);
$("drawHideBtn").onclick = () => {
  if (projectorAlive() && projStatus.overlay === "draw") { projectorSend({ type: "hide" }); projStatus.overlay = ""; }
  else if (lastDrawMsg) { toProjector(Object.assign({}, lastDrawMsg, { spinMs: 0 })); projStatus.overlay = "draw"; }
  updateProjectorButtons();
};
$("drawResetBtn").onclick = () => {
  if (!confirm("Forget who has been drawn in this session? Everyone can be drawn again (bonuses already given are kept).")) return;
  saveDrawn([]);
  renderDrawn();
};
// The push list: demos of the site (config.js) + the teacher's own resources + a free address.
function pushChoices() {
  const site = allDemos.map((d) => ({ label: d.title, url: d.url, screen: d.screen, demo: true, group: "Demos" + (d.module ? " - " + d.module : "") }));
  const mine = myResources.map((r) => ({ label: r.title, url: r.url, path: r.storage_path, group: r.module ? "My resources - " + r.module : "My resources" }));
  return site.concat(mine);
}

function fillPushList() {
  const choices = pushChoices();
  const groups = [...new Set(choices.map((c) => c.group))];
  $("linkSelect").innerHTML = groups.map((g) => `<optgroup label="${esc(g)}">` +
    choices.map((c, i) => c.group === g ? `<option value="${i}">${esc(c.label)}</option>` : "").join("") + `</optgroup>`).join("") +
    `<option value="custom">Other address…</option>`;
  updateScreenBtn();
}

function screenUrlOf(c) { return c && c.screen ? new URL(c.screen, location.href).href : null; }
function updateScreenBtn() {
  const c = pushChoices()[$("linkSelect").value];
  const url = screenUrlOf(c);
  const showing = url && projectorAlive() && projStatus.overlay === "screen" && projStatus.screen === url;
  $("screenBtn").classList.toggle("hidden", !url && !(projectorAlive() && projStatus.overlay === "screen"));
  $("screenBtn").textContent = showing || (!url && projStatus.overlay === "screen") ? "✕ Close big screen" : "🖥 Big screen on projector";
}
$("linkSelect").onchange = updateScreenBtn;
// The big-screen page of a demo opens INSIDE the projector window (no new tab); the phones are not changed.
$("screenBtn").onclick = () => {
  const c = pushChoices()[$("linkSelect").value];
  const url = screenUrlOf(c);
  if (projectorAlive() && projStatus.overlay === "screen" && (!url || projStatus.screen === url)) {
    projectorSend({ type: "screen", url: null }); projStatus.overlay = "";
  } else if (url) {
    toProjector({ type: "screen", url, label: c.label }); projStatus.overlay = "screen"; projStatus.screen = url;
  }
  updateProjectorButtons();
};

$("linkBtn").onclick = () => {
  const v = $("linkSelect").value;
  let link = pushChoices()[v];
  if (v === "custom") {
    const url = prompt("Address to open on the phones (https://...)");
    if (!url) return;
    link = { label: "Open the link", url };
  }
  pushLink(link);
};

async function pushLink(link) {
  if (!link) return;
  if (!sessionId) { toast("Choose or create a session first (Live session tab).", "error"); return; }
  let url = link.url;
  if (link.path) {
    // private file: give the phones a temporary signed link
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(link.path, CONFIG.signedLinkHours * 3600);
    if (error) { toast("Cannot create the file link: " + error.message, "error"); return; }
    url = data.signedUrl;
  } else {
    url = new URL(url, location.href).href; // "demos/..." becomes a full address
  }
  try {
    const r = await rpc("t_share_link", { p_session: sessionId, p_url: url, p_label: link.label, p_document: !link.demo });
    if (channel) channel.ping();
    toast(r === "SHOWN" ? "Sent to the phones." : "A quiz is running: the link is added to the documents of the session, the phones will see it after the quiz.", "ok");
    await refreshLive();
  } catch (e) { toast(e.message, "error"); }
}

// ------------------------------------------------------------------ live figures
async function refreshLive() {
  if (!sessionId) return;
  try { live = await rpc("t_live", { p_session: sessionId }); } catch (e) { return; }
  const s = live.session;
  $("activityBadge").textContent = { idle: "Waiting screen", attendance: "Waiting screen", quiz: "Quiz", link: "Link: " + (s.link_label || "") }[s.activity] || s.activity;
  $("presentCount").textContent = live.present;
  $("classSize").textContent = live.class_size;
  $("attState").textContent = s.attendance_open ? "open" : "closed";
  $("attBadge").textContent = s.attendance_open ? "attendance OPEN" : "attendance closed";
  $("attBadge").className = "badge " + (s.attendance_open ? "open" : "closed");
  $("attOnBtn").disabled = s.attendance_open;
  $("attOffBtn").disabled = !s.attendance_open;
  $("showQuizBtn").disabled = !s.active_quiz_id;
  $("idleBtn").classList.toggle("on", s.activity === "idle" || s.activity === "attendance");
  $("showQuizBtn").classList.toggle("on", s.activity === "quiz");
  $("linkModeBtn").classList.toggle("on", s.activity === "link");
  $("linkModeBtn").disabled = !s.link_url;
  $("linkModeBtn").title = s.link_url ? "Back to: " + (s.link_label || s.link_url) : "No demo or link pushed yet";
  if (document.activeElement !== $("optWindow")) $("optWindow").value = String(s.att_window_s || 15);
  $("optLocation").checked = !!s.check_location;
  checkLocation = !!s.check_location;
  renderQuizLive();
  renderMonitor();
  renderSessionLinks();
  renderAttendanceCode();
  autoMode();
}

// ------------------------------------------------------------------ v10: what is happening now
// Status pill of the class banner: what the students are doing right now.
function nowStatus() {
  const s = live.session, q = live.quiz;
  if (s.ended_at) return { cls: "ended", text: "⏹ Session ended" };
  if (s.activity === "quiz" && q) {
    if (q.phase === "question") return { cls: "live", text: `● Question ${q.index + 1}/${q.count} running` };
    if (q.phase === "self") return { cls: "live", text: `● Test open: ${q.done || 0}/${live.present} finished` };
    if (q.phase === "lobby") return { cls: "warn", text: "Rules on the phones" };
    if (q.phase === "reveal") return { cls: "warn", text: `Answers of question ${q.index + 1} shown` };
    if (q.phase === "finished") return { cls: "info", text: "Quiz finished" };
  }
  if (s.activity === "link") return { cls: "info", text: "📎 " + (s.link_label || "Link") + " on the phones" };
  if (s.attendance_open) return { cls: "att", text: `● Attendance open: ${live.present} present` };
  return { cls: "idle", text: "Waiting screen" };
}

// Small phone: a text version of the screen the students see.
function phoneScreen() {
  const s = live.session, q = live.quiz;
  if (s.ended_at) return `<div class="pm-icon">⏹</div><div class="pm-title">Session ended</div><div>See you next time.</div>`;
  if (s.activity === "link") return `<div class="pm-icon">📎</div><div class="pm-title">${esc(s.link_label || "Link")}</div><div class="pm-btn">Open</div>`;
  if (s.activity === "quiz" && q) {
    if (q.phase === "lobby") return `<div class="pm-icon">📋</div><div class="pm-title">${esc(q.title)}</div><div>Rules of the quiz</div><div class="pm-btn">I am ready</div>`;
    if (q.phase === "self") return `<div class="pm-title">${esc(q.title)}</div><div>${q.count} questions, at their own pace</div>` +
      Array.from({ length: Math.min(q.count, 4) }, (_, i) => `<div class="pm-opt">Q${i + 1} …</div>`).join("") + (q.count > 4 ? "<div>…</div>" : "");
    if (q.phase === "question" || q.phase === "reveal") {
      const head = `<div class="pm-small">Question ${q.index + 1}/${q.count}${q.phase === "question" ? " · " + formatSeconds(q.remaining_ms) + " s" : " · closed"}</div>`;
      if (q.per_student) return head + `<div class="pm-title">Each student has his own question</div>`;
      return head + `<div class="pm-q">${esc(q.question || "")}</div>` + (q.options || []).map((o, i) =>
        `<div class="pm-opt ${q.phase === "reveal" && q.reveal_mode === "each" && q.correct.includes(i) ? "ok" : ""}">${LETTERS[i]}. ${esc(o)}</div>`).join("");
    }
    if (q.phase === "finished") return `<div class="pm-icon">✅</div><div class="pm-title">Quiz finished</div><div>${q.reveal_mode === "never" ? "Thank you" : "Their answers and mark"}</div>`;
  }
  if (s.attendance_open) return `<div class="pm-icon">📷</div><div class="pm-title">Check in</div><div>Scan the QR code of the projector</div>`;
  return `<div class="pm-icon">⏸</div><div class="pm-title">Waiting</div><div>The phone waits for your next step.</div>`;
}

function renderMonitor() {
  const s = live.session;
  const st = nowStatus();
  $("nowPill").className = "now-pill " + st.cls;
  $("nowPill").textContent = st.text;
  $("phoneMock").innerHTML = `<div class="pm-screen">${phoneScreen()}</div>`;
  const ended = !!s.ended_at;
  $("endedBox").classList.toggle("hidden", !ended);
  $("endedAt").textContent = ended ? "at " + new Date(s.ended_at).toLocaleTimeString().slice(0, 5) : "";
  $("endSessionBtn").classList.toggle("hidden", ended);
  if (ended) { $("attOnBtn").disabled = true; $("showQuizBtn").disabled = true; $("linkModeBtn").disabled = true; }
}

// The attendance code in the console itself: needed when there is no projector (labs), handy on a phone.
let attCodeShown = "";
async function renderAttendanceCode() {
  const s = live.session;
  $("attCodeBox").classList.toggle("hidden", !s.attendance_open || !!s.ended_at);
  if (!s.attendance_open || s.ended_at) { attCodeShown = ""; return; }
  let a;
  try { a = await rpc("t_attendance_code", { p_session: sessionId }); } catch (e) { return; }
  if (a.code === attCodeShown) return;
  attCodeShown = a.code;
  $("attCodeBig").textContent = a.code;
  $("attCodeLabel").textContent = a.window_s >= 3600 ? "Attendance code (fixed today)" : `Attendance code (changes every ${a.window_s} s)`;
  const qr = qrcode(0, "M"); qr.addData(siteUrl("student.html") + "?s=" + s.code + "&a=" + a.code); qr.make();
  $("attCodeQr").innerHTML = qr.createSvgTag({ cellSize: 3, margin: 0 });
}

// Links and files kept on the phones for this session ("Documents of this session"): the teacher can remove them.
function renderSessionLinks() {
  const links = (live.session.links || []);
  $("sessionLinks").innerHTML = links.length === 0 ? "" : `<div class="muted" style="margin-top:10px">Kept on the phones for this session:</div>` +
    links.map((l) => `<div class="sl"><span title="${esc(l.url)}">${esc(l.label || l.url)}</span><button class="small secondary" data-slink="${l.id}" title="Remove from the phones">✕</button></div>`).join("");
  $("sessionLinks").querySelectorAll("[data-slink]").forEach((b) => b.onclick = () => {
    if (!confirm("Remove this document from the phones for this session?")) return;
    act("t_remove_session_link", { p_session: sessionId, p_id: Number(b.dataset.slink) }, "Removed from the phones.");
  });
}

$("endSessionBtn").onclick = () => {
  if (!confirm("End the session?\nAttendance is closed, a running quiz is finished, and the phones show 'Session ended'.\nYou can reopen it later.")) return;
  act("t_end_session", { p_session: sessionId }, "Session ended.").then(loadSessionsQuiet);
};
$("reopenBtn").onclick = () => {
  if (!confirm("Reopen the session? (Attendance stays closed until you open it.)")) return;
  act("t_reopen_session", { p_session: sessionId }, "Session reopened.").then(loadSessionsQuiet);
};
// Refresh the session list (labels, "ended") without re-selecting the session.
async function loadSessionsQuiet() {
  try {
    allSessions = await rpc("t_list_sessions", { p_class: classId });
    renderSessionsTable();
  } catch (e) { /* ignore */ }
}

// The mini projector is a 1280x720 page scaled down to the width of its box.
function scaleMini() {
  const box = document.querySelector(".proj-mini");
  if (box && box.clientWidth) $("projMini").style.transform = "scale(" + (box.clientWidth / 1280) + ")";
}
if (window.ResizeObserver) new ResizeObserver(scaleMini).observe(document.querySelector(".proj-mini"));
window.addEventListener("resize", scaleMini);

$("bannerName").onclick = (e) => { e.preventDefault(); document.querySelector("nav button[data-tab=classes]").click(); };

function renderQuizLive() {
  const q = live.quiz;
  const box = $("quizLive");
  if (!q) { box.innerHTML = `<p class="muted">No quiz running.</p>`; $("lockedBox").classList.add("hidden"); return; }
  let left = "";
  const self = q.pace === "self";
  ["startBtn", "revealBtn", "nextBtn", "addTimeBtn"].forEach((id) => { $(id).disabled = self; });
  $("nextBtn").textContent = !self && q.is_last && (q.phase === "question" || q.phase === "reveal") ? "Finish quiz?" : "Next question";
  if (self) {
    const perQ = q.per_question || [];
    box.innerHTML = `<div><p><strong>${esc(q.title)}</strong> · self-paced${q.ask_variant ? " · board number asked" : ""}</p>
      <p>${q.phase === "self" ? "OPEN: students answer at their own pace, and can change an answer until you click <strong>Finish quiz</strong>."
        : q.phase === "finished" ? "Finished." : "Not open yet: click <strong>1. Open</strong>."}</p>
      <table>${perQ.map((n, i) => `<tr><td>Q${i + 1}</td><td><div class="b" style="display:inline-block;height:10px;background:#1B7F8C;border-radius:4px;width:${Math.max(3, (160 * n) / Math.max(1, live.present))}px"></div></td><td>${n}</td></tr>`).join("")}</table></div>
      <div><div class="stat">${q.started == null ? 0 : q.started} / ${live.present}</div><div class="muted">students started</div>
      <div class="stat" style="margin-top:10px">${q.done == null ? 0 : q.done}</div><div class="muted">answered every question</div></div>`;
    if (q.phase === "finished" && q.results) { box.innerHTML = resultsPanel(q); bindResultsToggle(q); }
    $("lockedBox").classList.add("hidden");
    return;
  }
  if ((q.phase === "question" || q.phase === "reveal") && q.per_student) {
    left = `<div><p><strong>Question ${q.index + 1} / ${q.count}</strong> · ${q.phase === "question" ? `<span class="timer">${formatSeconds(q.remaining_ms)} s</span>` : "closed"}</p>
      <p>Each student has <strong>his own questions</strong> (random draw): nothing to show here or on the projector.</p></div>`;
  } else if (q.phase === "question" || q.phase === "reveal") {
    const max = Math.max(1, ...(q.distribution || [0]));
    left = `<div><p><strong>Question ${q.index + 1} / ${q.count}</strong> · ${q.phase === "question" ? `<span class="timer">${formatSeconds(q.remaining_ms)} s</span>` : "answers shown"}</p>
      <p>${esc(q.question)}</p><p class="muted">Answers shown to students: ${{ each: "after each question", end: "at the end", never: "never" }[q.reveal_mode] || ""}</p><div class="bars">` +
      q.options.map((o, i) => `<div class="bar"><span class="l">${LETTERS[i]}</span><div class="b ${!q.survey && q.correct.includes(i) ? "ok" : ""}" style="width:${Math.max(4, (200 * q.distribution[i]) / max)}px"></div>
        <span>${q.distribution[i]}</span><span class="muted">${esc(o)}</span></div>`).join("") + `</div></div>`;
  } else if (q.phase === "lobby") {
    left = `<div><p><strong>${esc(q.title)}</strong> · ${KIND_LABEL[q.kind] || ""}</p><p>The phones show the rules. No timer runs.</p>
      <p><span class="stat">${q.ready}</span> / ${live.present} ready</p><p class="muted">When enough students are ready, click <strong>2. Start question 1</strong>.</p></div>`;
  } else {
    left = `<div><p><strong>${esc(q.title)}</strong></p><p>${q.phase === "finished" ? "Finished." : "Not started."}</p></div>`;
    if (q.phase === "finished" && q.results) { box.innerHTML = resultsPanel(q); bindResultsToggle(q); $("lockedBox").classList.add("hidden"); return; }
  }
  const right = `<div><div class="stat">${q.answers} / ${live.present}</div><div class="muted">answers to this question</div>
    ${q.survey ? `<div class="muted" style="margin-top:10px">survey: no right answer</div>` : `<div class="stat" style="margin-top:10px">${q.success_rate == null ? "-" : q.success_rate + " %"}</div><div class="muted">full marks</div>`}</div>`;
  box.innerHTML = left + right;
  $("lockedBox").classList.toggle("hidden", q.locked.length === 0);
  $("lockedCount").textContent = q.locked.length;
  $("lockedList").innerHTML = q.locked.length === 0 ? "" : `<table>` + q.locked.map((l) =>
    `<tr><td>${esc(l.name)}</td><td>left ${l.leaves} time(s)</td><td><button class="small green" data-unlock="${l.student_id}">Unlock</button></td></tr>`).join("") + `</table>`;
  $("lockedList").querySelectorAll("[data-unlock]").forEach((b) => b.onclick = () =>
    act("t_unlock", { p_quiz: q.id, p_student: b.dataset.unlock }, "Student unlocked."));
}

// Marks of a finished quiz: mean, median, success rate, distribution. The questions are never shown.
function resultsPanel(q) {
  const r = q.results, max = Math.max(1, ...(r.histogram || [0]));
  const tot = Number(r.total_points);
  const bars = (r.histogram || []).map((n, i) => `<div class="hbar" title="${(i * tot / 10).toFixed(1)}-${((i + 1) * tot / 10).toFixed(1)}: ${n}">
    <div style="height:${Math.round((70 * n) / max)}px"></div><span>${n || ""}</span></div>`).join("");
  return `<div><p><strong>${esc(q.title)}</strong> · finished · ${r.count} student(s)</p>
      <div class="row" style="gap:22px"><div><div class="stat">${r.mean == null ? "-" : Number(r.mean)}<small>/${tot}</small></div><div class="muted">mean</div></div>
        <div><div class="stat">${r.median == null ? "-" : Number(r.median)}</div><div class="muted">median</div></div>
        <div><div class="stat">${r.success_pct == null ? "-" : r.success_pct + " %"}</div><div class="muted">at least ${tot / 2}/${tot}</div></div></div>
      <button id="resultsOnProj" class="${q.results_on_projector ? "red" : "orange"}" style="margin-top:12px">${q.results_on_projector ? "✕ Hide the results from the projector" : "🖥 Show the results on the projector"}</button>
      <div class="muted" style="font-size:12px;margin-top:4px">No question and no name: mean, median, success rate and distribution only.</div></div>
    <div><div class="muted">Distribution of the marks (0 → ${tot})</div><div class="hist">${bars}</div></div>`;
}
function bindResultsToggle(q) {
  const btn = $("resultsOnProj");
  if (!btn) return;
  btn.onclick = () => {
    const show = !q.results_on_projector;
    if (show && !projectorAlive()) openProjector(true);
    act("t_quiz_show_results", { p_quiz: q.id, p_show: show }, show ? "Results shown on the projector." : "Results hidden from the projector.");
  };
}

// Automatic mode: close at the end of the timer, then next question after a pause.
function autoMode() {
  const q = live.quiz;
  if (!$("autoMode").checked || !q) return;
  if (q.phase === "question" && q.remaining_ms <= 0 && !autoTimer) {
    autoTimer = setTimeout(async () => { autoTimer = null; await act("t_quiz_reveal", { p_quiz: q.id }); }, 300);
  }
  if (q.phase === "reveal" && !autoTimer) {
    autoTimer = setTimeout(async () => { autoTimer = null; await act("t_quiz_next", { p_quiz: q.id }); }, CONFIG.autoNextDelayS * 1000);
  }
}

// ------------------------------------------------------------------ quiz controls
async function loadQuizzes() {
  const quizzes = await rpc("t_list_quizzes", { p_session: sessionId });
  quizList = quizzes;
  const modeLabel = { each: "answers after each question", end: "answers at the end", never: "answers never shown" };
  $("quizSelect").innerHTML = quizzes.map((q) => `<option value="${q.id}">[${KIND_LABEL[q.kind] || "Quiz"}${q.graded ? "" : ", not graded"}] ${esc(q.title)} (${q.pace === "self" ? "self-paced, " : ""}${q.per_student ? q.count + " q. per student from " + q.pool : q.count + " q."}, /${Number(q.total_points)}, ${q.status}, ${modeLabel[q.reveal_mode] || ""}${q.time_override ? ", " + q.time_override + " s each" : ""})</option>`).join("") ||
    `<option value="">- create a quiz below -</option>`;
  allQuestions = await rpc("t_list_questions", { p_module: null, p_class: classId });
  fillPickFilters();
  renderQuestionPicker();
  if ($("drawRules").children.length === 0) addDrawRule();
}

// Accepted answer of a numeric question, as text: "3 (±5 %)", "10..40", "1:2; 2:2.24".
function numSpecText(q, forFile) {
  const sp = q.num_spec || {};
  if (sp.min !== undefined) return `${sp.min}..${sp.max}`;
  if (sp.variants) return Object.entries(sp.variants).map(([k, v]) => `${k}:${v}`).join("; ") + (forFile ? "" : ` (±${Number(q.tolerance)} %)`);
  return `${sp.value}` + (forFile ? "" : ` (±${Number(q.tolerance)} %)`);
}

const KIND_LABEL = { quiz: "Course quiz", test: "Test", tp: "TP test", survey: "Survey" };

// ----- question picker (tick by hand)
let picked = [];              // ticked question ids, in the order they were chosen
const modulesOf = () => [...new Set(allQuestions.map((q) => q.module))].sort();
const chaptersOf = (m) => [...new Set(allQuestions.filter((q) => !m || q.module === m).map((q) => q.chapter))].sort();

function fillPickFilters() {
  const m = $("pickModule").value;
  $("pickModule").innerHTML = `<option value="">All modules</option>` + modulesOf().map((x) => `<option ${x === m ? "selected" : ""}>${esc(x)}</option>`).join("");
  const c = $("pickChapter").value;
  $("pickChapter").innerHTML = `<option value="">All chapters</option>` + chaptersOf($("pickModule").value).map((x) => `<option ${x === c ? "selected" : ""}>${esc(x)}</option>`).join("");
}

function renderQuestionPicker() {
  const m = $("pickModule").value, c = $("pickChapter").value, f = $("quizFilter").value.trim().toLowerCase();
  const list = allQuestions.filter((q) => (!m || q.module === m) && (!c || q.chapter === c) && (!f || q.text.toLowerCase().includes(f)));
  $("pickCount").textContent = picked.length;
  $("quizQuestionList").innerHTML = list.length === 0 ? `<p class="muted">No question. Import questions in the Questions tab.</p>` :
    `<table>` + list.map((q) => `<tr><td><input type="checkbox" value="${q.id}" ${picked.includes(q.id) ? "checked" : ""} style="width:auto"></td>
      <td>${esc(q.module)} · ${esc(q.chapter)} · ${esc(q.ref)}</td><td>${esc(q.text)}</td><td>${q.qtype === "number" ? "🔢 number" : q.correct.length > 1 ? "several" : "one"}</td><td>${q.time_limit} s</td></tr>`).join("") + `</table>`;
  $("quizQuestionList").querySelectorAll("input[type=checkbox]").forEach((cb) => cb.onchange = () => {
    picked = cb.checked ? picked.concat(cb.value) : picked.filter((id) => id !== cb.value);
    $("pickCount").textContent = picked.length;
  });
}
$("pickModule").onchange = () => { $("pickChapter").value = ""; fillPickFilters(); renderQuestionPicker(); };
$("pickChapter").onchange = renderQuestionPicker;
$("quizFilter").oninput = renderQuestionPicker;
$("clearPickBtn").onclick = () => { picked = []; renderQuestionPicker(); };
$("tickAllBtn").onclick = () => {
  $("quizQuestionList").querySelectorAll("input[type=checkbox]").forEach((cb) => { if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event("change")); } });
};

// ----- random draw: rules "N questions from module M, chapter C"
function addDrawRule() {
  const row = document.createElement("div");
  row.className = "row draw-rule";
  row.style.cssText = "gap:6px;margin-top:4px;align-items:center";
  row.innerHTML = `<input type="number" class="rCount" min="1" value="2" style="width:70px"> <span class="muted">question(s) from</span>
    <select class="rModule" style="width:auto"><option value="">any module</option>${modulesOf().map((x) => `<option>${esc(x)}</option>`).join("")}</select>
    <select class="rChapter" style="width:auto"></select> <button class="small secondary rDel">✕</button>`;
  const fillCh = () => { row.querySelector(".rChapter").innerHTML = `<option value="">any chapter</option>` +
    chaptersOf(row.querySelector(".rModule").value).map((x) => `<option>${esc(x)}</option>`).join(""); };
  row.querySelector(".rModule").onchange = fillCh;
  row.querySelector(".rDel").onclick = () => row.remove();
  fillCh();
  $("drawRules").appendChild(row);
}
$("addRuleBtn").onclick = addDrawRule;

function shuffled(list) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

$("drawBtn").onclick = () => {
  const chosen = [];
  const messages = [];
  document.querySelectorAll("#drawRules .draw-rule").forEach((row) => {
    const n = Number(row.querySelector(".rCount").value) || 0;
    const m = row.querySelector(".rModule").value, c = row.querySelector(".rChapter").value;
    const pool = allQuestions.filter((q) => (!m || q.module === m) && (!c || q.chapter === c) && !chosen.includes(q.id));
    const take = shuffled(pool).slice(0, n).map((q) => q.id);
    if (take.length < n) messages.push(`only ${take.length} available for ${m || "any module"} / ${c || "any chapter"}`);
    chosen.push(...take);
  });
  picked = chosen;
  $("pickModule").value = ""; $("pickChapter").value = ""; $("quizFilter").value = "";
  fillPickFilters();
  renderQuestionPicker();
  toast(`${chosen.length} question(s) drawn and ticked.` + (messages.length ? " Note: " + messages.join("; ") : ""), messages.length ? "error" : "ok");
};

// Automatic title: module · chapters · type · date, e.g. "IoT S1 · Course quiz · 29/09"
function defaultQuizTitle(ids) {
  const qs = allQuestions.filter((q) => ids.includes(q.id));
  const modules = [...new Set(qs.map((q) => q.module))];
  const chapters = [...new Set(qs.map((q) => q.chapter).filter(Boolean))];
  const d = new Date();
  const parts = [modules.join("+"), chapters.length <= 3 ? chapters.join("+") : chapters.length + " chapters", KIND_LABEL[$("quizKind").value],
    String(d.getDate()).padStart(2, "0") + "/" + String(d.getMonth() + 1).padStart(2, "0")].filter(Boolean);
  return parts.filter((x, i) => parts.indexOf(x) === i).join(" · ");
}

function syncQuizOptions() {
  const survey = $("quizKind").value === "survey";
  const perStudent = $("quizPerStudent").checked;
  const selfPaced = $("quizPace").value === "self";
  $("quizTime").disabled = selfPaced;
  if (selfPaced && $("quizReveal").value === "each") $("quizReveal").value = "end";   // no "after each question" without a timer
  if (selfPaced) $("quizProjector").checked = false;
  $("quizGraded").disabled = survey; if (survey) $("quizGraded").checked = false;
  $("quizProjector").disabled = perStudent || selfPaced;
  if (perStudent) $("quizProjector").checked = false;
  if (survey && !perStudent) $("quizProjector").checked = true;
}
["quizKind", "quizPerStudent", "quizPace"].forEach((id) => { $(id).onchange = syncQuizOptions; });

$("createQuizBtn").onclick = async () => {
  if (picked.length === 0) { toast("Tick questions or use the random draw first.", "error"); return; }
  const ids = $("quizShuffle").checked ? shuffled(picked) : picked;
  const perStudent = $("quizPerStudent").checked ? Number($("quizPerStudentN").value) : null;
  if (perStudent && (perStudent < 1 || perStudent > ids.length)) { toast(`Each student can get 1 to ${ids.length} questions (the ticked ones).`, "error"); return; }
  if (perStudent && perStudent === ids.length) toast("Every student gets all the ticked questions (only the order of the options changes). Tick more questions for a real draw.", "error");
  try {
    await rpc("t_create_quiz", { p_session: sessionId, p_title: $("quizTitle").value.trim() || defaultQuizTitle(ids), p_question_ids: ids,
      p_reveal_mode: $("quizReveal").value, p_time_override: $("quizTime").value ? Number($("quizTime").value) : null,
      p_kind: $("quizKind").value, p_show_answer_count: $("quizShowCount").checked,
      p_graded: $("quizGraded").checked, p_scoring: $("quizScoring").value, p_total_points: Number($("quizTotal").value) || 20,
      p_per_student_count: perStudent, p_show_on_projector: $("quizProjector").checked,
      p_pace: $("quizPace").value, p_ask_variant: $("quizVariant").checked });
    toast(perStudent ? `Quiz created: ${perStudent} question(s) per student, drawn from ${ids.length}.` : `Quiz created with ${ids.length} question(s).`, "ok");
    $("quizTitle").value = "";
    picked = [];
    await loadQuizzes();
    $("quizSelect").value = $("quizSelect").options[$("quizSelect").options.length - 1].value;
  } catch (e) { toast(e.message, "error"); }
};

let quizList = [];
const currentQuiz = () => (live && live.quiz ? live.quiz.id : $("quizSelect").value);
$("openBtn").onclick = async () => {
  if (!$("quizSelect").value) { toast("Create or choose a quiz first.", "error"); return; }
  try { quizList = await rpc("t_list_quizzes", { p_session: sessionId }); } catch (e) { /* keep the last list */ }
  const chosen = quizList.find((x) => x.id === $("quizSelect").value);
  const inLobby = live && live.quiz && live.quiz.id === $("quizSelect").value && live.quiz.phase === "lobby";
  if (chosen && chosen.status === "finished") { toast("This quiz is finished. To run it again: ↺ Reset (answers erased) or ⧉ Duplicate (new quiz), below.", "error"); return; }
  if (chosen && chosen.status === "running" && !inLobby) {
    toast("This quiz has already started: the rules step is over. Use 'Show the quiz' to bring the phones back, or ↺ Reset it to start again.", "error");
    return;
  }
  if (questionRunning() && !confirm("A question is running. Leave it and show the rules of the selected quiz?")) return;
  act("t_quiz_open", { p_quiz: $("quizSelect").value }, chosen && chosen.pace === "self"
    ? "Self-paced test OPEN: students see every question and answer at their own pace. Click Finish quiz to close it."
    : "Rules shown: phones update within 3 seconds. Wait until most students are ready (count below), then click 2. Start question 1.");
};
$("startBtn").onclick = () => {
  const q = live && live.quiz;
  const id = q && q.phase === "lobby" ? q.id : $("quizSelect").value;
  if (!id) { toast("Create or choose a quiz first.", "error"); return; }
  const msg = q && q.phase === "lobby" ? `Start question 1 now? ${q.ready} student(s) ready out of ${live.present} present.`
    : "Start this quiz now WITHOUT showing the rules first?";
  if (!confirm(msg)) return;
  act("t_quiz_start", { p_quiz: id });
};
// ----- manage the selected quiz: rename, duplicate, reset, delete
function selectedQuiz() {
  const id = $("quizSelect").value;
  if (!id) { toast("Create or choose a quiz first.", "error"); return null; }
  return quizList.find((x) => x.id === id) || { id, title: $("quizSelect").selectedOptions[0].textContent };
}
async function afterQuizChange(message, selectId) {
  if (channel) channel.ping();
  await loadQuizzes();
  if (selectId && [...$("quizSelect").options].some((o) => o.value === selectId)) $("quizSelect").value = selectId;
  await refreshLive();
  toast(message, "ok");
}
$("quizRenameBtn").onclick = async () => {
  const q = selectedQuiz(); if (!q) return;
  const title = prompt("New title of the quiz:", q.title || "");
  if (title === null || !title.trim()) return;
  try { await rpc("t_quiz_rename", { p_quiz: q.id, p_title: title.trim() }); await afterQuizChange("Quiz renamed.", q.id); }
  catch (e) { toast(e.message, "error"); }
};
$("quizDupBtn").onclick = async () => {
  const q = selectedQuiz(); if (!q) return;
  const title = prompt("Title of the copy (same questions and settings, never run):", (q.title || "Quiz") + " (2)");
  if (title === null) return;
  try {
    const id = await rpc("t_quiz_duplicate", { p_quiz: q.id, p_title: title.trim() });
    await afterQuizChange("Copy created and selected. Click 1. Show the rules to run it.", id);
  } catch (e) { toast(e.message, "error"); }
};
$("quizResetBtn").onclick = async () => {
  const q = selectedQuiz(); if (!q) return;
  if (!confirm(`Reset "${q.title}"?\nAll its answers and marks are ERASED and the quiz goes back to the start (never run).`)) return;
  try { await rpc("t_quiz_reset", { p_quiz: q.id }); await afterQuizChange("Quiz reset: you can run it again from the rules.", q.id); }
  catch (e) { toast(e.message, "error"); }
};
// Results of the selected quiz on the projector (any finished quiz of the session, even an old one).
$("quizResultsBtn").onclick = async () => {
  const q = selectedQuiz(); if (!q) return;
  if (q.status !== "finished") { toast("This quiz is not finished: its results do not exist yet.", "error"); return; }
  const showing = live && live.quiz && live.quiz.id === q.id && live.quiz.results_on_projector;
  if (!showing && !projectorAlive()) openProjector(true);
  await act("t_quiz_show_results", { p_quiz: q.id, p_show: !showing }, showing ? "Results hidden from the projector." : "Results shown on the projector.");
};
$("quizDeleteBtn").onclick = async () => {
  const q = selectedQuiz(); if (!q) return;
  if (!confirm(`DELETE "${q.title}"?\nThe quiz and all its answers and marks are deleted for good.`)) return;
  try { await rpc("t_quiz_delete", { p_quiz: q.id }); await afterQuizChange("Quiz deleted."); }
  catch (e) { toast(e.message, "error"); }
};
$("revealBtn").onclick = () => act("t_quiz_reveal", { p_quiz: currentQuiz() });
$("nextBtn").onclick = () => {
  const q = live && live.quiz;
  if (q && q.is_last && q.pace !== "self") {
    if (!confirm("This was the last question. Finish the quiz?")) return;
    act("t_quiz_finish", { p_quiz: q.id }, "Quiz finished.");
    return;
  }
  act("t_quiz_next", { p_quiz: currentQuiz() });
};
$("addTimeBtn").onclick = () => act("t_quiz_add_time", { p_quiz: currentQuiz(), p_seconds: Number($("addTimeSel").value) },
  `+${$("addTimeSel").value} s added to the current question.`);
$("finishBtn").onclick = () => { if (confirm("Finish the quiz now?")) act("t_quiz_finish", { p_quiz: currentQuiz() }); };

// ------------------------------------------------------------------ attendance list
async function refreshAttendance() {
  if (!sessionId) return;
  let list;
  try { list = await rpc("t_attendance_list", { p_session: sessionId }); } catch (e) { return; }
  lastAttendance = list;
  updateDrawInfo();
  if (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.student) return; // user is editing
  const opts = ["", "present", "late", "absent", "excused"];
  // the distance is measured to the median of the class: it only means something with at least 3 positions
  const enoughPositions = list.filter((r) => r.located).length >= 3;
  const place = (r) => {
    if (!checkLocation || !r.status || r.method === "manual") return "";
    if (!r.located) return '<span class="badge no">no position</span>';
    if (r.distance == null) return "";
    const d = r.distance >= 1000 ? (r.distance / 1000).toFixed(1) + " km" : r.distance + " m";
    return enoughPositions && r.distance > (CONFIG.farFromRoomM || 300) ? `<span class="far">📍 ${d} away</span>` : `<span class="muted">📍 ${d}</span>`;
  };
  const term = norm($("attSearch").value);
  const shown = term ? list.filter((r) => norm(r.name + " " + r.matricule).includes(term)) : list;
  const far = enoughPositions ? list.filter((r) => checkLocation && r.distance > (CONFIG.farFromRoomM || 300)).length : 0;
  $("attendanceTable").innerHTML = (far ? `<p class="far">⚠ ${far} student(s) checked in far from the rest of the class.</p>` : "") +
    `<table><tr><th>Name</th><th>Matricule</th><th>Status</th><th></th>${checkLocation ? "<th>Position</th>" : ""}<th>Bonus ${SESSION_KIND[live && live.session.kind] || ""}</th></tr>` + shown.map((r) =>
    `<tr><td><button class="linklike" data-profile="${r.student_id}">${esc(r.name)}</button> ${r.official ? "" : '<span class="badge no">not in official list</span>'}</td><td>${esc(r.matricule)}</td>
     <td><select data-student="${r.student_id}" style="width:auto">${opts.map((o) => `<option value="${o || "none"}" ${(r.status || "") === o ? "selected" : ""}>${o || "-"}</option>`).join("")}</select></td>
     <td class="muted">${r.method === "manual" ? "manual" : r.at ? new Date(r.at).toLocaleTimeString() : ""}</td>${checkLocation ? `<td>${place(r)}</td>` : ""}
     <td class="bonus-cell"><button class="small secondary" data-bonus="${r.student_id}" data-pts="-0.25">−</button>
       <strong>${Number(r.bonus) ? "+" + Number(r.bonus) : "0"}</strong>
       <button class="small green" data-bonus="${r.student_id}" data-pts="0.25">+0.25</button></td></tr>`).join("") + `</table>`;
  $("attendanceTable").querySelectorAll("[data-bonus]").forEach((b) => b.onclick = async () => {
    try {
      const total = await rpc("t_add_bonus", { p_session: sessionId, p_student: b.dataset.bonus, p_points: Number(b.dataset.pts) });
      toast(`Bonus ${SESSION_KIND[live && live.session.kind] || ""}: ${Number(total)} point(s) in total for this student.`, "ok");
      refreshAttendance();
    } catch (e) { toast(e.message, "error"); }
  });
  $("attendanceTable").querySelectorAll("select").forEach((sel) => sel.onchange = async () => {
    await act("t_set_attendance", { p_session: sessionId, p_student: sel.dataset.student, p_status: sel.value });
    sel.blur();
    refreshAttendance();
  });
}

$("attSearch").oninput = () => refreshAttendance();

// ------------------------------------------------------------------ collapsible cards (remembered in this browser)
function collapseKey() { return "cp_collapsed"; }
function collapsedSet() { try { return new Set(JSON.parse(localStorage.getItem(collapseKey()) || "[]")); } catch (e) { return new Set(); } }
function setupCollapsible() {
  const closed = collapsedSet();
  document.querySelectorAll("main .card:not(.nocollapse)").forEach((card) => {
    const head = card.firstElementChild;
    if (!head || !/^H[23]$/.test(head.tagName)) return;
    const section = card.closest("section");
    const key = (section ? section.id : "") + "|" + head.textContent.trim();
    card.classList.add("collapsible");
    card.classList.toggle("collapsed", closed.has(key));
    head.title = "Click to fold / unfold";
    head.onclick = () => {
      const set = collapsedSet();
      const now = card.classList.toggle("collapsed");
      if (now) set.add(key); else set.delete(key);
      try { localStorage.setItem(collapseKey(), JSON.stringify([...set])); } catch (e) { /* ignore */ }
    };
  });
}
setupCollapsible();

// ------------------------------------------------------------------ registration settings of the class
function renderRegistration() {
  const c = classInfo[classId];
  if (!c || isAssistant()) return;
  $("regSessionBtn").textContent = c.reg_session ? "✓ Open" : "✕ Closed";
  $("regSessionBtn").className = "small " + (c.reg_session ? "green" : "red");
  $("regOpenBtn").textContent = c.reg_open ? "✓ Open" : "✕ Closed";
  $("regOpenBtn").className = "small " + (c.reg_open ? "green" : "secondary");
  const show = c.reg_open && c.reg_code;
  $("regLinkBox").classList.toggle("hidden", !show);
  if (show) {
    const url = siteUrl("index.html").replace(/index\.html$/, "");
    $("regLink").textContent = url; $("regLink").href = url;
    const qr = qrcode(0, "M"); qr.addData(url); qr.make();
    $("regQr").innerHTML = qr.createSvgTag({ cellSize: 3, margin: 0 });
  }
}
async function setRegistration(session, open) {
  try {
    const r = await rpc("t_set_registration", { p_class: classId, p_session: session, p_open: open });
    Object.assign(classInfo[classId], r);
    renderRegistration();
    toast("Registration settings saved.", "ok");
  } catch (e) { toast(e.message, "error"); }
}
$("regSessionBtn").onclick = () => {
  const c = classInfo[classId];
  if (c.reg_session && !confirm("Stop the registration of new phones during the sessions?\nStudents already registered are not affected.")) return;
  setRegistration(!c.reg_session, null);
};
$("regOpenBtn").onclick = () => setRegistration(null, !classInfo[classId].reg_open);
$("regPageBtn").onclick = () => window.open("join.html?reg=" + classInfo[classId].reg_code, "classpulse_registration");

// ------------------------------------------------------------------ students
// People who tried to register and are not in the official list.
async function loadAttempts() {
  let list = [];
  try { list = await rpc("t_reg_attempts"); } catch (e) { return; }
  $("attemptBadge").textContent = list.length; $("attemptBadge").classList.toggle("hidden", !list.length);
  $("attemptCount").textContent = list.length || "";
  $("attemptsCard").classList.toggle("hidden", !list.length);
  $("attemptsTable").innerHTML = `<table><tr><th>Matricule</th><th>Last name</th><th>First name</th><th>Tried</th><th>When</th><th></th></tr>` + list.map((a) =>
    `<tr><td>${esc(a.matricule)}</td><td>${esc(a.last_name)}</td><td>${esc(a.first_name)}</td><td>${a.class_id ? "in a session of " + esc(a.class_name) : "from the home page"}</td>
     <td>${new Date(a.at).toLocaleString()}</td>
     <td style="white-space:nowrap">${classId ? `<button class="small green teacher-only" data-attadd="${a.id}">+ Add to ${esc(classNames[classId] || "this class")}</button>` : ""}
       <button class="small secondary" data-attdis="${a.id}">Dismiss</button></td></tr>`).join("") + `</table>`;
  $("attemptsTable").querySelectorAll("[data-attadd]").forEach((b) => b.onclick = async () => {
    try { await rpc("t_handle_attempt", { p_id: Number(b.dataset.attadd), p_class: classId }); toast("Added to the official list. The student can register now.", "ok"); loadStudents(); }
    catch (e) { toast(e.message, "error"); }
  });
  $("attemptsTable").querySelectorAll("[data-attdis]").forEach((b) => b.onclick = async () => {
    try { await rpc("t_handle_attempt", { p_id: Number(b.dataset.attdis), p_class: null }); loadAttempts(); }
    catch (e) { toast(e.message, "error"); }
  });
}

async function loadStudents() {
  renderRegistration();
  loadAttempts();
  if (!classId) { $("studentsTable").innerHTML = ""; return; }
  const all = await rpc("t_list_students", { p_class: classId });
  const f = norm($("studentSearch").value);
  const list = all.filter((s) => !f || norm(`${s.matricule} ${s.last_name} ${s.first_name}`).includes(f));
  $("studentsTable").innerHTML = `<p class="muted">${all.length} students${f ? ` · ${list.length} shown` : ""} · ${list.filter((s) => s.registered).length} registered a phone</p>
    <table><tr><th>Matricule</th><th>Last name</th><th>First name</th><th>Official list</th><th>Phone</th><th></th></tr>` + list.map((s) =>
    `<tr data-id="${s.id}"><td class="c-mat">${esc(s.matricule)}</td><td class="c-last"><button class="linklike" data-profile="${s.id}">${esc(s.last_name)}</button></td><td class="c-first">${esc(s.first_name)}</td>
     <td>${isAssistant() ? (s.official ? "yes" : '<span class="badge no">no</span>') : `<button class="small ${s.official ? "green" : "red"}" data-official="${s.id}" data-val="${s.official ? 1 : 0}" title="Click to change">${s.official ? "✓ yes" : "✗ no"}</button>`}</td>
     <td>${s.registered ? "registered" : (s.has_pin ? "PIN only" : "-")}${s.reset_allowed ? ' <span class="badge info">new phone allowed</span>' : ""}</td>
     <td style="white-space:nowrap"><button class="small secondary teacher-only" data-edit="${s.id}" title="Correct the student number or the name">✏ Edit</button>
       <button class="small red teacher-only" data-del="${s.id}">Delete</button>
       ${s.registered ? `<button class="small secondary" data-reset="${s.id}">Allow a new phone</button>` : ""}
       ${s.registered || s.has_pin ? `<button class="small red" data-resetall="${s.id}" title="Erase the PIN and the phone of this student: he registers again">Reset PIN</button>` : ""}</td></tr>`).join("") + `</table>`;
  $("studentsTable").querySelectorAll("[data-resetall]").forEach((b) => b.onclick = async () => {
    const tr = b.closest("tr");
    const name = tr.querySelector(".c-last").textContent.trim() + " " + tr.querySelector(".c-first").textContent;
    if (!confirm(`${name}: erase the PIN and the registered phone?\nUse it when somebody else registered with this student number, or when the PIN is forgotten.\nAttendance and answers are kept. The student registers again.`)) return;
    try { await rpc("t_reset_student", { p_student: b.dataset.resetall }); toast("PIN and phone erased. The student can register again.", "ok"); loadStudents(); }
    catch (e) { toast(e.message, "error"); }
  });
  $("studentsTable").querySelectorAll("[data-official]").forEach((b) => b.onclick = async () => {
    const to = b.dataset.val !== "1";
    const tr = b.closest("tr");
    const name = tr.querySelector(".c-last").textContent.trim() + " " + tr.querySelector(".c-first").textContent;
    if (!confirm(`${name}: ${to ? "IN the official list" : "NOT in the official list"}?`)) return;
    try { await rpc("t_set_official", { p_student: b.dataset.official, p_official: to }); toast("Official list updated.", "ok"); loadStudents(); }
    catch (e) { toast(e.message, "error"); }
  });
  $("studentsTable").querySelectorAll("[data-reset]").forEach((b) => b.onclick = async () => {
    if (!confirm("Allow this student to register a new phone? The old phone will stop working.")) return;
    try { await rpc("t_allow_new_device", { p_student: b.dataset.reset }); toast("The student can now log in on a new phone with his PIN.", "ok"); loadStudents(); }
    catch (e) { toast(e.message, "error"); }
  });
  $("studentsTable").querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    const tr = b.closest("tr");
    const name = tr.querySelector(".c-last").textContent.trim() + " " + tr.querySelector(".c-first").textContent;
    if (!confirm(`Delete ${name} (${tr.querySelector(".c-mat").textContent}) from this class?\nHis attendance and quiz answers are deleted too.`)) return;
    try { await rpc("t_delete_student", { p_student: b.dataset.del }); toast("Student deleted.", "ok"); loadStudents(); }
    catch (e) { toast(e.message, "error"); }
  });
  $("studentsTable").querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => {
    const tr = b.closest("tr");
    const cell = (cls) => tr.querySelector(cls);
    const val = (cls) => esc(cell(cls).textContent);
    cell(".c-mat").innerHTML = `<input class="e-mat" value="${val(".c-mat")}" style="width:140px">`;
    cell(".c-last").innerHTML = `<input class="e-last" value="${esc(cell(".c-last").textContent.trim())}" style="width:160px">`;
    cell(".c-first").innerHTML = `<input class="e-first" value="${val(".c-first")}" style="width:160px">`;
    b.textContent = "Save"; b.className = "small green";
    b.onclick = async () => {
      try {
        await rpc("t_update_student", { p_student: b.dataset.edit, p_matricule: tr.querySelector(".e-mat").value,
          p_last_name: tr.querySelector(".e-last").value, p_first_name: tr.querySelector(".e-first").value });
        toast("Student updated.", "ok"); loadStudents();
      } catch (e) { toast(e.message, "error"); }
    };
  });
}

$("addStudentBtn").onclick = async () => {
  if (!classId) { toast("Choose a class first.", "error"); return; }
  try {
    await rpc("t_add_student", { p_class: classId, p_matricule: $("addMat").value, p_last_name: $("addLast").value, p_first_name: $("addFirst").value });
    $("addMat").value = ""; $("addLast").value = ""; $("addFirst").value = "";
    toast(`Student added to ${classNames[classId]}.`, "ok"); loadStudents();
  } catch (e) { toast(e.message, "error"); }
};

// Student list import: choose the sheet and the columns, preview, then import.
let studentBook = null;

function columnLabel(i) { let s = ""; i += 1; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

function fillColumnSelect(id, headers, selected, allowNone) {
  const opts = allowNone ? [`<option value="-1">(none)</option>`] : [];
  headers.forEach((h, i) => opts.push(`<option value="${i}" ${i === selected ? "selected" : ""}>${columnLabel(i)} - ${esc(h || "(empty)")}</option>`));
  $(id).innerHTML = opts.join("");
  if (selected === undefined || selected < 0) $(id).value = allowNone ? "-1" : "0";
}

function currentGrid() { return studentBook.sheets[$("stSheet").value] || []; }

function setupColumns(autoDetect) {
  const grid = currentGrid();
  let headerRow = Math.max(0, (parseInt($("stHeader").value, 10) || 1) - 1);
  let cols = {};
  if (autoDetect) { const d = detectStudentColumns(grid); headerRow = d.headerRow; cols = d.cols; $("stHeader").value = headerRow + 1; }
  else { grid[headerRow]?.forEach((cell, c) => { const role = studentHeaderRole(cell); if (role && cols[role] === undefined) cols[role] = c; }); }
  const width = Math.max(0, ...grid.slice(0, 50).map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => (grid[headerRow] || [])[i] || "");
  fillColumnSelect("stColMat", headers, cols.matricule, false);
  fillColumnSelect("stColLast", headers, cols.last_name, true);
  fillColumnSelect("stColFirst", headers, cols.first_name, true);
  previewStudents();
}

function mappedStudents() {
  return studentsFromGrid(currentGrid(), Math.max(0, (parseInt($("stHeader").value, 10) || 1) - 1),
    parseInt($("stColMat").value, 10), parseInt($("stColLast").value, 10), parseInt($("stColFirst").value, 10));
}

function previewStudents() {
  const list = mappedStudents();
  $("stPreview").innerHTML = `<p><strong>${list.length}</strong> students found. First lines:</p>` +
    `<table><tr><th>Matricule</th><th>Last name</th><th>First name</th></tr>` +
    list.slice(0, 5).map((s) => `<tr><td>${esc(s.matricule)}</td><td>${esc(s.last_name)}</td><td>${esc(s.first_name)}</td></tr>`).join("") + `</table>`;
}

$("studentsFile").onchange = async () => {
  const file = $("studentsFile").files[0];
  $("studentsMapping").classList.add("hidden");
  if (!file) return;
  try {
    studentBook = await readWorkbookGrid(file);
    $("stSheet").innerHTML = studentBook.names.map((n) => `<option value="${esc(n)}">${esc(n)} (${studentBook.sheets[n].length} lines)</option>`).join("");
    $("studentsMapping").classList.remove("hidden");
    setupColumns(true);
  } catch (e) { toast("Cannot read this file: " + e.message, "error"); }
};
$("stSheet").onchange = () => setupColumns(true);
$("stHeader").onchange = () => setupColumns(false);
["stColMat", "stColLast", "stColFirst"].forEach((id) => { $(id).onchange = previewStudents; });

$("importStudentsBtn").onclick = async () => {
  if (!classId) { toast("Choose a class first.", "error"); return; }
  if (!studentBook) { toast("Choose a file.", "error"); return; }
  const rows = mappedStudents();
  if (rows.length === 0) { toast("No student found: check the sheet, the header line and the columns.", "error"); return; }
  const replace = $("stReplace").checked;
  if (!confirm(`Import ${rows.length} students from sheet "${$("stSheet").value}" into the class "${classNames[classId]}"?` +
    (replace ? "\n\nThis list REPLACES the previous one: students not in it lose the 'official' mark (they are not deleted)." : ""))) return;
  try {
    const r = await rpc("t_import_students", { p_class: classId, p_rows: rows, p_replace: replace });
    toast(`${r.added} added, ${r.updated} updated` + (replace ? `, ${r.removed} no longer official.` : "."), "ok");
    loadStudents();
  } catch (e) { toast(e.message, "error"); }
};

// ------------------------------------------------------------------ questions
async function loadQuestions(showModule) {
  allQuestions = await rpc("t_list_questions", { p_module: null, p_class: classId });
  const modules = [...new Set(allQuestions.map((q) => q.module))].sort();
  $("moduleList").innerHTML = modules.map((m) => `<option value="${esc(m)}">`).join("");
  const current = showModule !== undefined ? showModule : $("qModuleFilter").value;
  $("qModuleFilter").innerHTML = `<option value="">All modules (${allQuestions.length})</option>` +
    modules.map((m) => `<option value="${esc(m)}">${esc(m)} (${allQuestions.filter((q) => q.module === m).length})</option>`).join("");
  if (modules.includes(current)) $("qModuleFilter").value = current;
  renderQuestionsTable();
}

function renderQuestionsTable() {
  const m = $("qModuleFilter").value;
  const f = norm($("questionSearch").value);
  const list = allQuestions.filter((q) => (!m || q.module === m) && (!f || norm(`${q.text} ${q.ref} ${q.chapter} ${q.options.join(" ")}`).includes(f)));
  $("questionsTable").innerHTML = `<p class="muted">${list.length} questions shown</p><table><tr><th></th><th>Module</th><th>Chapter</th><th>Ref</th><th>Question</th><th>Correct</th><th>Pts</th><th>Time</th></tr>` +
    list.map((q) => `<tr><td><input type="checkbox" class="qdel" value="${q.id}" style="width:auto"><br><button class="small secondary" data-qedit="${q.id}">Edit</button></td><td>${esc(q.module)}</td><td>${esc(q.chapter)}</td><td>${esc(q.ref)}</td><td>${esc(q.text)}<br><span class="muted">${q.qtype === "number" ? "numeric answer" + (q.unit ? " (" + esc(q.unit) + ")" : "") : q.options.map((o, i) => LETTERS[i] + ". " + esc(o)).join(" · ")}</span></td>
      <td>${q.qtype === "number" ? `<span class="kind">🔢 ${esc(numSpecText(q))}</span>` : q.correct.length ? q.correct.map((c) => LETTERS[c]).join(",") : '<span class="kind">survey</span>'}</td><td>${q.points}</td><td>${q.time_limit} s</td></tr>`).join("") + `</table>`;
}
$("questionSearch").oninput = renderQuestionsTable;

$("qModuleFilter").onchange = renderQuestionsTable;

// Backup of the question bank: one sheet per module, same columns as the import template (re-importable).
$("exportBankBtn").onclick = async () => {
  const all = await rpc("t_list_questions", { p_module: null, p_class: classId });
  if (all.length === 0) { toast("The bank is empty.", "error"); return; }
  const wb = XLSX.utils.book_new();
  [...new Set(all.map((q) => q.module))].sort().forEach((m) => {
    const rows = [["ref", "chapter", "question", "A", "B", "C", "D", "E", "F", "G", "H", "correct", "points", "time_s", "type", "answer", "tolerance", "unit"]];
    all.filter((q) => q.module === m).forEach((q) => rows.push([q.ref, q.chapter, q.text,
      ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => q.options[i] || ""), q.correct.map((c) => LETTERS[c]).join(","), Number(q.points), q.time_limit,
      q.qtype === "number" ? "number" : "", q.qtype === "number" ? numSpecText(q, true) : "", q.qtype === "number" ? Number(q.tolerance) : "", q.unit || ""]));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [8, 10, 60, 20, 20, 20, 20, 20, 20, 20, 20, 8, 7, 7, 8, 30, 9, 8].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, (m || "no module").replace(/[\\/?*\[\]:]/g, "_").slice(0, 31));
  });
  XLSX.writeFile(wb, `ClassPulse_question_bank_${new Date().toISOString().slice(0, 10)}.xlsx`);
};

// ----- editing one question
let editingQuestion = null;
$("questionsTable").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-qedit]");
  if (b) openQuestionEditor(allQuestions.find((q) => q.id === b.dataset.qedit));
});
function openQuestionEditor(q) {
  if (q.qtype === "number") { toast("Numeric questions are edited in the Excel file, then imported again (same ref = replaced).", "error"); return; }
  editingQuestion = q;
  $("qeRef").textContent = `${q.module} · ${q.ref}`;
  $("qeChapter").value = q.chapter; $("qeText").value = q.text;
  $("qePoints").value = q.points; $("qeTime").value = q.time_limit;
  $("qeOptions").innerHTML = [..."ABCDEFGH"].map((L, i) => `<div class="row" style="gap:8px;margin-top:6px;align-items:center">
      <label style="margin:0;width:70px"><input type="checkbox" class="qeCorrect" ${q.correct.includes(i) ? "checked" : ""} style="width:auto"> ${L}</label>
      <input class="qeOpt" value="${esc(q.options[i] || "")}"></div>`).join("");
  $("questionEditor").classList.remove("hidden");
  $("questionEditor").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("qeCancel").onclick = () => { $("questionEditor").classList.add("hidden"); editingQuestion = null; };
$("qeSave").onclick = async () => {
  const opts = [...document.querySelectorAll(".qeOpt")].map((i) => i.value.trim());
  const ticks = [...document.querySelectorAll(".qeCorrect")].map((c) => c.checked);
  const options = [], correct = [];
  opts.forEach((o, i) => { if (o) { if (ticks[i]) correct.push(options.length); options.push(o); } });
  if (options.length < 2) { toast("At least 2 options.", "error"); return; }
  if (correct.length === 0 && !confirm("No correct option is ticked: this becomes a SURVEY question (not graded). Continue?")) return;
  try {
    await rpc("t_update_question", { p_id: editingQuestion.id, p_row: { chapter: $("qeChapter").value.trim(), text: $("qeText").value,
      options, correct, points: Number($("qePoints").value), time_limit: Number($("qeTime").value) } });
    toast("Question saved.", "ok");
    $("questionEditor").classList.add("hidden");
    loadQuestions();
  } catch (e) { toast(e.message, "error"); }
};
$("qSelectAllBtn").onclick = () => {
  const boxes = [...document.querySelectorAll(".qdel")];
  const tick = boxes.some((b) => !b.checked);
  boxes.forEach((b) => { b.checked = tick; });
};
$("qDeleteBtn").onclick = async () => {
  const ids = [...document.querySelectorAll(".qdel:checked")].map((b) => b.value);
  if (ids.length === 0) { toast("Tick the questions to delete first.", "error"); return; }
  if (!confirm(`Delete ${ids.length} question(s) from the bank?\nQuestions already used in a quiz are only hidden, so past marks are kept.`)) return;
  try {
    const r = await rpc("t_delete_questions", { p_ids: ids });
    toast(`${r.deleted} deleted` + (r.hidden ? `, ${r.hidden} hidden (already used in a quiz)` : "") + ".", "ok");
    allQuestions = [];
    loadQuestions();
  } catch (e) { toast(e.message, "error"); }
};

$("importQuestionsBtn").onclick = async () => {
  const file = $("questionsFile").files[0];
  const module = $("moduleName").value.trim();
  if (!file || !module) { toast("Type the module name and choose a file.", "error"); return; }
  const btn = $("importQuestionsBtn");
  btn.disabled = true;
  try {
    const { questions, problems, surveys } = parseQuestions(await readSheet(file));
    if (problems.length) { alert("Problems in the file:\n" + problems.join("\n")); return; }
    if (surveys.length && !confirm(`${surveys.length} question(s) have no correct answer (${surveys.slice(0, 6).join(", ")}${surveys.length > 6 ? "..." : ""}).\n` +
      "They will be imported as SURVEY questions (opinions, not graded). Continue?")) return;
    const r = await rpc("t_import_questions", { p_module: module, p_rows: questions });
    toast(`Module "${module}": ${r.added} new question(s), ${r.updated} already in the bank (updated, not duplicated).`, "ok");
    $("questionsFile").value = "";
    loadQuestions(module);
  } catch (e) { toast(e.message, "error"); }
  finally { btn.disabled = false; }
};

// ------------------------------------------------------------------ resources
const BUCKET = "classpulse";
let myResources = [];

async function loadResources() {
  try { myResources = await rpc("t_list_resources"); } catch (e) { myResources = []; }
  fillPushList();
  if (!$("resourcesTable")) return;
  const f = norm($("resourceSearch").value);
  const shown = myResources.filter((r) => !f || norm(`${r.title} ${r.module} ${r.url || ""} ${r.mime || ""}`).includes(f));
  $("resourcesTable").innerHTML = `<p class="muted">${myResources.length} resource(s)${f ? ` · ${shown.length} shown` : ""}</p><table><tr><th>Module</th><th>Title</th><th>Type</th><th></th></tr>` +
    shown.map((r) => `<tr><td>${esc(r.module)}</td><td>${esc(r.title)}</td>
      <td>${r.kind === "link" ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">link</a>` : `file · ${esc(r.mime || "")} · ${(r.size_bytes / 1048576).toFixed(1)} MB`}</td>
      <td>${r.kind === "file" ? `<button class="small secondary" data-view="${r.id}">View</button> ` : ""}<button class="small red" data-del="${r.id}">Delete</button></td></tr>`).join("") + `</table>`;
  $("resourcesTable").querySelectorAll("[data-del]").forEach((b) => b.onclick = async () => {
    if (!confirm("Delete this resource?")) return;
    try {
      const path = await rpc("t_delete_resource", { p_id: b.dataset.del });
      if (path) await db.storage.from(BUCKET).remove([path]);
      toast("Deleted.", "ok"); loadResources();
    } catch (e) { toast(e.message, "error"); }
  });
  $("resourcesTable").querySelectorAll("[data-view]").forEach((b) => b.onclick = async () => {
    const r = myResources.find((x) => x.id === b.dataset.view);
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(r.storage_path, 600);
    if (error) { toast(error.message, "error"); return; }
    window.open(data.signedUrl, "_blank");
  });
}

// ------------------------------------------------------------------ demos
// Demos are published from this page: their files are stored in the database and served by the service worker
// at <site>/d/<prefix>/... only to the teacher and to the students checked in a session where the demo was pushed.
// (Old kinds still supported: demos listed in config.js, demos in the public Storage bucket "demos".)
const DEMO_BUCKET = "demos";
let allDemos = [];
const siteBase = () => new URL("./", location.href).href;
const demoPage = (prefix, page) => new URL(`d/${prefix}/${page}`, siteBase()).href;

// The teacher's browser installs the service worker at once (the phones do it on their first visit).
if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw-demos.js", { scope: "./d/" }).catch(() => {});

async function loadDemos() {
  let published = [];
  try { published = await rpc("t_list_demos"); } catch (e) { published = []; }
  allDemos = CONFIG.links.map((l) => ({ kind: "site", title: l.label, module: l.module || guessModule(l.label), description: l.description || "",
      url: new URL(l.url, siteBase()).href, screen: l.screen ? new URL(l.screen, siteBase()).href : null }))
    .concat(published.map((d) => ({ kind: d.mine ? "mine" : "colleague", id: d.id, title: d.title, module: d.module, description: d.description,
      url: demoPage(d.prefix, d.entry), screen: d.screen ? demoPage(d.prefix, d.screen) : null, shared: d.shared, files: d.files, in_db: d.in_db })));
  const modules = [...new Set(allDemos.map((d) => d.module || "Other"))].sort();
  const keep = $("demoModule").value || localStorage.getItem("cp_demo_module") || "";
  $("demoModule").innerHTML = `<option value="">All modules</option>` + modules.map((m) => `<option ${m === keep ? "selected" : ""}>${esc(m)}</option>`).join("");
  $("demoModuleList").innerHTML = modules.map((m) => `<option value="${esc(m)}">`).join("");
  renderDemos();
  fillPushList();
}
function guessModule(label) { return /^IoT/i.test(label) ? "IoT" : /^Edge/i.test(label) ? "Edge & Cloud" : "Other"; }

function renderDemos() {
  const m = $("demoModule").value, f = norm($("demoSearch").value);
  const list = allDemos.filter((d) => (!m || (d.module || "Other") === m) && (!f || norm(`${d.title} ${d.description} ${d.module}`).includes(f)));
  const groups = [...new Set(list.map((d) => d.module || "Other"))].sort();
  const badge = { site: '<span class="badge site">site</span>', mine: '<span class="badge mine">mine</span>', colleague: '<span class="badge colleague">colleague</span>' };
  $("demosList").innerHTML = list.length === 0 ? `<p class="muted">No demo${f || m ? " for this search" : ""}.</p>` : groups.map((g) => `<div class="demo-group"><h3>${esc(g)}</h3><div class="demo-grid">` +
    list.filter((d) => (d.module || "Other") === g).map((d) => `<div class="demo-card">
      <div><strong>${esc(d.title)}</strong> ${badge[d.kind]}${d.kind === "mine" && !d.shared ? ' <span class="badge closed">private</span>' : ""}</div>
      <div class="desc">${esc(d.description || "")}</div>
      <div class="actions">
        ${d.screen ? `<a href="${esc(d.screen)}" target="classpulse_demo_screen"><button class="orange">Big screen</button></a>` : ""}
        <a href="${esc(d.url)}" target="_blank" rel="noopener"><button class="secondary">Phone page</button></a>
        <button class="green" data-push-url="${esc(d.url)}" data-push-label="${esc(d.title)}">Push to phones</button>
        ${d.kind === "mine" ? `<button class="red" data-demo-del="${d.id}">Delete</button>` : ""}
      </div></div>`).join("") + `</div></div>`).join("");
  $("demosList").querySelectorAll("[data-push-url]").forEach((b) => b.onclick = () => pushLink({ label: b.dataset.pushLabel, url: b.dataset.pushUrl }));
  $("demosList").querySelectorAll("[data-demo-del]").forEach((b) => b.onclick = () => deleteDemo(b.dataset.demoDel));
}
$("demoModule").onchange = () => { localStorage.setItem("cp_demo_module", $("demoModule").value); renderDemos(); };
$("demoSearch").oninput = renderDemos;
$("demoPublishToggle").onclick = () => $("demoPublish").classList.toggle("hidden");

// ----- publishing a folder
let publishFiles = [];   // [{rel, file}]
$("dpFolder").onchange = () => {
  const files = [...$("dpFolder").files];
  // "myDemo/js/app.js" -> "js/app.js" (the chosen folder itself is not part of the address)
  publishFiles = files.map((f) => ({ rel: (f.webkitRelativePath || f.name).split("/").slice(1).join("/") || f.name, file: f }))
    .filter((x) => !x.rel.split("/").some((part) => part.startsWith(".")));   // no hidden files (.git, .DS_Store)
  const html = publishFiles.map((x) => x.rel).filter((r) => /\.html?$/i.test(r)).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  const total = publishFiles.reduce((t, x) => t + x.file.size, 0);
  $("dpFolderInfo").textContent = `${publishFiles.length} file(s), ${(total / 1048576).toFixed(1)} MB, ${html.length} page(s)`;
  $("dpEntry").innerHTML = html.map((h) => `<option ${h === "index.html" ? "selected" : ""}>${esc(h)}</option>`).join("");
  $("dpScreen").innerHTML = `<option value="">(none)</option>` + html.map((h) => `<option ${h === "dashboard.html" ? "selected" : ""}>${esc(h)}</option>`).join("");
  if (!$("dpTitle").value && files[0]) $("dpTitle").value = (files[0].webkitRelativePath || "").split("/")[0];
};

// A .zip of the demo folder (the only way to send a folder from a phone).
$("dpZip").onchange = async () => {
  const f = $("dpZip").files[0];
  if (!f) return;
  try {
    const zip = await JSZip.loadAsync(f);
    let entries = Object.values(zip.files).filter((e) => !e.dir && !e.name.split("/").some((part) => part.startsWith(".") || part === "__MACOSX"));
    // "myDemo/index.html" -> "index.html" when everything sits in one top folder
    const tops = new Set(entries.map((e) => e.name.split("/")[0]));
    const strip = tops.size === 1 && entries.every((e) => e.name.includes("/")) ? [...tops][0].length + 1 : 0;
    publishFiles = [];
    for (const e of entries) {
      const blob = await e.async("blob");
      publishFiles.push({ rel: e.name.slice(strip), file: new File([blob], e.name.split("/").pop()) });
    }
    $("dpFolder").value = "";
    describePublishFiles(f.name.replace(/\.zip$/i, ""));
  } catch (e) { toast("Cannot read this zip file: " + e.message, "error"); }
};
function describePublishFiles(defaultTitle) {
  const html = publishFiles.map((x) => x.rel).filter((r) => /\.html?$/i.test(r)).sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  const total = publishFiles.reduce((t, x) => t + x.file.size, 0);
  $("dpFolderInfo").textContent = `${publishFiles.length} file(s), ${(total / 1048576).toFixed(1)} MB, ${html.length} page(s)`;
  $("dpEntry").innerHTML = html.map((h) => `<option ${h === "index.html" ? "selected" : ""}>${esc(h)}</option>`).join("");
  $("dpScreen").innerHTML = `<option value="">(none)</option>` + html.map((h) => `<option ${h === "dashboard.html" ? "selected" : ""}>${esc(h)}</option>`).join("");
  if (!$("dpTitle").value && defaultTitle) $("dpTitle").value = defaultTitle;
}

$("dpPublish").onclick = async () => {
  const title = $("dpTitle").value.trim();
  if (!title) { toast("Give a title.", "error"); return; }
  if (publishFiles.length === 0) { toast("Choose the folder of the demo.", "error"); return; }
  if (!$("dpEntry").value) { toast("The folder has no HTML page.", "error"); return; }
  const bad = publishFiles.filter((x) => !/^[\w\-. ()/]+$/.test(x.rel)).map((x) => x.rel);
  if (bad.length) { toast("Rename these files (letters, digits, - _ . only): " + bad.slice(0, 4).join(", "), "error"); return; }
  const tooBig = publishFiles.filter((x) => x.file.size > CONFIG.maxFileMb * 1048576).map((x) => x.rel);
  if (tooBig.length) { toast(`Files above ${CONFIG.maxFileMb} MB: ` + tooBig.join(", "), "error"); return; }
  const total = publishFiles.reduce((t, x) => t + x.file.size, 0);
  if (total > 40 * 1048576) { toast("The demo is above 40 MB: too big for a protected demo.", "error"); return; }
  const heavy = publishFiles.filter((x) => x.file.size > 4 * 1048576).map((x) => x.rel);
  if (heavy.length) { toast("Files above 4 MB (videos, big images) cannot be stored: " + heavy.join(", "), "error"); return; }
  const btn = $("dpPublish"); btn.disabled = true;
  try {
    const { data: u } = await db.auth.getUser();
    const prefix = `${u.user.id}/${crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36)}`;
    // v14: the files go into the database (protected), not into a public place
    let done = 0;
    for (const x of publishFiles) {
      $("dpProgress").textContent = `Saving ${++done} / ${publishFiles.length}: ${x.rel}`;
      try { await rpc("t_demo_put_file", { p_prefix: prefix, p_path: x.rel, p_data: await readFileAs(x.file, "base64") }); }
      catch (e) { throw new Error(`${x.rel}: ${e.message}`); }
    }
    await rpc("t_add_demo", { p_title: title, p_module: $("dpModule").value.trim(), p_description: $("dpDescription").value.trim(), p_prefix: prefix,
      p_entry: $("dpEntry").value, p_screen: $("dpScreen").value || null, p_files: publishFiles.map((x) => x.rel), p_shared: $("dpShared").checked });
    toast(`"${title}" is saved. Students can open it only when you push it in a session where they are checked in.`, "ok");
    $("dpProgress").textContent = ""; $("dpTitle").value = ""; $("dpDescription").value = ""; $("dpFolder").value = ""; publishFiles = [];
    $("dpFolderInfo").textContent = ""; $("dpZip").value = ""; $("demoPublish").classList.add("hidden");
    await loadDemos();
  } catch (e) { toast("Publishing failed: " + e.message, "error"); $("dpProgress").textContent = ""; }
  finally { btn.disabled = false; }
};

async function deleteDemo(id) {
  const d = allDemos.find((x) => x.id === id);
  if (!confirm(`Delete the demo "${d.title}"? Its address will stop working for everybody.`)) return;
  try {
    const r = await rpc("t_delete_demo", { p_id: id });
    if (!d.in_db) {   // old demo, stored in the public bucket
      const paths = r.files.map((f) => `${r.prefix}/${f}`);
      for (let i = 0; i < paths.length; i += 100) await db.storage.from(DEMO_BUCKET).remove(paths.slice(i, i + 100));
    }
    toast("Demo deleted.", "ok");
    loadDemos();
  } catch (e) { toast(e.message, "error"); }
}

$("resLinkBtn").onclick = async () => {
  const title = $("resLinkTitle").value.trim(), url = $("resLinkUrl").value.trim();
  if (!title || !/^https?:\/\//i.test(url)) { toast("Give a title and an address starting with https://", "error"); return; }
  try {
    await rpc("t_add_resource", { p_title: title, p_kind: "link", p_url: url, p_storage_path: null, p_mime: null, p_size: null, p_module: $("resLinkModule").value.trim() });
    $("resLinkTitle").value = ""; $("resLinkUrl").value = "";
    toast("Link added.", "ok"); loadResources();
  } catch (e) { toast(e.message, "error"); }
};

$("resFileBtn").onclick = async () => {
  const file = $("resFile").files[0];
  const title = $("resFileTitle").value.trim() || (file && file.name);
  if (!file) { toast("Choose a file.", "error"); return; }
  if (file.size > CONFIG.maxFileMb * 1048576) { toast(`File too big (maximum ${CONFIG.maxFileMb} MB).`, "error"); return; }
  const btn = $("resFileBtn"); btn.disabled = true; btn.textContent = "Uploading...";
  try {
    const { data: u } = await db.auth.getUser();
    const safeName = file.name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_");
    const path = `${u.user.id}/${Date.now()}_${safeName}`;
    const { error } = await db.storage.from(BUCKET).upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
    if (error) throw error;
    await rpc("t_add_resource", { p_title: title, p_kind: "file", p_url: null, p_storage_path: path, p_mime: file.type || "", p_size: file.size, p_module: $("resFileModule").value.trim() });
    $("resFile").value = ""; $("resFileTitle").value = "";
    toast("File uploaded.", "ok"); loadResources();
  } catch (e) { toast("Upload failed: " + e.message, "error"); }
  finally { btn.disabled = false; btn.textContent = "Upload the file"; }
};

// ------------------------------------------------------------------ search helper
function norm(t) { return String(t || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim(); }
$("studentSearch").oninput = () => loadStudents();
$("resourceSearch").oninput = () => loadResources();

// ------------------------------------------------------------------ student profile
let profileData = null;
document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-profile]");
  if (b) openProfile(b.dataset.profile);
});
// ------------------------------------------------------------------ student space: private documents + documents of the class
const DOC_KIND = { course: "Course", tp: "Lab (TP)", code: "Code", other: "Other" };
const MAX_DOC_MB = 4;
let myDocuments = [];

async function loadDocs() {
  if (!classId || isAssistant()) return;
  let docs = [];
  try { myDocuments = await rpc("t_list_documents"); docs = await rpc("t_list_docs", { p_class: classId }); }
  catch (e) { toast(e.message, "error"); return; }
  const inClass = new Set(docs.map((d) => d.doc_id).filter(Boolean));

  // documents of the class
  $("docsTable").innerHTML = docs.length === 0 ? `<p class="muted">No document yet for ${esc(classNames[classId] || "this class")}. Add one from the list below.</p>` :
    `<table><tr><th>Document</th><th>Type</th><th>Students see it</th><th>PDF download</th><th></th></tr>` + docs.map((d) =>
    `<tr><td>${d.doc_id ? `<a href="doc.html?preview=${d.doc_id}" target="_blank">${esc(d.title)}</a>` : `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a> <span class="muted">(link)</span>`}
        ${d.file_name ? `<span class="badge info">📎 ${esc(d.file_name)}</span>` : ""}</td><td>${DOC_KIND[d.kind] || d.kind}</td>
      <td><button class="small ${d.visible ? "green" : "secondary"}" data-dvis="${d.id}" data-val="${d.visible ? 1 : 0}">${d.visible ? "👁 visible" : "hidden"}</button></td>
      <td>${d.has_pdf ? `<button class="small ${d.allow_pdf ? "green" : "secondary"}" data-dpdf="${d.id}" data-val="${d.allow_pdf ? 1 : 0}">${d.allow_pdf ? "⬇ allowed" : "not allowed"}</button>` : '<span class="muted">no PDF</span>'}</td>
      <td><button class="small red" data-ddel="${d.id}">Remove</button></td></tr>`).join("") + `</table>`;
  const update = async (id, visible, allowPdf) => {
    try { await rpc("t_update_doc", { p_doc: id, p_title: null, p_visible: visible, p_allow_pdf: allowPdf }); loadDocs(); }
    catch (e) { toast(e.message, "error"); }
  };
  $("docsTable").querySelectorAll("[data-dvis]").forEach((b) => b.onclick = () => update(b.dataset.dvis, b.dataset.val !== "1", null));
  $("docsTable").querySelectorAll("[data-dpdf]").forEach((b) => b.onclick = () => update(b.dataset.dpdf, null, b.dataset.val !== "1"));
  $("docsTable").querySelectorAll("[data-ddel]").forEach((b) => b.onclick = async () => {
    const title = b.closest("tr").querySelector("a").textContent;
    if (!confirm(`Remove "${title}" from the student space of this class?\n(The document itself stays in "My documents".)`)) return;
    try { await rpc("t_delete_doc", { p_doc: b.dataset.ddel }); toast("Removed from this class.", "ok"); loadDocs(); }
    catch (e) { toast(e.message, "error"); }
  });

  // my private documents
  $("documentsTable").innerHTML = myDocuments.length === 0 ? `<p class="muted">No document yet. Add the first one below.</p>` :
    `<table><tr><th>Module</th><th>Document</th><th>Type</th><th>Content</th><th>Used in</th><th></th></tr>` + myDocuments.map((m) =>
    `<tr><td>${esc(m.module)}</td><td><a href="doc.html?preview=${m.id}" target="_blank">${esc(m.title)}</a></td><td>${DOC_KIND[m.kind] || m.kind}</td>
      <td><span class="doc-parts">${m.has_html ? `<span class="badge ok">page ${m.html_kb} kB</span>` : ""}${m.pdf_kb != null ? `<span class="badge info">PDF ${m.pdf_kb} kB</span>` : ""}${m.file_name ? `<span class="badge info">📎 ${esc(m.file_name)}</span>` : ""}</span></td>
      <td>${m.classes} class(es)</td>
      <td style="white-space:nowrap">${inClass.has(m.id) ? '<span class="muted">in this class</span>' : `<button class="small green" data-madd="${m.id}">Add to this class</button>`}
        <button class="small secondary" data-medit="${m.id}">Replace…</button> <button class="small red" data-mdel="${m.id}">Delete</button></td></tr>`).join("") + `</table>`;
  $("documentsTable").querySelectorAll("[data-madd]").forEach((b) => b.onclick = async () => {
    try { await rpc("t_add_class_doc", { p_class: classId, p_doc: b.dataset.madd }); toast("Added to this class (hidden). Click 'hidden' to show it to the students.", "ok"); loadDocs(); }
    catch (e) { toast(e.message, "error"); }
  });
  $("documentsTable").querySelectorAll("[data-medit]").forEach((b) => b.onclick = () => {
    const m = myDocuments.find((x) => x.id === b.dataset.medit);
    $("mdTitle").value = m.title; $("mdModule").value = m.module; $("mdKind").value = m.kind;
    $("mdInfo").textContent = ` Replacing "${m.title}": choose only the file(s) that changed, then Save.`;
    $("mdTitle").scrollIntoView({ behavior: "smooth", block: "center" });
  });
  $("documentsTable").querySelectorAll("[data-mdel]").forEach((b) => b.onclick = async () => {
    const m = myDocuments.find((x) => x.id === b.dataset.mdel);
    if (!confirm(`DELETE the document "${m.title}"?\nIt disappears from the ${m.classes} class(es) that use it.`)) return;
    try { await rpc("t_delete_document", { p_id: m.id }); toast("Document deleted.", "ok"); loadDocs(); }
    catch (e) { toast(e.message, "error"); }
  });
}

// ----- reading statistics of the documents of the class
function fmtDuration(s) {
  s = Number(s) || 0;
  if (s < 60) return s + " s";
  if (s < 3600) return Math.floor(s / 60) + " min " + String(s % 60).padStart(2, "0") + " s";
  return Math.floor(s / 3600) + " h " + String(Math.floor((s % 3600) / 60)).padStart(2, "0") + " min";
}
function fmtWhen(t) { return t ? new Date(t).toLocaleString([], { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""; }
let docStats = null;
async function loadDocStats() {
  if (!classId || isAssistant()) return;
  try { docStats = await rpc("t_doc_stats", { p_class: classId }); } catch (e) { toast(e.message, "error"); return; }
  const n = docStats.students.length;
  const byDoc = (id) => docStats.reads.filter((r) => r.doc === id);
  $("statsDocs").innerHTML = docStats.docs.length === 0 ? `<p class="muted">No stored document in this class yet.</p>` :
    `<table><tr><th>Document</th><th>Opened by</th><th>Median reading time</th><th>Read to the end (≥ 90 %)</th><th>PDF downloads</th><th>File downloads</th><th></th></tr>` +
    docStats.docs.map((d) => {
      const rs = byDoc(d.id), opened = rs.filter((r) => r.opens > 0);
      const times = opened.map((r) => r.active_s).sort((a, b) => a - b);
      const median = times.length ? times[Math.floor(times.length / 2)] : 0;
      return `<tr><td>${esc(d.title)}${d.visible ? "" : ' <span class="badge closed">hidden</span>'}</td>
        <td><strong>${opened.length}</strong> / ${n}</td><td>${opened.length ? fmtDuration(median) : "-"}</td>
        <td>${opened.filter((r) => r.scroll_pct >= 90).length}</td>
        <td>${d.has_pdf ? rs.filter((r) => r.pdf_count > 0).length : '<span class="muted">-</span>'}</td>
        <td>${d.file_name ? rs.filter((r) => r.file_count > 0).length : '<span class="muted">-</span>'}</td>
        <td><button class="small secondary" data-sdoc="${d.id}">Students…</button></td></tr>`;
    }).join("") + `</table>`;
  $("statsDocs").querySelectorAll("[data-sdoc]").forEach((b) => b.onclick = () => showDocStudents(b.dataset.sdoc));
  if ($("statsDetail").dataset.doc) showDocStudents($("statsDetail").dataset.doc);
}
function showDocStudents(docId) {
  const d = docStats.docs.find((x) => x.id === docId);
  if (!d) { $("statsDetail").innerHTML = ""; return; }
  $("statsDetail").dataset.doc = docId;
  const read = {};
  docStats.reads.filter((r) => r.doc === docId).forEach((r) => { read[r.student] = r; });
  const rows = docStats.students.map((st) => ({ st, r: read[st.id] })).sort((a, b) => (b.r ? 1 : 0) - (a.r ? 1 : 0) || a.st.name.localeCompare(b.st.name));
  $("statsDetail").innerHTML = `<h3 style="margin-top:16px">${esc(d.title)}: student by student
      <button class="small secondary" id="statsExport">⬇ Excel</button></h3>
    <table><tr><th>Student</th><th>Matricule</th><th>First opened</th><th>Last seen</th><th>Times opened</th><th>Reading time</th><th>Read up to</th><th>PDF downloaded</th><th>File downloaded</th></tr>` +
    rows.map(({ st, r }) => !r || (!r.opens && !r.pdf_count && !r.file_count)
      ? `<tr><td><button class="linklike" data-profile="${st.id}">${esc(st.name)}</button></td><td>${esc(st.matricule)}</td><td colspan="7"><span class="badge no">never opened</span></td></tr>`
      : `<tr><td><button class="linklike" data-profile="${st.id}">${esc(st.name)}</button></td><td>${esc(st.matricule)}</td><td>${fmtWhen(r.first_open)}</td><td>${fmtWhen(r.last_seen)}</td>
          <td>${r.opens}</td><td>${fmtDuration(r.active_s)}</td><td>${r.scroll_pct} %</td><td>${fmtWhen(r.pdf_at)}</td><td>${fmtWhen(r.file_at)}</td></tr>`).join("") + `</table>`;
  $("statsExport").onclick = () => {
    const sheet = [["Student", "Matricule", "First opened", "Last seen", "Times opened", "Reading time (s)", "Read up to (%)", "PDF downloaded", "File downloaded"],
      ...rows.map(({ st, r }) => [st.name, st.matricule, r ? fmtWhen(r.first_open) : "", r ? fmtWhen(r.last_seen) : "", r ? r.opens : 0, r ? r.active_s : 0,
        r ? r.scroll_pct : 0, r ? fmtWhen(r.pdf_at) : "", r ? fmtWhen(r.file_at) : ""])];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sheet), "Reading");
    XLSX.writeFile(wb, `reading_${d.title.replace(/[^\w]+/g, "_").slice(0, 40)}.xlsx`);
  };
}
$("statsRefreshBtn").onclick = loadDocStats;

function readFileAs(file, how) {
  return new Promise((ok, ko) => {
    const r = new FileReader();
    r.onload = () => ok(how === "text" ? r.result : String(r.result).split(",")[1]);   // data URL -> base64 part
    r.onerror = () => ko(r.error);
    if (how === "text") r.readAsText(file); else r.readAsDataURL(file);
  });
}
// The title is proposed from the <title> of the page.
$("mdHtml").onchange = async () => {
  const f = $("mdHtml").files[0];
  if (!f || $("mdTitle").value.trim()) return;
  const text = await readFileAs(f, "text");
  const m = text.match(/<title>([^<]*)<\/title>/i);
  const decode = document.createElement("textarea");      // "L&#x27;objet" -> "L'objet"
  decode.innerHTML = m ? m[1].split(" · ")[0] : f.name.replace(/\.html?$/i, "");
  $("mdTitle").value = decode.value.trim();
};
$("mdSaveBtn").onclick = async () => {
  const html = $("mdHtml").files[0], pdf = $("mdPdf").files[0], file = $("mdFile").files[0];
  const title = $("mdTitle").value.trim();
  if (!title) { toast("Give the document a title.", "error"); return; }
  for (const f of [html, pdf, file]) {
    if (f && f.size > MAX_DOC_MB * 1e6) { toast(`"${f.name}" is larger than ${MAX_DOC_MB} MB: too big for a document.`, "error"); return; }
  }
  const existing = myDocuments.find((m) => m.title === title && m.module === $("mdModule").value.trim());
  if (!existing && !html && !pdf && !file) { toast("Choose at least one file.", "error"); return; }
  if (existing && !confirm(`"${title}" already exists: replace it?\nOnly the file(s) you chose are replaced; the classes keep their settings.`)) return;
  $("mdSaveBtn").disabled = true;
  try {
    await rpc("t_save_document", { p_id: existing ? existing.id : null, p_title: title, p_kind: $("mdKind").value, p_module: $("mdModule").value.trim(),
      p_html: html ? await readFileAs(html, "text") : null, p_pdf: pdf ? await readFileAs(pdf, "base64") : null,
      p_file: file ? await readFileAs(file, "base64") : null, p_file_name: file ? file.name : null });
    toast(existing ? "Document replaced." : "Document saved. Click 'Add to this class', then make it visible.", "ok");
    ["mdHtml", "mdPdf", "mdFile", "mdTitle"].forEach((id) => { $(id).value = ""; });
    $("mdInfo").textContent = "";
    loadDocs();
  } catch (e) { toast(e.message, "error"); }
  $("mdSaveBtn").disabled = false;
};
$("docUrlAddBtn").onclick = async () => {
  try {
    await rpc("t_add_doc", { p_class: classId, p_title: $("docTitle").value, p_url: $("docUrl").value, p_kind: $("docKind").value, p_visible: false });
    toast("Link added (hidden). Click 'hidden' to show it to the students.", "ok");
    $("docTitle").value = ""; $("docUrl").value = "";
    loadDocs();
  } catch (e) { toast(e.message, "error"); }
};

// ------------------------------------------------------------------ lab assistants and their activity
async function loadAssistants() {
  if (!classId || isAssistant()) return;
  let list = [], log = [];
  try { list = await rpc("t_list_assistants", { p_class: classId }); log = await rpc("t_activity_log", { p_class: classId }); } catch (e) { return; }
  $("assistantsTable").innerHTML = list.length === 0 ? `<p class="muted">No assistant for ${esc(classNames[classId] || "this class")}.</p>` :
    `<table>` + list.map((a) => `<tr><td>${esc(a.email)}</td><td class="muted">added ${new Date(a.added_at).toLocaleDateString()}</td>
      <td><button class="small red" data-arem="${a.user_id}" data-email="${esc(a.email)}">Remove</button></td></tr>`).join("") + `</table>`;
  $("assistantsTable").querySelectorAll("[data-arem]").forEach((b) => b.onclick = async () => {
    if (!confirm(`Remove ${b.dataset.email} from the assistants of this class? (His activity log is kept.)`)) return;
    try { await rpc("t_remove_assistant", { p_class: classId, p_user: b.dataset.arem }); toast("Assistant removed.", "ok"); loadAssistants(); }
    catch (e) { toast(e.message, "error"); }
  });
  $("activityLog").innerHTML = log.length === 0 ? `<p class="muted">Nothing yet.</p>` :
    `<table><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr>` + log.map((l) =>
    `<tr><td style="white-space:nowrap">${new Date(l.at).toLocaleString()}</td><td>${esc(l.email || "")}</td><td>${esc(l.action)}</td><td>${esc(l.detail || "")}</td></tr>`).join("") + `</table>`;
}
$("addAssistantBtn").onclick = async () => {
  try {
    await rpc("t_add_assistant", { p_class: classId, p_email: $("assistantEmail").value });
    $("assistantEmail").value = "";
    toast("Assistant added: he logs in on this same page with his e-mail and password.", "ok");
    loadAssistants();
  } catch (e) { toast(e.message, "error"); }
};
$("logRefreshBtn").onclick = loadAssistants;

async function openProfile(studentId) {
  if (isAssistant()) return;
  try { profileData = await rpc("t_student_profile", { p_student: studentId }); } catch (e) { toast(e.message, "error"); return; }
  const p = profileData, st = p.student;
  const present = p.sessions.filter((x) => x.status === "present" || x.status === "late").length;
  const bonus = (cat) => { const b = p.bonus.find((x) => x.category === cat); return b ? Number(b.points) : 0; };
  $("profileTitle").textContent = `${st.last_name} ${st.first_name} · ${st.matricule}`;
  $("profileBody").innerHTML = `<p class="muted">${esc(p.class)} · ${st.official ? "in the official list" : "NOT in the official list"} · ${st.registered ? "phone registered" : "no phone"}</p>
    <div class="row" style="gap:30px;margin:10px 0">
      <div><div class="stat">${present} / ${p.sessions.length}</div><div class="muted">sessions attended</div></div>
      <div><div class="stat">${p.quizzes.filter((q) => q.graded && q.mark != null).length}</div><div class="muted">graded quizzes taken</div></div>
      <div><div class="stat">+${bonus("course")} / +${bonus("td")} / +${bonus("tp")}</div><div class="muted">bonus course / TD / TP</div></div>
    </div>
    <h3>Attendance</h3><table><tr><th>Date</th><th>Time</th><th>Type</th><th>Session</th><th>Status</th></tr>` +
    p.sessions.map((x) => `<tr><td>${x.date}</td><td>${x.time || ""}</td><td><span class="kind ${x.kind}">${SESSION_KIND[x.kind]}</span></td><td>${esc(x.title)}</td>
      <td>${x.status === "absent" ? '<span class="badge no">absent</span>' : esc(x.status)}</td></tr>`).join("") + `</table>
    <h3 style="margin-top:14px">Quizzes and tests</h3><table><tr><th>Date</th><th>Type</th><th>Title</th><th>Mark</th><th>Left the screen</th></tr>` +
    p.quizzes.map((q) => `<tr><td>${q.date}</td><td>${KIND_LABEL[q.kind] || q.kind}${q.graded ? "" : " (not graded)"}</td><td>${esc(q.title)}</td>
      <td>${q.kind === "survey" ? "-" : q.mark == null ? '<span class="badge no">no answer</span>' : `${Number(q.mark)} / ${Number(q.total_points)}`}</td><td>${q.left_screen || ""}</td></tr>`).join("") + `</table>
    <h3 style="margin-top:14px">Documents (course notes, lab sheets, code)</h3>` + ((p.documents || []).filter((d) => d.stored).length === 0 ? `<p class="muted">No document in this class yet.</p>` :
    `<table><tr><th>Document</th><th>First opened</th><th>Last seen</th><th>Times opened</th><th>Reading time</th><th>Read up to</th><th>PDF downloaded</th><th>File downloaded</th></tr>` +
    p.documents.filter((d) => d.stored).map((d) => !d.opens && !d.pdf_count && !d.file_count
      ? `<tr><td>${esc(d.title)}</td><td colspan="7"><span class="badge no">never opened</span></td></tr>`
      : `<tr><td>${esc(d.title)}</td><td>${fmtWhen(d.first_open)}</td><td>${fmtWhen(d.last_seen)}</td><td>${d.opens}</td><td>${fmtDuration(d.active_s)}</td>
          <td>${d.scroll_pct} %</td><td>${fmtWhen(d.pdf_at)}</td><td>${fmtWhen(d.file_at)}</td></tr>`).join("") + `</table>`);
  $("profileBox").classList.remove("hidden");
}
$("profileClose").onclick = () => $("profileBox").classList.add("hidden");
$("profileBox").onclick = (ev) => { if (ev.target === $("profileBox")) $("profileBox").classList.add("hidden"); };
$("profileExport").onclick = () => {
  const p = profileData, st = p.student;
  const wb = XLSX.utils.book_new();
  const a = [["Date", "Time", "Type", "Session", "Status"], ...p.sessions.map((x) => [x.date, x.time || "", SESSION_KIND[x.kind], x.title, x.status])];
  const q = [["Date", "Type", "Graded", "Title", "Mark", "Out of", "Left the screen"],
    ...p.quizzes.map((x) => [x.date, KIND_LABEL[x.kind], x.graded ? "yes" : "no", x.title, x.mark == null ? "" : Number(x.mark), Number(x.total_points), x.left_screen || 0])];
  const b = [["Category", "Bonus points"], ...p.bonus.map((x) => [SESSION_KIND[x.category] || x.category, Number(x.points)])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[`${st.last_name} ${st.first_name}`, st.matricule, p.class]]), "Student");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(a), "Attendance");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(q), "Quizzes");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(b), "Bonus");
  XLSX.writeFile(wb, `ClassPulse_${st.matricule}_${st.last_name}.xlsx`.replace(/[^\w.-]+/g, "_"));
};

// ------------------------------------------------------------------ export
$("exportBtn").onclick = async () => {
  if (!classId) return;
  try { downloadResults(await rpc("t_export", { p_class: classId })); }
  catch (e) { toast(e.message, "error"); }
};

init();
