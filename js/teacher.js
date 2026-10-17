// ClassPulse - teacher console.
(window.CP_FILES = window.CP_FILES || {})["teacher.js"] = "31"; // file version, checked by common.js

let classId = null;
let sessionId = null;
let sessionCode = null;
let live = null;              // last t_live result
let channel = null;
let autoTimer = null;
let allQuestions = [];
let activeTab = "live";
let checkLocation = false;    // this session asks the phone position at check-in
let classNames = {};          // class id -> "name year"
let classRoles = {};          // class id -> "teacher" | "assistant"
let classInfo = {};           // class id -> row of t_list_classes (registration settings...)
function isAssistant() { return classId && classRoles[classId] === "assistant"; }
// v29: may the account do this in the selected class? (teacher: everything; assistant: the permissions the teacher gave him)
function can(perm) {
  if (!isAssistant()) return true;
  const c = classInfo[classId];
  return !!(c && (c.perms || []).includes(perm));
}
const ROLE_LABEL = { tp: "TP assistant", td: "TD assistant", course: "Course assistant", co: "Co-teacher" };

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
    supervision: "Supervision: your projects, outside the classes.",
  };
  $("bannerNote").textContent = notes[activeTab] || "";
  $("classBanner").classList.toggle("hidden", activeTab === "supervision");   // v31: a project is not a class
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

// v29: an assistant with an invitation code creates his account (or uses his existing one), then joins the class.
$("invBtn").onclick = async () => {
  const email = $("invEmail").value.trim(), password = $("invPassword").value, code = $("invCode").value.trim().toUpperCase();
  const note = (t) => { $("invNote").textContent = t; $("invNote").classList.remove("hidden"); };
  if (!email || password.length < 8 || code.length < 6) { toast("E-mail, a password of 8 characters or more, and the code.", "error"); return; }
  $("invBtn").disabled = true;
  try {
    let { data, error } = await db.auth.signUp({ email, password });
    if (error && /already|registered|exists/i.test(error.message)) ({ data, error } = await db.auth.signInWithPassword({ email, password }));
    if (error) { toast(error.message, "error"); return; }
    if (!data.session) {
      const r = await db.auth.signInWithPassword({ email, password });
      if (r.error) { note("Account created. Open the confirmation e-mail sent to you, then come back here and click this button again (same e-mail, password and code)."); return; }
    }
    await rpc("t_claim_invite", { p_code: code });
    $("loginView").classList.add("hidden");
    await showApp();
    toast("Welcome: you are now assistant of this class.", "ok");
  } catch (e) { toast(e.message, "error"); }
  finally { $("invBtn").disabled = false; }
};

async function showApp() {
  $("appView").classList.remove("hidden");
  const { data } = await db.auth.getUser();
  $("whoAmI").textContent = data && data.user ? data.user.email : "";
  // v29: "New class" for the teachers' accounts only; an assistant joins a class with a code
  try { const me = await rpc("t_me"); $("newClassCard").classList.toggle("hidden", !me.is_teacher); $("mySpaceTab").classList.toggle("hidden", !me.is_teacher); }
  catch (e) { $("newClassCard").classList.add("hidden"); }
  initSupervision();   // v31
  await loadClasses();
  poller(loadAttempts, 20000);   // v28.1: never two at the same time
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
      sessions: loadSessions, demos: loadDemos, space: () => loadDocs().then(loadDocStats), content: loadClassContent, results: loadResults, messages: loadMessages, myspace: loadMySpace, supervision: loadProjects,
      quizzes: () => { $("tplEditorCard").classList.add("hidden"); $("tplListCard").classList.remove("hidden"); return loadTemplates(); } };
    if (loaders[b.dataset.tab]) loaders[b.dataset.tab]();
  };
});

// ------------------------------------------------------------------ classes
async function loadClasses() {
  const classes = await rpc("t_list_classes");
  classNames = {};
  classes.forEach((c) => { classNames[c.id] = `${c.name} ${c.year}`; classRoles[c.id] = c.role || "teacher"; classInfo[c.id] = c; });
  const keep = classId || localStorage.getItem("cp_class");
  const active = classes.filter((c) => !c.archived);
  $("classSelect").innerHTML = active.map((c) => `<option value="${c.id}">${esc(c.name)} ${esc(c.year)}</option>`).join("") ||
    `<option value="">- create a class first -</option>`;
  if (keep && active.some((c) => c.id === keep)) $("classSelect").value = keep;
  const listed = $("showArchived").checked ? classes : active;
  const hiddenCount = classes.length - active.length;
  $("classesTable").innerHTML = `<table><tr><th>Class</th><th>Year</th><th>Students</th><th>Sessions</th><th>Affiliation shown to the students</th><th></th></tr>` +
    listed.map((c) => `<tr><td>${esc(c.name)}${c.role === "assistant" ? ' <span class="badge info">assistant</span>' : ""}${c.archived ? ' <span class="badge closed">archived</span>' : ""}</td><td>${esc(c.year)}</td><td>${c.students}</td><td>${c.sessions}</td>
      <td>${c.affiliation ? esc(c.affiliation) : '<span class="muted">as on my page</span>'} ${c.role === "assistant" ? "" : `<button class="small secondary" data-caff="${c.id}" title="Change">✏</button>`}</td>
      <td style="white-space:nowrap">${c.role === "assistant" ? "" : `<button class="small secondary" data-carch="${c.id}" data-to="${c.archived ? 0 : 1}">${c.archived ? "Bring back" : "Archive"}</button>
        <button class="small red" data-cdel="${c.id}">Delete</button>`}</td></tr>`).join("") + `</table>` +
    (hiddenCount && !$("showArchived").checked ? `<p class="muted">${hiddenCount} archived class(es) not shown.</p>` : "");
  $("classesTable").querySelectorAll("[data-caff]").forEach((b) => b.onclick = async () => {
    const c = classInfo[b.dataset.caff];
    const v = prompt(`Affiliation shown to the students of "${c.name} ${c.year}" (e.g. Telecommunications Department · FGE · USTHB).\nEmpty = the affiliation of your personal page.`, c.affiliation || "");
    if (v === null) return;
    try { await rpc("t_set_class_affiliation", { p_class: c.id, p_affiliation: v }); toast("Affiliation saved.", "ok"); await loadClasses(); }
    catch (e) { toast(e.message, "error"); }
  });
  $("classesTable").querySelectorAll("[data-carch]").forEach((b) => b.onclick = async () => {
    try {
      await rpc("t_archive_class", { p_class: b.dataset.carch, p_archived: b.dataset.to === "1" });
      if (b.dataset.to === "1" && classId === b.dataset.carch) { classId = null; localStorage.removeItem("cp_class"); }
      toast(b.dataset.to === "1" ? "Class archived: nothing is lost." : "Class brought back.", "ok");
      await loadClasses();
    } catch (e) { toast(e.message, "error"); }
  });
  $("classesTable").querySelectorAll("[data-cdel]").forEach((b) => b.onclick = async () => {
    const c = classInfo[b.dataset.cdel];
    // three steps on purpose: a class cannot be deleted by a wrong click
    if (!confirm(`Delete the class "${c.name} ${c.year}"?\n\nThis erases for ever: ${c.students} student(s), ${c.sessions} session(s), all the attendance and all the marks.\nYour questions, documents and demos are kept.\n\nTo keep everything and only hide the class, press Cancel and use "Archive".`)) return;
    if (!confirm("Did you export the results of this class (Export results tab)?\n\nOK = yes, go on.   Cancel = stop here.")) return;
    const typed = prompt(`Last step. Type the exact name of the class to delete it:\n\n${c.name}`);
    if (typed === null) return;
    try {
      await rpc("t_delete_class", { p_class: c.id, p_name: typed });
      if (classId === c.id) { classId = null; sessionId = null; localStorage.removeItem("cp_class"); localStorage.removeItem("cp_session"); }
      toast("Class deleted.", "ok");
      await loadClasses();
    } catch (e) { toast(e.message, "error"); }
  });
  await selectClass($("classSelect").value || null);
}
$("showArchived").onchange = () => loadClasses();

$("classSelect").onchange = () => selectClass($("classSelect").value);

// Lab assistant: hide what he cannot do, force the lab (TP) type.
function applyRole() {
  const a = !!isAssistant();
  document.body.classList.toggle("assistant", a);
  // v29: what an assistant sees follows his permissions (data-perm="...")
  document.querySelectorAll("[data-perm]").forEach((el) => el.classList.toggle("perm-on", can(el.dataset.perm)));
  const kinds = ["course", "td", "tp"].filter((k) => can("kind_" + k));
  [...$("newSessionKind").options].forEach((o) => { o.disabled = !kinds.includes(o.value); });
  if (kinds.length && !kinds.includes($("newSessionKind").value)) $("newSessionKind").value = kinds[kinds.length - 1];
  [...$("quizKind").options].forEach((o) => { o.disabled = o.value === "tp" ? !can("kind_tp") : !(can("kind_course") || can("kind_td")); });
  const qk = $("quizKind").selectedOptions[0];
  if (qk && qk.disabled) { const ok = [...$("quizKind").options].find((o) => !o.disabled); if (ok) $("quizKind").value = ok.value; }
  if (a) {
    const c = classInfo[classId] || {};
    $("rolePill").textContent = `${ROLE_LABEL[c.asst_role] || "Assistant"}${(c.asst_groups || []).length ? " · " + c.asst_groups.join(", ") : ""}`;
    const active = document.querySelector("nav button[data-tab].active");
    if (active && (active.classList.contains("teacher-only") || (active.dataset.perm && !can(active.dataset.perm)))) document.querySelector("nav button[data-tab=live]").click();
  }
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
  loadClassContent();
  // refresh the tab currently shown, so that it always matches the selected class
  if (changed && activeTab === "students") await loadStudents();
  if (changed && activeTab === "space") { $("statsDetail").dataset.doc = ""; $("statsDetail").innerHTML = ""; await loadDocs(); await loadDocStats(); }
  if (activeTab === "classes" && !isAssistant()) loadAssistants();
  if (activeTab === "results") loadResults();
  if (activeTab === "messages") loadMessages();
  updateMsgBadge();
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
  await loadGroups();
  await closeForgottenAttendance();
  const keep = sessionId || localStorage.getItem("cp_session");
  $("sessionSelect").innerHTML = `<option value="">- choose a session -</option>` +
    allSessions.map((s) => `<option value="${s.id}" data-code="${s.code}">${esc(s.date)} ${timeRange(s)} · ${SESSION_KIND[s.kind] || ""}${s.group ? " " + esc(s.group) : ""} · ${esc(s.title)} · code ${s.code} · ${s.present} present</option>`).join("");
  if (keep && allSessions.some((s) => s.id === keep)) $("sessionSelect").value = keep;
  renderSessionsTable();
  await selectSession($("sessionSelect").value || null);
}

// v24: TD groups and TP sub-groups of the class (read from the student list), offered when a session is created.
let classGroups = { td: [], tp: [] };
async function loadGroups() {
  classGroups = { td: [], tp: [] };
  try {
    const list = await rpc("t_list_students", { p_class: classId });
    classGroups.td = [...new Set(list.map((s) => s.td_group).filter(Boolean))].sort();
    classGroups.tp = [...new Set(list.map((s) => s.tp_group).filter(Boolean))].sort();
  } catch (e) { /* no group */ }
  fillGroupSelect($("newSessionGroup"), $("newSessionKind").value, "");
}
function groupOptions(kind, current) {
  const names = kind === "td" ? classGroups.td : kind === "tp" ? classGroups.tp : classGroups.td.concat(classGroups.tp);
  const all = [...new Set(names.concat(current ? [current] : []))];
  return `<option value="">Whole class</option>` + all.map((g) => `<option value="${esc(g)}" ${g === current ? "selected" : ""}>${esc(g)}</option>`).join("");
}
function fillGroupSelect(select, kind, current) { select.innerHTML = groupOptions(kind, current); }
$("newSessionKind").addEventListener("change", () => fillGroupSelect($("newSessionGroup"), $("newSessionKind").value, ""));

// An attendance forgotten open is closed here (once per session, when this page loads the list).
const autoClosed = new Set();
async function closeForgottenAttendance() {
  const now = new Date();
  const today = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");
  const hhmm = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
  const closed = [];
  for (const s of allSessions) {
    if (!s.attendance_open || s.ended_at || autoClosed.has(s.id)) continue;
    // opened more than 6 hours ago, or opened before the planned end of today's session and that end has passed.
    // An attendance opened again on purpose after the end (or on an old session) is left alone.
    const opened = s.attendance_opened_at ? new Date(s.attendance_opened_at) : null;
    const end = s.date === today && s.end_time && s.end_time < hhmm ? new Date(`${s.date}T${s.end_time}:00`) : null;
    const over = opened ? (now - opened > 6 * 3600 * 1000 || (end && opened < end)) : s.date < today;
    if (!over) continue;
    autoClosed.add(s.id);
    try { await rpc("t_set_attendance_open", { p_session: s.id, p_open: false }); s.attendance_open = false; closed.push(s.title); } catch (e) { /* not allowed: ignore */ }
  }
  if (closed.length) toast("Attendance closed automatically (session over): " + closed.join(", "), "ok");
}

// "09:40-11:10", or only the start time when no end time is set.
function timeRange(s) { return (s.time || "") + (s.end_time ? "-" + s.end_time : ""); }

// Two reminders: sessions never ended (red) and attendance still open (green).
function renderSessionAlerts() {
  const notEnded = allSessions.filter((s) => !s.ended_at).length;
  const open = allSessions.filter((s) => s.attendance_open && !s.ended_at);
  $("sessionsAlerts").innerHTML = allSessions.length === 0 ? "" :
    `<p><span class="badge ${notEnded ? "no" : "closed"}" id="notEndedCount">${notEnded} session(s) not ended</span>
        <span class="badge ${open.length ? "open" : "closed"}" id="attOpenCount">${open.length} attendance open</span>
        ${open.length ? `<span class="muted">Open: ${open.map((s) => esc(s.title)).join(", ")}. With a fixed code, anybody who knows it can check in: close it when the session is over.</span>` : ""}</p>`;
  $("sessionsBadge").textContent = open.length;
  $("sessionsBadge").classList.toggle("hidden", open.length === 0);
  $("sessionsBadge").title = open.length + " attendance open";
}

function renderSessionsTable() {
  renderSessionAlerts();
  $("sessionsTable").innerHTML = allSessions.length === 0 ? `<p class="muted">No session yet. Create one in the Live session tab.</p>` :
    `<table><tr><th>Date</th><th>Time</th><th>Type</th><th>Group</th><th>Unit</th><th>Title</th><th>Code</th><th>Present</th><th>Quizzes</th><th></th></tr>` +
    allSessions.map((s) => `<tr data-id="${s.id}"><td class="c-date">${esc(s.date)}</td><td class="c-time">${timeRange(s)}${s.ended_at ? ' <span class="badge closed">ended</span>' : ""}${s.attendance_open && !s.ended_at ? ' <span class="badge open">attendance open</span>' : ""}</td>
      <td class="c-kind"><span class="kind ${s.kind}">${SESSION_KIND[s.kind] || s.kind}</span></td><td class="c-group">${esc(s.group || "")}</td><td class="c-unit">${esc(s.unit || "")}</td><td class="c-title">${esc(s.title)}</td>
      <td>${s.code}</td><td>${s.present}</td><td>${s.quizzes}</td>
      <td style="white-space:nowrap"><button class="small green" data-open="${s.id}">Open</button>
        ${s.mine === false ? "" : `<button class="small secondary" data-sedit="${s.id}">Edit</button> <button class="small red" data-sdel="${s.id}">Delete</button>`}</td></tr>`).join("") + `</table>`;
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
    tr.querySelector(".c-group").innerHTML = `<select class="e-group" style="width:auto">${groupOptions(s.kind, s.group || "")}</select>`;
    tr.querySelector(".c-unit").innerHTML = `<input class="e-unit" value="${esc(s.unit || "")}" placeholder="TP1" style="width:80px">`;
    tr.querySelector(".e-kind").onchange = () => { tr.querySelector(".e-group").innerHTML = groupOptions(tr.querySelector(".e-kind").value, ""); };
    b.textContent = "Save"; b.className = "small green";
    b.onclick = async () => {
      try {
        await rpc("t_update_session", { p_session: s.id, p_title: tr.querySelector(".e-title").value, p_date: tr.querySelector(".e-date").value,
          p_time: tr.querySelector(".e-time").value || null, p_kind: tr.querySelector(".e-kind").value });
        await rpc("t_set_session_end_time", { p_session: s.id, p_end_time: tr.querySelector(".e-end").value || null });
        await rpc("t_set_session_group", { p_session: s.id, p_group: tr.querySelector(".e-group").value, p_unit: tr.querySelector(".e-unit").value });
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
    if ($("newSessionGroup").value || $("newSessionUnit").value.trim()) await rpc("t_set_session_group", { p_session: s.id, p_group: $("newSessionGroup").value, p_unit: $("newSessionUnit").value });
    $("newSessionUnit").value = "";
    toast("Session created, code " + s.code, "ok");
    await loadSessions();
  } catch (e) { toast(e.message, "error"); }
};

async function selectSession(id) {
  sessionId = id || null;
  attCodeDue = 0; attLastHtml = ""; attHash = "";
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
  await Promise.all([refreshLive(), refreshAttendance()]);
  renderDrawn();
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

// v25: each opening of the attendance is a "run" for one group, with a new code. The sub-groups of a lab pass one
// after the other in the SAME session: open for sub-group 1, close, open for sub-group 2...
function groupLabel(kind, g) { return g ? `${kind === "tp" ? "Sub-group" : "Group"} ${g}` : "Whole class"; }
function sessionGroupNames() {
  const s = live && live.session;
  if (!s) return [];
  return s.kind === "td" ? classGroups.td : s.kind === "tp" ? classGroups.tp : [];
}
$("attOnBtn").onclick = async () => {
  const g = $("attGroup").classList.contains("hidden") ? null : $("attGroup").value;
  await act("t_set_attendance_open", { p_session: sessionId, p_open: true, p_group: g || null },
    g ? `Attendance open for ${groupLabel(live.session.kind, g).toLowerCase()}: new code.` : "Attendance open.");
  refreshAttendance();
};
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
  // v28.1: the list refreshed less than 10 s ago is used at once (a late check-in is caught by the next refresh)
  if (Date.now() - attLastAt > 10000) await refreshAttendance(); else refreshAttendance();
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
// The push list: demos + resources (files and links) + documents of the student space of this class + a free address.
// v25: each item has a key, so that pushing it again never adds a second line on the phones.
// A lab assistant gets what the teacher of the class allows him (a_class_content): his resources, his demos, his documents.
let classContent = null;
async function loadClassContent() {
  classContent = null;
  if (classId) { try { classContent = await rpc("a_class_content", { p_class: classId }); } catch (e) { classContent = null; } }
  fillPushList();
  if (activeTab === "content") renderContent();
}
function pushChoices() {
  const assistant = isAssistant();
  const cc = classContent || { docs: [], resources: [], demos: [] };
  const demos = allDemos.map((d) => ({ label: d.title, url: d.url, screen: d.screen, demo: true, key: "url:" + d.url, group: "Demos" + (d.module ? " - " + d.module : "") }));
  if (assistant) cc.demos.forEach((d) => {
    const url = demoPage(d.prefix, d.entry);
    if (!demos.some((x) => x.url === url)) demos.push({ label: d.title, url, screen: d.screen ? demoPage(d.prefix, d.screen) : null, demo: true, key: "url:" + url, group: "Demos" + (d.module ? " - " + d.module : "") });
  });
  const res = (assistant ? cc.resources : myResources).map((r) => ({ label: r.title, url: r.url, path: r.storage_path, key: "res:" + r.id,
    group: (assistant ? "Resources of the teacher" : "My resources") + (r.module ? " - " + r.module : "") }));
  const docs = cc.docs.filter((d) => d.published).map((d) => ({ label: d.title, key: "doc:" + d.id, group: "Student space of this class",
    url: d.stored ? siteUrl("doc.html") + "?d=" + d.id + "&c=" + classId : d.url }));
  return demos.concat(res, docs);
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
    const r = await rpc("t_share_link", { p_session: sessionId, p_url: url, p_label: link.label, p_document: !link.demo, p_key: link.key || null });
    if (channel) channel.ping();
    toast(r === "SHOWN" ? "Sent to the phones." : r === "SHOWN_ABOVE_TEST" ? "Sent: the phones show it above the lab test (the test is not interrupted)."
      : "A quiz is running: the link is added to the documents of the session, the phones will see it after the quiz.", "ok");
    await refreshLive();
  } catch (e) { toast(e.message, "error"); }
}

// ------------------------------------------------------------------ live figures
// v28.1: the live view is refreshed by ONE poller (never two calls at the same time, slower when the network is slow).
// refreshLive() asks for a fresh view now and resolves when it is there.
const livePoll = poller(refreshLiveNow, CONFIG.teacherPollMs || 1500, () => !!sessionId);
function refreshLive() { return sessionId ? livePoll.run() : Promise.resolve(); }
async function refreshLiveNow() {
  if (!sessionId) return;
  const sid = sessionId;
  let fresh;
  try { fresh = await rpc("t_live", { p_session: sid }); } catch (e) { return; }
  if (sid !== sessionId) return;           // the teacher chose another session meanwhile
  live = fresh;
  sendLiveToMini();
  const s = live.session;
  $("activityBadge").textContent = { idle: "Waiting screen", attendance: "Waiting screen", quiz: "Quiz", link: "Link: " + (s.link_label || "") }[s.activity] || s.activity;
  $("presentCount").textContent = live.present;
  $("classSize").textContent = live.class_size;
  $("classSizeLabel").textContent = live.run && live.run.group ? "expected (" + groupLabel(s.kind, live.run.group).toLowerCase() + ")" : "in the class";
  $("presentTotal").textContent = (live.runs || []).length > 1 ? `· ${live.present_total} in the whole session` : "";
  renderRuns();
  renderLiveRequests();
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
// v28.1: the small projector preview of the console gets the live view from here (it does not poll the server itself).
function sendLiveToMini(att) {
  const f = $("projMini");
  if (!f || !f.contentWindow || !live) return;
  try { f.contentWindow.postMessage({ type: "cp-live", live, att: att || null }, location.origin); } catch (e) { /* preview not loaded yet */ }
}
// v28.1: the code is asked again only when it is about to change (not at every refresh of the live view).
let attCodeDue = 0;
async function renderAttendanceCode() {
  const s = live.session;
  $("attCodeBox").classList.toggle("hidden", !s.attendance_open || !!s.ended_at);
  if (!s.attendance_open || s.ended_at) { attCodeShown = ""; attCodeDue = 0; return; }
  if (attCodeShown && Date.now() < attCodeDue) return;
  attCodeDue = Date.now() + 60000;
  let a;
  try { a = await rpc("t_attendance_code", { p_session: sessionId }); } catch (e) { attCodeDue = 0; return; }
  attCodeDue = Date.now() + Math.min(20000, Math.max(500, (a.next_change_ms || 5000) + 300));
  sendLiveToMini(a);
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
  if (!q) { box.innerHTML = `<p class="muted">No quiz running.</p>`; $("lockedBox").classList.add("hidden"); renderSilent(null); return; }
  let left = "";
  const self = q.pace === "self";
  ["startBtn", "revealBtn", "nextBtn", "addTimeBtn"].forEach((id) => { $(id).disabled = self; });
  $("nextBtn").textContent = !self && q.is_last && (q.phase === "question" || q.phase === "reveal") ? "Finish quiz?" : "Next question";
  if (self) {
    const perQ = q.per_question || [];
    box.innerHTML = `<div><p><strong>${esc(q.title)}</strong> · self-paced${q.ask_variant ? " · board number asked" : ""}${q.lock_screen ? " · 🔒 screen locked" : ""}</p>
      <p>${q.phase === "self" ? "OPEN: students answer at their own pace, and can change an answer until you click <strong>Finish quiz</strong>."
        : q.phase === "finished" ? "Finished." : "Not open yet: click <strong>1. Open</strong>."}</p>
      <table>${perQ.map((n, i) => `<tr><td>Q${i + 1}</td><td><div class="b" style="display:inline-block;height:10px;background:#1B7F8C;border-radius:4px;width:${Math.max(3, (160 * n) / Math.max(1, live.present))}px"></div></td><td>${n}</td></tr>`).join("")}</table></div>
      <div><div class="stat">${q.started == null ? 0 : q.started} / ${live.present}</div><div class="muted">students started</div>
      <div class="stat" style="margin-top:10px">${q.done == null ? 0 : q.done}</div><div class="muted">answered every question</div></div>`;
    if (q.phase === "finished" && q.results) { box.innerHTML = resultsPanel(q); bindResultsToggle(q); }
    renderLocked(q);
    return;
  }
  if ((q.phase === "question" || q.phase === "reveal") && q.per_student) {
    left = `<div><p><strong>Question ${q.index + 1} / ${q.count}</strong> · ${q.phase === "question" ? `<span class="timer">${formatSeconds(q.remaining_ms)} s</span>` : "closed"}</p>
      <p>Each student has <strong>his own questions</strong> (random draw): nothing to show here or on the projector.</p></div>`;
  } else if (q.phase === "question" || q.phase === "reveal") {
    const max = Math.max(1, ...(q.distribution || [0]));
    left = `<div><p><strong>Question ${q.index + 1} / ${q.count}</strong> · ${q.phase === "question" ? `<span class="timer">${formatSeconds(q.remaining_ms)} s</span>` : "answers shown"}</p>
      <p>${esc(q.question)}</p>${q.qtype === "number" ? `<p><span class="kind">🔢 numeric answer</span> accepted: <strong>${esc(q.expected || "")} ${esc(q.unit || "")}</strong></p>` : ""}<p class="muted">Answers shown to students: ${{ each: "after each question", end: "at the end", never: "never" }[q.reveal_mode] || ""}</p><div class="bars">` +
      (q.options || []).map((o, i) => `<div class="bar"><span class="l">${LETTERS[i]}</span><div class="b ${!q.survey && q.correct.includes(i) ? "ok" : ""}" style="width:${Math.max(4, (200 * q.distribution[i]) / max)}px"></div>
        <span>${q.distribution[i]}</span><span class="muted">${esc(o)}</span></div>`).join("") + `</div></div>`;
  } else if (q.phase === "lobby") {
    left = `<div><p><strong>${esc(q.title)}</strong> · ${KIND_LABEL[q.kind] || ""}</p><p>The phones show the rules. No timer runs.</p>
      <p><span class="stat">${q.ready}</span> / ${live.present} ready</p><p class="muted">When enough students are ready, click <strong>2. Start question 1</strong>.</p></div>`;
  } else {
    left = `<div><p><strong>${esc(q.title)}</strong></p><p>${q.phase === "finished" ? "Finished." : "Not started."}</p></div>`;
    if (q.phase === "finished" && q.results) { box.innerHTML = resultsPanel(q); bindResultsToggle(q); $("lockedBox").classList.add("hidden"); renderSilent(null); return; }
  }
  const right = `<div><div class="stat">${q.answers} / ${live.present}</div><div class="muted">answers to this question</div>
    ${q.survey ? `<div class="muted" style="margin-top:10px">survey: no right answer</div>` : `<div class="stat" style="margin-top:10px">${q.success_rate == null ? "-" : q.success_rate + " %"}</div><div class="muted">full marks</div>`}</div>`;
  box.innerHTML = left + right;
  renderLocked(q);
}
// v28: when a student left a live quiz and came back (unlocked): the questions in between are missed (0 point).
function awayText(away, q) {
  if (!away || !away.length || q.pace === "self") return "";
  return `<div class="muted" style="font-size:12px">` + away.map((a) => a.left == null ? "" :
    a.back == null ? `out from Q${a.left} to the end` : a.back === a.left ? `out during Q${a.left}` : `out Q${a.left} → back at Q${a.back}`).filter(Boolean).join("<br>") + `</div>`;
}
// Students locked because they left the quiz screen (live quizzes, and self-paced tests created with the lock).
// v28.2: phones without contact for 10 s or more while a question is open
function renderSilent(q) {
  const list = (q && q.silent) || [];
  $("silentBox").classList.toggle("hidden", list.length === 0);
  $("silentCount").textContent = list.length;
  $("silentList").innerHTML = list.length ? `<div class="chips">` + list.map((x) =>
    `<span class="chip">${esc(x.name)} <span class="muted">${x.silent_s == null ? "never seen" : fmtSince(x.silent_s)}</span></span>`).join("") + `</div>` : "";
}
function renderLocked(q) {
  renderSilent(q);
  const list = q.locked || [];
  $("lockedBox").classList.toggle("hidden", list.length === 0 && !q.dismissed);
  $("lockedCount").textContent = list.length;
  // v25: since when he is out of the quiz (counted by the server, then ticking here every second)
  const now = Date.now();
  $("lockedList").innerHTML = (list.length > 1 ? `<p style="margin:4px 0"><button class="small secondary" data-dismiss="all" title="Take them all off this list: they stay locked">✕ Clear the list</button></p>` : "") +
    (list.length === 0 ? "" : `<table>` + list.map((l) =>
    `<tr><td>${esc(l.name)}</td><td>left ${l.leaves} time(s)</td>
      <td>${l.left_s == null ? "" : `out for <strong class="left-since" data-since="${now - l.left_s * 1000}">${fmtSince(l.left_s)}</strong>
        <span class="muted">(since ${new Date(l.left_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })})</span>`}</td>
      <td><button class="small green" data-unlock="${l.student_id}">Unlock</button>
        <button class="small secondary" data-dismiss="${l.student_id}" title="Take him off this list: he stays locked (his answers stay frozen)">✕</button></td></tr>`).join("") + `</table>`) +
    (q.dismissed ? `<p class="muted" style="margin:4px 0 0">${q.dismissed} other locked student(s) taken off this list.</p>` : "");
  $("lockedList").querySelectorAll("[data-dismiss]").forEach((b) => b.onclick = () =>
    act("t_dismiss_locked", { p_quiz: q.id, p_student: b.dataset.dismiss === "all" ? null : b.dataset.dismiss }, "Taken off the list (still locked)."));
  $("lockedList").querySelectorAll("[data-unlock]").forEach((b) => b.onclick = () =>
    act("t_unlock", { p_quiz: q.id, p_student: b.dataset.unlock }, "Student unlocked."));
}

function fmtSince(sec) {
  sec = Math.max(0, Math.floor(sec));
  if (sec < 60) return sec + " s";
  const m = Math.floor(sec / 60);
  return m < 60 ? `${m} min ${String(sec % 60).padStart(2, "0")} s` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`;
}
setInterval(() => document.querySelectorAll(".left-since").forEach((el) => { el.textContent = fmtSince((Date.now() - Number(el.dataset.since)) / 1000); }), 1000);

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
  $("quizSelect").innerHTML = quizzes.map((q) => `<option value="${q.id}">[${KIND_LABEL[q.kind] || "Quiz"}${q.graded ? "" : ", not graded"}] ${esc(q.title)} (${q.pace === "self" ? "self-paced, " : ""}${q.lock_screen ? "" : "no lock, "}${q.per_student ? q.count + " q. per student from " + q.pool : q.count + " q."}, /${Number(q.total_points)}, ${q.status}, ${modeLabel[q.reveal_mode] || ""}${q.time_override ? ", " + q.time_override + " s each" : ""})</option>`).join("") ||
    `<option value="">- create a quiz below -</option>`;
  await loadTemplates();
}

// Accepted answer of a numeric question, as text: "3 (±5 %)", "10..40", "1:2; 2:2.24".
function numSpecText(q, forFile) {
  const sp = q.num_spec || {};
  if (sp.min !== undefined) return `${sp.min}..${sp.max}`;
  if (sp.variants) return Object.entries(sp.variants).map(([k, v]) => `${k}:${v}`).join("; ") + (forFile ? "" : ` (±${Number(q.tolerance)} %)`);
  return `${sp.value}` + (forFile ? "" : ` (±${Number(q.tolerance)} %)`);
}

const KIND_LABEL = { quiz: "Course quiz", test: "Test", tp: "TP test", survey: "Survey" };

const modulesOf = () => [...new Set(allQuestions.map((q) => q.module))].sort();
const chaptersOf = (m) => [...new Set(allQuestions.filter((q) => !m || q.module === m).map((q) => q.chapter))].sort();

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
    const pool = allQuestions.filter((q) => (!m || q.module === m) && (!c || q.chapter === c) && !chosen.includes(q.id) && !tplPicked.includes(q.id));
    const take = shuffled(pool).slice(0, n).map((q) => q.id);
    if (take.length < n) messages.push(`only ${take.length} available for ${m || "any module"} / ${c || "any chapter"}`);
    chosen.push(...take);
  });
  tplPicked = tplPicked.concat(chosen);
  renderTplPicked();
  if (pickBrowser) pickBrowser.render();
  toast(`${chosen.length} question(s) drawn and added.` + (messages.length ? " Note: " + messages.join("; ") : ""), messages.length ? "error" : "ok");
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
["quizKind", "quizPerStudent"].forEach((id) => { $(id).onchange = syncQuizOptions; });
// the lock follows the pace by default (live: locked, self-paced: free); the teacher can then change it
$("quizPace").onchange = () => { $("quizLock").checked = $("quizPace").value === "live"; syncQuizOptions(); };

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
$("quizAgainBtn").onclick = async () => {
  const q = selectedQuiz(); if (!q) return;
  let tpl = q.template_id;
  try {
    if (!tpl) tpl = await rpc("t_quiz_attach_template", { p_quiz: q.id, p_folder: "" });
    const id = await rpc("t_launch_template", { p_template: tpl, p_session: sessionId });
    await afterQuizChange("New run added and selected (the answers of the other run are kept). Click 1. Show the rules to run it.", id);
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
  const r = await confirmTyped({ title: "Delete this run", expected: q.title,
    message: q.answered ? `<strong>${q.answered}</strong> student(s) answered this run: their answers and marks are deleted for good.`
                        : "Nobody answered this run yet. The prepared quiz stays in the 📝 Quizzes tab." });
  if (!r) return;
  try { await rpc("t_quiz_delete", { p_quiz: q.id, p_confirm: q.title }); await afterQuizChange("Run deleted."); }
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

// The group chosen for the next opening, and the runs already done in this session.
function renderRuns() {
  const s = live.session, runs = live.runs || [], groups = sessionGroupNames();
  const sel = $("attGroup");
  sel.classList.toggle("hidden", groups.length === 0);
  if (groups.length && document.activeElement !== sel) {
    const done = new Set(runs.filter((r) => r.closed_at).map((r) => r.group));
    const key = sessionId + "|" + groups.join(",") + "|" + [...done].join(",") + "|" + s.attendance_open;
    if (sel.dataset.key !== key) {
      sel.innerHTML = `<option value="">${s.group ? esc(groupLabel(s.kind, s.group)) + " (group of the session)" : "Whole class"}</option>` +
        groups.map((g) => `<option value="${esc(g)}">${esc(groupLabel(s.kind, g))}${done.has(g) ? " ✓ done" : ""}</option>`).join("");
      // proposed: the group checking in now, else the first group not done yet (the teacher can choose another one)
      const next = s.attendance_open && live.run ? live.run.group : (groups.find((g) => !done.has(g)) ?? "");
      sel.value = groups.includes(next) ? next : "";
      sel.dataset.session = sessionId; sel.dataset.key = key;
    }
  }
  sel.disabled = !!s.attendance_open;
  $("runsBox").classList.toggle("hidden", runs.length === 0);
  const t = (x) => x ? new Date(x).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";
  $("runsBox").innerHTML = runs.length ? `<span class="muted">Check-ins of this session:</span> ` + runs.map((r) =>
    `<span class="run ${live.run && live.run.id === r.id && s.attendance_open ? "on" : ""}" title="${t(r.opened_at)}${r.closed_at ? "–" + t(r.closed_at) : " (open)"}">${esc(r.group ? groupLabel(s.kind, r.group) : "Whole class")}: <strong>${r.present}</strong>/${r.expected}</span>`).join(" ") : "";
  $("attScopeBox").classList.toggle("hidden", runs.length === 0 && !s.group);
}

// Students waiting for a decision in this session: another group, or another device (v24).
function renderLiveRequests() {
  const guests = live.guest_requests || [], devices = live.device_requests || [];
  const box = $("liveRequests");
  const key = JSON.stringify([guests, devices]);
  if (box.dataset.key === key) return;
  box.dataset.key = key;
  box.classList.toggle("hidden", guests.length + devices.length === 0);
  box.innerHTML = (guests.length ? `<strong>👥 ${guests.length} student(s) of another group want to join</strong>
      <table>${guests.map((g) => `<tr><td>${esc(g.name)}</td><td class="muted">${esc(g.matricule)} · group ${esc(g.group || "-")}</td>
        <td style="white-space:nowrap"><button class="small green" data-guest="${g.student_id}" data-ok="1">Let in</button> <button class="small secondary" data-guest="${g.student_id}" data-ok="0">Refuse</button></td></tr>`).join("")}</table>` : "") +
    (devices.length ? `<strong>📱 ${devices.length} device request(s)</strong>
      <table>${devices.map((d) => `<tr><td>${esc(d.name)}</td><td class="muted">${esc(d.matricule)} · ${d.kind === "session" ? "this " + esc(d.device_kind || "device") + ", for this session only" : "this " + esc(d.device_kind || "device") + " as his new class device"}</td>
        <td style="white-space:nowrap"><button class="small green" data-devreq="${d.id}" data-ok="1">Accept</button> <button class="small secondary" data-devreq="${d.id}" data-ok="0">Refuse</button></td></tr>`).join("")}</table>` : "");
  box.querySelectorAll("[data-guest]").forEach((b) => b.onclick = async () => {
    await act("t_handle_guest", { p_session: sessionId, p_student: b.dataset.guest, p_accept: b.dataset.ok === "1" }, b.dataset.ok === "1" ? "Student let in: marked present as a guest." : "Refused.");
    refreshAttendance();
  });
  box.querySelectorAll("[data-devreq]").forEach((b) => b.onclick = () =>
    act("t_handle_device_request", { p_id: Number(b.dataset.devreq), p_accept: b.dataset.ok === "1" }, b.dataset.ok === "1" ? "Device accepted." : "Refused."));
}

// ------------------------------------------------------------------ attendance list
// v28.1: one poller for the attendance list, only while the Live tab is shown. The table is rebuilt only when
// something changed, and never while the teacher is pressing a button in it (a click is never lost).
let attLastHtml = "", attPointerDown = false, attLastAt = 0, attHash = "", attForce = false;
const attendancePoll = poller(refreshAttendanceNow, 5000, () => !!sessionId && activeTab === "live");
function refreshAttendance() { return sessionId ? attendancePoll.run() : Promise.resolve(); }
$("attendanceTable").addEventListener("pointerdown", () => { attPointerDown = true; });
document.addEventListener("pointerup", () => { if (attPointerDown) { attPointerDown = false; } });
async function refreshAttendanceNow() {
  if (!sessionId) return;
  const sid = sessionId;
  let r;
  // v29: the server sends the list only when it changed (it compares with the hash of the list we have)
  try { r = await rpc("t_attendance_list_if", { p_session: sid, p_hash: attHash }); } catch (e) { return; }
  if (sid !== sessionId) return;
  attLastAt = Date.now();
  if (r.same && !attForce) return;
  attForce = false;
  if (!r.same) { attHash = r.hash; lastAttendance = r.list; }
  updateDrawInfo();
  renderAttendanceTable();
}
function renderAttendanceTable() {
  const list = lastAttendance;
  if (attPointerDown) { setTimeout(renderAttendanceTable, 300); return; }
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
  // v24: the list of a session with a group shows its students, and the guests of other groups (a search shows everybody)
  // v25: by default the group checking in now (current run); or the whole session; or the whole class
  const scope = $("attScopeBox").classList.contains("hidden") ? "session" : $("attScope").value;
  const expected = scope === "all" ? list : scope === "run" ? list.filter((r) => r.run_member || r.this_run) : list.filter((r) => r.member || r.status);
  const shown = term ? list.filter((r) => norm(r.name + " " + r.matricule).includes(term)) : expected;
  const far = enoughPositions ? list.filter((r) => checkLocation && r.distance > (CONFIG.farFromRoomM || 300)).length : 0;
  const html = (far ? `<p class="far">⚠ ${far} student(s) checked in far from the rest of the class.</p>` : "") +
    `<table><tr><th>Name</th><th>Matricule</th><th>Status</th><th></th>${checkLocation ? "<th>Position</th>" : ""}<th>Bonus ${SESSION_KIND[live && live.session.kind] || ""}</th></tr>` + shown.map((r) =>
    `<tr><td><button class="linklike" data-profile="${r.student_id}">${esc(r.name)}</button> ${r.official ? "" : '<span class="badge no">not in official list</span>'}${r.member ? "" : ` <span class="badge info">${r.status ? "guest" : "other group"}${r.tp_group || r.td_group ? " · " + esc(live && live.session.kind === "td" ? r.td_group : r.tp_group || r.td_group) : ""}</span>`}</td><td>${esc(r.matricule)}</td>
     <td><select data-student="${r.student_id}" style="width:auto">${opts.map((o) => `<option value="${o || "none"}" ${(r.status || "") === o ? "selected" : ""}>${o || "-"}</option>`).join("")}</select></td>
     <td class="muted">${r.method === "manual" ? "manual" : r.at ? new Date(r.at).toLocaleTimeString() : ""}</td>${checkLocation ? `<td>${place(r)}</td>` : ""}
     <td class="bonus-cell"><button class="small secondary" data-bonus="${r.student_id}" data-pts="-0.25">−</button>
       <strong>${Number(r.bonus) ? "+" + Number(r.bonus) : "0"}</strong>
       <button class="small green" data-bonus="${r.student_id}" data-pts="0.25">+0.25</button></td></tr>`).join("") + `</table>`;
  if (html === attLastHtml) return;        // nothing changed: the table (and the button under the mouse) stays
  attLastHtml = html;
  $("attendanceTable").innerHTML = html;
}
// v28.1: the bonus shows at once; the server is told in the background. Each click counts, even on a slow network.
$("attendanceTable").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-bonus]");
  if (!b) return;
  const id = b.dataset.bonus, pts = Number(b.dataset.pts);
  const row = lastAttendance.find((r) => r.student_id === id);
  if (row) row.bonus = Math.round((Number(row.bonus || 0) + pts) * 100) / 100;
  const cell = b.closest(".bonus-cell").querySelector("strong");
  if (cell && row) cell.textContent = Number(row.bonus) ? (row.bonus > 0 ? "+" : "") + Number(row.bonus) : "0";
  b.classList.add("pending");
  try {
    const total = await rpc("t_add_bonus", { p_session: sessionId, p_student: id, p_points: pts });
    toast(`Bonus ${SESSION_KIND[live && live.session.kind] || ""}: ${Number(total)} point(s) in total for this student.`, "ok");
  } catch (err) {
    if (row) row.bonus = Math.round((Number(row.bonus || 0) - pts) * 100) / 100;
    toast(err.message, "error");
  }
  b.classList.remove("pending");
  attLastHtml = "";
  refreshAttendance();
});
$("attendanceTable").addEventListener("change", async (e) => {
  const sel = e.target.closest("select[data-student]");
  if (!sel) return;
  const row = lastAttendance.find((r) => r.student_id === sel.dataset.student);
  if (row) row.status = sel.value === "none" ? null : sel.value;
  sel.blur();
  await act("t_set_attendance", { p_session: sessionId, p_student: sel.dataset.student, p_status: sel.value });
  attLastHtml = "";
  refreshAttendance();
});

$("attSearch").oninput = () => renderAttendanceTable();
$("attScope").onchange = () => renderAttendanceTable();

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
  if (!c || !can("students_edit")) return;
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
// The badge of the Students tab: everything that waits for the teacher there.
let pendingAttempts = 0, pendingDevices = 0, lockedPins = 0;
function updateStudentsBadge() {
  const n = pendingAttempts + pendingDevices + lockedPins;
  $("attemptBadge").textContent = n; $("attemptBadge").classList.toggle("hidden", !n);
  $("attemptBadge").title = `${pendingAttempts} not in the official list · ${pendingDevices} device request(s) · ${lockedPins} PIN locked`;
}
// Students who ask to use another device (v24).
async function loadDeviceRequests() {
  let list = [];
  if (classId) { try { list = await rpc("t_device_requests", { p_class: classId }); } catch (e) { list = []; } }
  pendingDevices = list.length;
  $("deviceReqCard").classList.toggle("hidden", !list.length);
  $("deviceReqCount").textContent = list.length || "";
  $("deviceReqTable").innerHTML = `<table><tr><th>Student</th><th>Matricule</th><th>Asks</th><th>When</th><th></th></tr>` + list.map((d) =>
    `<tr><td>${esc(d.name)}</td><td>${esc(d.matricule)}</td>
     <td>${d.kind === "session" ? `this ${esc(d.device_kind || "device")} for one session${d.session ? " (" + esc(d.session) + ")" : ""}` : `this ${esc(d.device_kind || "device")} as his new class device`}</td>
     <td>${new Date(d.at).toLocaleString()}</td>
     <td style="white-space:nowrap"><button class="small green" data-dracc="${d.id}">Accept</button> <button class="small secondary" data-drref="${d.id}">Refuse</button></td></tr>`).join("") + `</table>`;
  const handle = (attr, accept) => $("deviceReqTable").querySelectorAll(`[${attr}]`).forEach((b) => b.onclick = async () => {
    try { await rpc("t_handle_device_request", { p_id: Number(b.getAttribute(attr)), p_accept: accept }); toast(accept ? "Device accepted." : "Refused.", "ok"); loadStudents(); }
    catch (e) { toast(e.message, "error"); }
  });
  handle("data-dracc", true); handle("data-drref", false);
}

// People who tried to register and are not in the official list.
async function loadAttempts() {
  let list = [];
  try { list = await rpc("t_reg_attempts"); } catch (e) { return; }
  pendingAttempts = list.length;
  await loadDeviceRequests();
  updateStudentsBadge();
  $("attemptCount").textContent = list.length || "";
  $("attemptsCard").classList.toggle("hidden", !list.length);
  $("attemptsTable").innerHTML = `<table><tr><th>Matricule</th><th>Last name</th><th>First name</th><th>Tried</th><th>When</th><th></th></tr>` + list.map((a) =>
    `<tr><td>${esc(a.matricule)}</td><td>${esc(a.last_name)}</td><td>${esc(a.first_name)}</td><td>${a.class_id ? "in a session of " + esc(a.class_name) : "from the home page"}</td>
     <td>${new Date(a.at).toLocaleString()}</td>
     <td style="white-space:nowrap">${classId ? `<button class="small green" data-attadd="${a.id}">+ Add to ${esc(classNames[classId] || "this class")}</button>` : ""}
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

let stuGroupFilter = "", stuPicked = new Set();
async function loadStudents() {
  renderRegistration();
  loadAttempts();
  if (!classId) { $("studentsTable").innerHTML = ""; return; }
  const all = await rpc("t_list_students", { p_class: classId });
  const f = norm($("studentSearch").value);
  // v29: filter by group, tick students, move them to a group (or out of it)
  const allGroups = [...new Set(all.map((s) => s.td_group).concat(all.map((s) => s.tp_group)).filter(Boolean))].sort();
  if (stuGroupFilter && !allGroups.includes(stuGroupFilter) && stuGroupFilter !== "-") stuGroupFilter = "";
  const list = all.filter((s) => (!f || norm(`${s.matricule} ${s.last_name} ${s.first_name}`).includes(f))
    && (!stuGroupFilter || (stuGroupFilter === "-" ? !s.td_group && !s.tp_group : s.td_group === stuGroupFilter || s.tp_group === stuGroupFilter)));
  stuPicked = new Set([...stuPicked].filter((id) => all.some((s) => s.id === id)));
  const edit = can("students_edit");
  lockedPins = all.filter((s) => s.pin_locked).length;
  updateStudentsBadge();
  $("studentsTable").innerHTML = `<div class="row" style="gap:8px"><label style="margin:0">Group <select id="stuGroupFilter" style="width:auto">
      <option value="">all</option>${allGroups.map((g) => `<option value="${esc(g)}" ${g === stuGroupFilter ? "selected" : ""}>${esc(g)}</option>`).join("")}
      <option value="-" ${stuGroupFilter === "-" ? "selected" : ""}>without group</option></select></label>
      <span class="muted">${all.length} students${f || stuGroupFilter ? ` · ${list.length} shown` : ""} · ${list.filter((s) => s.registered).length} with a class device${lockedPins ? ` · <span class="badge no">${lockedPins} PIN locked</span>` : ""}</span></div>
    ${edit ? `<div class="bulk-bar"><strong id="stuSelCount">${stuPicked.size} ticked</strong>
      <input id="bulkGroup" list="bulkGroupList" placeholder="group, e.g. G11" style="width:150px"><datalist id="bulkGroupList">${allGroups.map((g) => `<option value="${esc(g)}">`).join("")}</datalist>
      <button class="small" data-bulk="td">→ TD group</button><button class="small" data-bulk="tp">→ TP sub-group</button>
      <button class="small secondary" data-bulk="out-td">Out of TD group</button><button class="small secondary" data-bulk="out-tp">Out of TP sub-group</button></div>` : ""}
    <table><tr>${edit ? `<th><input type="checkbox" class="stu-check" id="stuAll" title="Tick all shown"></th>` : ""}<th>Matricule</th><th>Last name</th><th>First name</th><th>TD</th><th>TP</th><th>E-mail</th><th>Official list</th><th>Class device</th><th></th></tr>` + list.map((s) =>
    `<tr data-id="${s.id}">${edit ? `<td><input type="checkbox" class="stu-check" data-pick="${s.id}" ${stuPicked.has(s.id) ? "checked" : ""}></td>` : ""}<td class="c-mat">${esc(s.matricule)}</td><td class="c-last"><button class="linklike" data-profile="${s.id}">${esc(s.last_name)}</button></td><td class="c-first">${esc(s.first_name)}</td><td class="c-td">${esc(s.td_group || "")}</td><td class="c-tp">${esc(s.tp_group || "")}</td>
     <td class="c-mail">${s.email ? `<a href="mailto:${esc(s.email)}">${esc(s.email)}</a>` : ""}</td>
     <td>${!edit ? (s.official ? "yes" : '<span class="badge no">no</span>') : `<button class="small ${s.official ? "green" : "red"}" data-official="${s.id}" data-val="${s.official ? 1 : 0}" title="Click to change">${s.official ? "✓ yes" : "✗ no"}</button>`}</td>
     <td>${s.registered ? `${esc(s.device_kind || "linked")}${s.device_linked_at ? ` <span class="muted" title="Linked on">${fmtWhen(s.device_linked_at)}</span>` : ""}` : (s.has_pin ? "PIN only" : "-")}${s.reset_allowed ? ' <span class="badge info">new device allowed</span>' : ""}${s.pin_locked ? ' <span class="badge no">PIN locked</span>' : ""}</td>
     <td style="white-space:nowrap"><button class="small secondary ${edit ? "" : "hidden"}" data-edit="${s.id}" title="Correct the student number or the name">✏ Edit</button>
       <button class="small red teacher-only" data-del="${s.id}">Delete</button>
       ${s.pin_locked ? `<button class="small green" data-unlockpin="${s.id}">Unlock PIN</button>` : ""}
       ${s.registered ? `<button class="small secondary" data-reset="${s.id}">Allow a new device</button>` : ""}
       ${s.registered || s.has_pin ? `<button class="small red" data-resetall="${s.id}" title="Erase the PIN and the class device of this student: he registers again">Reset PIN</button>` : ""}</td></tr>`).join("") + `</table>`;
  $("stuGroupFilter").onchange = () => { stuGroupFilter = $("stuGroupFilter").value; loadStudents(); };
  const countPicked = () => { if ($("stuSelCount")) $("stuSelCount").textContent = stuPicked.size + " ticked"; };
  $("studentsTable").querySelectorAll("[data-pick]").forEach((c) => c.onchange = () => { if (c.checked) stuPicked.add(c.dataset.pick); else stuPicked.delete(c.dataset.pick); countPicked(); });
  if ($("stuAll")) $("stuAll").onchange = () => {
    list.forEach((x) => { if ($("stuAll").checked) stuPicked.add(x.id); else stuPicked.delete(x.id); });
    $("studentsTable").querySelectorAll("[data-pick]").forEach((c) => { c.checked = stuPicked.has(c.dataset.pick); }); countPicked();
  };
  $("studentsTable").querySelectorAll("[data-bulk]").forEach((b) => b.onclick = async () => {
    if (!stuPicked.size) { toast("Tick the students first.", "error"); return; }
    const k = b.dataset.bulk, g = ($("bulkGroup").value || "").trim().toUpperCase();
    if ((k === "td" || k === "tp") && !g) { toast("Type the group first (e.g. G11).", "error"); $("bulkGroup").focus(); return; }
    const args = { p_class: classId, p_students: [...stuPicked], p_td: null, p_tp: null };
    if (k === "td") args.p_td = g; if (k === "tp") args.p_tp = g; if (k === "out-td") args.p_td = ""; if (k === "out-tp") args.p_tp = "";
    try { const r = await rpc("t_move_students", args); toast(`${r.updated} student(s) updated. Past attendance is not changed.`, "ok"); stuPicked = new Set(); await loadGroups(); loadStudents(); }
    catch (e) { toast(e.message, "error"); }
  });
  $("studentsTable").querySelectorAll("[data-unlockpin]").forEach((b) => b.onclick = async () => {
    try { await rpc("t_unlock_pin", { p_student: b.dataset.unlockpin }); toast("PIN unlocked: the student can sign in now.", "ok"); loadStudents(); }
    catch (e) { toast(e.message, "error"); }
  });
  $("studentsTable").querySelectorAll("[data-resetall]").forEach((b) => b.onclick = async () => {
    const tr = b.closest("tr");
    const name = tr.querySelector(".c-last").textContent.trim() + " " + tr.querySelector(".c-first").textContent;
    if (!confirm(`${name}: erase the PIN and the class device?\nUse it when somebody else registered with this student number, or when the PIN is forgotten.\nAttendance and answers are kept. The student registers again.`)) return;
    try { await rpc("t_reset_student", { p_student: b.dataset.resetall }); toast("PIN and class device erased. The student can register again.", "ok"); loadStudents(); }
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
    if (!confirm("Allow this student to link a new device (phone or computer)? The old one will stop working for attendance and quizzes.")) return;
    try { await rpc("t_allow_new_device", { p_student: b.dataset.reset }); toast("The next device he uses in class (after signing in with his PIN) becomes his class device.", "ok"); loadStudents(); }
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
    cell(".c-td").innerHTML = `<input class="e-td" value="${val(".c-td")}" style="width:70px">`;
    cell(".c-tp").innerHTML = `<input class="e-tp" value="${val(".c-tp")}" style="width:70px">`;
    cell(".c-mail").innerHTML = `<input class="e-mail" value="${val(".c-mail")}" style="width:190px" placeholder="e-mail">`;
    b.textContent = "Save"; b.className = "small green";
    b.onclick = async () => {
      try {
        await rpc("t_update_student", { p_student: b.dataset.edit, p_matricule: tr.querySelector(".e-mat").value,
          p_last_name: tr.querySelector(".e-last").value, p_first_name: tr.querySelector(".e-first").value });
        await rpc("t_set_student_groups", { p_student: b.dataset.edit, p_td: tr.querySelector(".e-td").value, p_tp: tr.querySelector(".e-tp").value });
        await rpc("t_set_student_email", { p_student: b.dataset.edit, p_email: tr.querySelector(".e-mail").value });
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
  else cols = studentColumnsOf(grid[headerRow] || []);
  const width = Math.max(0, ...grid.slice(0, 50).map((r) => r.length));
  const headers = Array.from({ length: width }, (_, i) => (grid[headerRow] || [])[i] || "");
  fillColumnSelect("stColMat", headers, cols.matricule, false);
  fillColumnSelect("stColLast", headers, cols.last_name, true);
  fillColumnSelect("stColFirst", headers, cols.first_name, true);
  fillColumnSelect("stColTd", headers, cols.td_group, true);
  fillColumnSelect("stColTp", headers, cols.tp_group, true);
  fillColumnSelect("stColMail", headers, cols.email, true);
  previewStudents();
}

function mappedStudents() {
  return studentsFromGrid(currentGrid(), Math.max(0, (parseInt($("stHeader").value, 10) || 1) - 1),
    parseInt($("stColMat").value, 10), parseInt($("stColLast").value, 10), parseInt($("stColFirst").value, 10),
    parseInt($("stColTd").value, 10), parseInt($("stColTp").value, 10), parseInt($("stColMail").value, 10));
}

function previewStudents() {
  const list = mappedStudents();
  $("stPreview").innerHTML = `<p><strong>${list.length}</strong> students found. First lines:</p>` +
    `<table><tr><th>Matricule</th><th>Last name</th><th>First name</th><th>TD group</th><th>TP sub-group</th><th>E-mail</th></tr>` +
    list.slice(0, 5).map((s) => `<tr><td>${esc(s.matricule)}</td><td>${esc(s.last_name)}</td><td>${esc(s.first_name)}</td>
      <td>${s.td_group === undefined ? '<span class="muted">not imported</span>' : esc(s.td_group)}</td><td>${s.tp_group === undefined ? '<span class="muted">not imported</span>' : esc(s.tp_group)}</td>
      <td>${s.email === undefined ? '<span class="muted">not imported</span>' : esc(s.email)}</td></tr>`).join("") + `</table>` +
    `<p class="muted">E-mails: an e-mail of the list fills an empty e-mail; the e-mail given by a student at his registration is kept.</p>`;
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
["stColMat", "stColLast", "stColFirst", "stColTd", "stColTp", "stColMail"].forEach((id) => { $(id).onchange = previewStudents; });

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
  if (!bankBrowser) bankBrowser = makeQuestionBrowser($("bankBrowser"), { mode: "bank" });
  if (showModule !== undefined) bankBrowser.show(showModule, "");
  bankBrowser.render();
}

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
  if (!classId || !can("docs_publish")) return;
  let docs = [];
  try { myDocuments = await rpc("t_list_documents"); docs = await rpc("t_list_docs", { p_class: classId }); }
  catch (e) { toast(e.message, "error"); return; }
  const inClass = new Set(docs.map((d) => d.doc_id).filter(Boolean));

  // documents of the class
  $("docsTable").innerHTML = docs.length === 0 ? `<p class="muted">No document yet for ${esc(classNames[classId] || "this class")}. Add one from the list below.</p>` :
    `<table><tr><th>Document</th><th>Type</th><th>Students see it</th><th>PDF download</th><th>Locked parts</th><th></th></tr>` + docs.map((d) =>
    `<tr><td>${d.doc_id ? `<a href="doc.html?preview=${d.doc_id}" target="_blank">${esc(d.title)}</a>` : `<a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a> <span class="muted">(link)</span>`}
        ${d.file_name ? `<span class="badge info">📎 ${esc(d.file_name)}</span>` : ""}</td><td>${DOC_KIND[d.kind] || d.kind}</td>
      <td><button class="small ${d.visible ? "green" : "secondary"}" data-dvis="${d.id}" data-val="${d.visible ? 1 : 0}">${d.visible ? "👁 visible" : "hidden"}</button></td>
      <td>${d.has_pdf ? `<button class="small ${d.allow_pdf ? "green" : "secondary"}" data-dpdf="${d.id}" data-val="${d.allow_pdf ? 1 : 0}">${d.allow_pdf ? "⬇ allowed" : "not allowed"}</button>` : '<span class="muted">no PDF</span>'}</td>
      <td>${d.parts ? `<button class="small ${d.unlocked ? "orange" : "secondary"}" data-dlocks="${d.id}" data-title="${esc(d.title)}">🔒 ${d.parts} part(s) · ${d.unlocked} opened</button>` : '<span class="muted">-</span>'}</td>
      <td><button class="small red" data-ddel="${d.id}">Remove</button></td></tr>`).join("") + `</table>`;
  $("docsTable").querySelectorAll("[data-dlocks]").forEach((b) => b.onclick = () => openLockPanel(b.dataset.dlocks, b.dataset.title, loadDocs));
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
  if (!classId || !can("docs_publish")) return;
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
  let split = null;
  if (html) {
    try { split = splitLockedParts(await readFileAs(html, "text")); }
    catch (e) { toast(e.message, "error"); return; }
    if (split.parts.length && pdf && !confirm(`This page has ${split.parts.length} locked part(s) (${split.parts.map((x) => x.label).join(", ")}).\n` +
      "The PDF is sent as it is: make sure it is the version WITHOUT these parts. Continue?")) return;
  }
  $("mdSaveBtn").disabled = true;
  try {
    const id = await rpc("t_save_document", { p_id: existing ? existing.id : null, p_title: title, p_kind: $("mdKind").value, p_module: $("mdModule").value.trim(),
      p_html: split ? split.html : null, p_pdf: pdf ? await readFileAs(pdf, "base64") : null,
      p_file: file ? await readFileAs(file, "base64") : null, p_file_name: file ? file.name : null });
    if (split) await rpc("t_set_doc_parts", { p_doc: id, p_parts: split.parts });
    toast((existing ? "Document replaced." : "Document saved. Click 'Add to this class', then make it visible.") +
      (split && split.parts.length ? ` ${split.parts.length} locked part(s): students see them only once you open them (🔒 button).` : ""), "ok");
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
// v29: assistants: a role (preset of permissions), then any permission ticked or unticked, and the groups he works with.
const PERM_GROUPS = [
  ["Types of sessions", [["kind_course", "Course sessions"], ["kind_td", "TD sessions"], ["kind_tp", "TP (lab) sessions"]]],
  ["Sessions and quizzes", [["sessions_create", "Create and edit sessions (of these types)"], ["quiz_prepare", "Prepare quizzes (of these types)"]]],
  ["Students", [["students_edit", "Edit students, groups, registration"], ["profiles", "Open the student profiles"]]],
  ["Results", [["results_view", "See the results"], ["results_export", "Download the results of a quiz (when the quiz allows it)"], ["export_all", "Export all the marks of the class (Excel)"], ["marks_edit", "Correct marks, fix a question, board check"]]],
  ["Documents", [["docs_view", "See the course content"], ["docs_publish", "Upload and publish documents (Student space)"], ["docs_unlock", "Open the locked parts of documents"]]],
  ["Messages", [["messages", "Write to the students"]]],
];
function roleSelect(cls, val, extra) {
  return `<select class="${cls}" ${extra || ""} style="width:auto">${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}" ${k === val ? "selected" : ""}>${v}</option>`).join("")}</select>`;
}
async function loadAssistants() {
  if (!classId || isAssistant()) return;
  let list = [], log = [], invites = [];
  try {
    [list, log, invites] = await Promise.all([rpc("t_list_assistants", { p_class: classId }), rpc("t_activity_log", { p_class: classId }), rpc("t_list_invites", { p_class: classId })]);
  } catch (e) { return; }
  $("assistantsTable").innerHTML = list.length === 0 ? `<p class="muted">No assistant for ${esc(classNames[classId] || "this class")}.</p>` :
    list.map((a) => `<div class="asst-card" data-user="${a.user_id}">
      <div class="row" style="justify-content:space-between"><strong>${esc(a.email)}</strong>
        <span>${roleSelect("a-role", a.role)} <input class="a-groups" value="${esc((a.groups || []).join(" "))}" placeholder="all groups" style="width:150px" title="Groups (empty = all), e.g. G11 G12">
        <button class="small secondary a-save-groups">Save groups</button>
        <button class="small red" data-arem="${a.user_id}" data-email="${esc(a.email)}">Remove</button></span></div>
      <div class="muted" style="font-size:12px">added ${new Date(a.added_at).toLocaleDateString()}</div>
      ${PERM_GROUPS.map(([title, perms]) => `<h4>${title}</h4><div class="perms">${perms.map(([k, label]) =>
        `<label><input type="checkbox" class="a-perm" value="${k}" ${(a.perms || []).includes(k) ? "checked" : ""}> ${label}</label>`).join("")}</div>`).join("")}
    </div>`).join("");
  const save = async (card, role, perms, quiet) => {
    const groups = card.querySelector(".a-groups").value.split(/[\s,;]+/).filter(Boolean);
    try { await rpc("t_set_assistant", { p_class: classId, p_user: card.dataset.user, p_role: role, p_perms: perms, p_groups: groups }); if (!quiet) toast("Saved.", "ok"); }
    catch (e) { toast(e.message, "error"); loadAssistants(); }
  };
  $("assistantsTable").querySelectorAll(".asst-card").forEach((card) => {
    const perms = () => [...card.querySelectorAll(".a-perm:checked")].map((c) => c.value);
    card.querySelectorAll(".a-perm").forEach((c) => c.onchange = () => save(card, card.querySelector(".a-role").value, perms(), true).then(() => toast("Permission " + (c.checked ? "given" : "removed") + ".", "ok")));
    card.querySelector(".a-role").onchange = async () => {
      if (!confirm(`Role: ${ROLE_LABEL[card.querySelector(".a-role").value]}. Tick the permissions of this role (the ones you changed are replaced)?`)) { loadAssistants(); return; }
      await save(card, card.querySelector(".a-role").value, null); loadAssistants();
    };
    card.querySelector(".a-save-groups").onclick = () => save(card, card.querySelector(".a-role").value, perms());
  });
  $("assistantsTable").querySelectorAll("[data-arem]").forEach((b) => b.onclick = async () => {
    if (!confirm(`Remove ${b.dataset.email} from the assistants of this class? (His activity log is kept.)`)) return;
    try { await rpc("t_remove_assistant", { p_class: classId, p_user: b.dataset.arem }); toast("Assistant removed.", "ok"); loadAssistants(); }
    catch (e) { toast(e.message, "error"); }
  });
  $("invitesTable").innerHTML = invites.length ? `<table><tr><th>Code</th><th>Role</th><th>Groups</th><th>Valid until</th><th></th></tr>` + invites.map((i) =>
    `<tr><td><strong style="font-size:18px;letter-spacing:2px">${esc(i.code)}</strong></td><td>${ROLE_LABEL[i.role] || esc(i.role)}</td><td>${esc((i.groups || []).join(", ") || "all")}</td>
      <td>${i.used_at ? `<span class="badge ok">used by ${esc(i.used_email || "")}</span>` : fmtWhen(i.expires_at)}</td>
      <td>${i.used_at ? "" : `<button class="small secondary" data-icopy="${esc(i.code)}">Copy</button> <button class="small red" data-icancel="${esc(i.code)}">Cancel</button>`}</td></tr>`).join("") + `</table>` : "";
  $("invitesTable").querySelectorAll("[data-icopy]").forEach((b) => b.onclick = async () => {
    const text = `ClassPulse — assistant of ${classNames[classId] || "my class"}\n${siteUrl("teacher.html")}\nInvitation code: ${b.dataset.icopy}`;
    try { await navigator.clipboard.writeText(text); toast("Copied: paste it in a message to the assistant.", "ok"); } catch (e) { prompt("Copy this:", text); }
  });
  $("invitesTable").querySelectorAll("[data-icancel]").forEach((b) => b.onclick = async () => {
    try { await rpc("t_cancel_invite", { p_code: b.dataset.icancel }); toast("Invitation cancelled.", "ok"); loadAssistants(); } catch (e) { toast(e.message, "error"); }
  });
  $("activityLog").innerHTML = log.length === 0 ? `<p class="muted">Nothing yet.</p>` :
    `<table><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr>` + log.map((l) =>
    `<tr><td style="white-space:nowrap">${new Date(l.at).toLocaleString()}</td><td>${esc(l.email || "")}</td><td>${esc(l.action)}</td><td>${esc(l.detail || "")}</td></tr>`).join("") + `</table>`;
}
$("addAssistantBtn").onclick = async () => {
  try {
    await rpc("t_add_assistant", { p_class: classId, p_email: $("assistantEmail").value, p_role: $("assistantRole").value });
    $("assistantEmail").value = "";
    toast("Assistant added: he logs in on this same page with his e-mail and password.", "ok");
    loadAssistants();
  } catch (e) { toast(e.message, "error"); }
};
$("inviteBtn").onclick = async () => {
  try {
    const r = await rpc("t_invite_assistant", { p_class: classId, p_role: $("inviteRole").value, p_perms: null,
      p_groups: $("inviteGroups").value.split(/[\s,;]+/).filter(Boolean) });
    toast(`Invitation code: ${r.code} (valid 14 days).`, "ok");
    loadAssistants();
  } catch (e) { toast(e.message, "error"); }
};
// Any account: join a class with an invitation code (Classes tab)
$("joinBtn").onclick = async () => {
  try {
    const r = await rpc("t_claim_invite", { p_code: $("joinCode").value });
    $("joinCode").value = "";
    toast(`You are now assistant of ${r.class_name}.`, "ok");
    await loadClasses(); await selectClass(r.class_id);
  } catch (e) { toast(e.message, "error"); }
};
$("logRefreshBtn").onclick = loadAssistants;

async function openProfile(studentId) {
  // v26: the lab assistants open the profile too, when the teacher allows it (Course content tab)
  try { profileData = await rpc("t_student_profile", { p_student: studentId }); } catch (e) { toast(e.message, "error"); return; }
  const p = profileData, st = p.student;
  const present = p.sessions.filter((x) => x.status === "present" || x.status === "late").length;
  const bonus = (cat) => { const b = p.bonus.find((x) => x.category === cat); return b ? Number(b.points) : 0; };
  $("profileTitle").textContent = `${st.last_name} ${st.first_name} · ${st.matricule}`;
  const grp = (label, v) => `<span class="badge ${v ? "info" : "closed"}">${label} ${v ? esc(v) : "none"}</span>`;
  $("profileBody").innerHTML = `<p class="muted">${esc(p.class)} · ${st.official ? "in the official list" : "NOT in the official list"} ·
      ${st.registered ? `class device: ${esc(st.device_kind || "linked")}${st.device_linked_at ? ", linked " + fmtWhen(st.device_linked_at) : ""}` : "no class device"}</p>
    <p class="profile-groups">${grp("TD group", st.td_group)} ${grp("TP sub-group", st.tp_group)}
      <span class="muted">E-mail:</span> <span id="profileEmail">${st.email ? `<a href="mailto:${esc(st.email)}">${esc(st.email)}</a>` : '<span class="muted">none</span>'}</span>
      <button class="small secondary" data-perm="students_edit" id="profileEmailEdit">✏</button></p>
    <div class="row" style="gap:30px;margin:10px 0">
      <div><div class="stat">${present} / ${p.sessions.length}</div><div class="muted">sessions attended</div></div>
      <div><div class="stat">${p.quizzes.filter((q) => q.graded && q.mark != null).length}</div><div class="muted">graded quizzes taken</div></div>
      <div><div class="stat">+${bonus("course")} / +${bonus("td")} / +${bonus("tp")}</div><div class="muted">bonus course / TD / TP</div></div>
    </div>
    <h3>Attendance</h3><table><tr><th>Date</th><th>Time</th><th>Type</th><th>Session</th><th>Status</th></tr>` +
    p.sessions.map((x) => `<tr><td>${x.date}</td><td>${x.time || ""}</td><td><span class="kind ${x.kind}">${SESSION_KIND[x.kind]}</span></td><td>${esc(x.title)}</td>
      <td>${x.status === "absent" ? '<span class="badge no">absent</span>' : x.status === "other group" ? '<span class="muted">- (not his group)</span>' : esc(x.status) + (x.guest ? ' <span class="badge info">with another group</span>' : "")}</td></tr>`).join("") + `</table>
    <h3 style="margin-top:14px">Quizzes and tests</h3><table><tr><th>Date</th><th>Type</th><th>Title</th><th>Mark</th><th>Board</th><th>Left the screen</th></tr>` +
    p.quizzes.map((q) => `<tr><td>${q.date}</td><td>${KIND_LABEL[q.kind] || q.kind}${q.graded ? "" : " (not graded)"}</td><td>${esc(q.title)}</td>
      <td>${q.kind === "survey" ? "-" : quizStatusCell(q)}
        ${q.kind !== "survey" && can("marks_edit") && q.status !== "other group" ? `<button class="small secondary" data-pmark="${q.quiz_id}" title="Correct this mark">✏</button>` : ""}</td>
      <td>${q.board ? (q.board.includes("->") ? `<span class="badge info">${esc(q.board)}</span>` : esc(q.board)) : ""}</td><td>${q.left_screen || ""}</td></tr>`).join("") + `</table>
    <h3 style="margin-top:14px">Documents (course notes, lab sheets, code)</h3>` + ((p.documents || []).filter((d) => d.stored).length === 0 ? `<p class="muted">No document in this class yet.</p>` :
    `<table><tr><th>Document</th><th>First opened</th><th>Last seen</th><th>Times opened</th><th>Reading time</th><th>Read up to</th><th>PDF downloaded</th><th>File downloaded</th></tr>` +
    p.documents.filter((d) => d.stored).map((d) => !d.opens && !d.pdf_count && !d.file_count
      ? `<tr><td>${esc(d.title)}</td><td colspan="7"><span class="badge no">never opened</span></td></tr>`
      : `<tr><td>${esc(d.title)}</td><td>${fmtWhen(d.first_open)}</td><td>${fmtWhen(d.last_seen)}</td><td>${d.opens}</td><td>${fmtDuration(d.active_s)}</td>
          <td>${d.scroll_pct} %</td><td>${fmtWhen(d.pdf_at)}</td><td>${fmtWhen(d.file_at)}</td></tr>`).join("") + `</table>`);
  $("profileBox").classList.remove("hidden");
  $("profileEmailEdit").onclick = async () => {
    const v = prompt(`E-mail of ${st.last_name} ${st.first_name} (empty = none):`, st.email || "");
    if (v === null) return;
    try { await rpc("t_set_student_email", { p_student: st.id, p_email: v }); toast("E-mail saved.", "ok"); openProfile(st.id); }
    catch (e) { toast(e.message, "error"); }
  };
}
$("profileBody").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-pmark]");
  if (!b || !profileData) return;
  const q = profileData.quizzes.find((x) => x.quiz_id === b.dataset.pmark), st = profileData.student;
  editMark({ quizId: q.quiz_id, title: q.title, total: q.total_points, studentId: st.id, name: `${st.last_name} ${st.first_name}`,
             mark: q.mark, computed: q.computed, corrected: q.corrected }, () => openProfile(st.id));
});
$("profileClose").onclick = () => $("profileBox").classList.add("hidden");
$("profileBox").onclick = (ev) => { if (ev.target === $("profileBox")) $("profileBox").classList.add("hidden"); };
$("profileExport").onclick = () => {
  const p = profileData, st = p.student;
  const wb = XLSX.utils.book_new();
  const a = [["Date", "Time", "Type", "Session", "Status"], ...p.sessions.map((x) => [x.date, x.time || "", SESSION_KIND[x.kind], x.title, x.status])];
  const q = [["Date", "Type", "Graded", "Title", "Mark", "Out of", "Left the screen"],
    ...p.quizzes.map((x) => [x.date, KIND_LABEL[x.kind], x.graded ? "yes" : "no", x.title,
      x.mark == null ? (x.status === "absent" || x.status === "no answer" ? 0 : x.status) : Number(x.mark), Number(x.total_points), x.left_screen || 0])];
  const b = [["Category", "Bonus points"], ...p.bonus.map((x) => [SESSION_KIND[x.category] || x.category, Number(x.points)])];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Name", "Matricule", "Class", "TD group", "TP sub-group", "E-mail"],
    [`${st.last_name} ${st.first_name}`, st.matricule, p.class, st.td_group || "", st.tp_group || "", st.email || ""]]), "Student");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(a), "Attendance");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(q), "Quizzes");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(b), "Bonus");
  XLSX.writeFile(wb, `ClassPulse_${st.matricule}_${st.last_name}.xlsx`.replace(/[^\w.-]+/g, "_"));
};

// ------------------------------------------------------------------ v25: course content and the lab assistants
const LEVEL = { none: "hidden", view: "read only", download: "read and download" };
function renderContent() {
  const cc = classContent;
  if (!cc) { $("contentTable").innerHTML = `<p class="muted">Choose a class.</p>`; return; }
  const teacher = cc.is_teacher;
  if (teacher) {
    if (document.activeElement !== $("caLevel")) $("caLevel").value = cc.access;
    $("caPrepublish").checked = !!cc.prepublish;
    loadAssistantRules();
  }
  const levelSelect = (kind, id, own) => `<select class="ca-item" data-kind="${kind}" data-id="${id}" style="width:auto">
      <option value="" ${!own ? "selected" : ""}>as the class (${LEVEL[cc.access]})</option>
      ${["none", "view", "download"].map((l) => `<option value="${l}" ${own === l ? "selected" : ""}>${LEVEL[l]}</option>`).join("")}</select>`;
  const openBtns = (row) => {
    if (teacher) return "";
    const b = [];
    if (row.type === "doc") {
      b.push(row.stored ? `<button class="small" data-cdoc="${row.id}">Open${row.level === "download" ? " / download" : ""}</button>` : `<button class="small" data-copen="${esc(row.url)}" data-what="${esc(row.title)}">Open</button>`);
    } else if (row.type === "res") {
      b.push(`<button class="small" data-cres="${row.id}" data-dl="0">Open</button>`);
      if (row.path && row.level === "download") b.push(`<button class="small secondary" data-cres="${row.id}" data-dl="1">⬇ Download</button>`);
    } else b.push(`<button class="small" data-copen="${esc(row.url)}" data-what="${esc(row.title)}">Open</button>`);
    return b.join(" ");
  };
  const rows = [];
  cc.docs.forEach((d) => rows.push({ type: "doc", id: d.id, title: d.title, what: DOC_KIND[d.kind] || "Document", module: d.module || "", stored: d.stored, url: d.url,
    level: d.level, own: d.own, own_pre: d.own_prepublish, published: d.published, parts: d.parts || 0, extra: [d.has_pdf ? "PDF" : "", d.file_name ? "📎 " + d.file_name : ""].filter(Boolean).join(" · ") }));
  cc.resources.forEach((r) => rows.push({ type: "res", id: r.id, title: r.title, what: r.kind === "file" ? "File" : "Link", module: r.module || "", url: r.url, path: r.storage_path, level: r.level, own: r.own }));
  cc.demos.forEach((d) => rows.push({ type: "demo", id: d.id, title: d.title, what: "Demo", module: d.module || "", url: demoPage(d.prefix, d.entry), level: d.level, own: d.own }));
  if (!rows.length) { $("contentTable").innerHTML = `<p class="muted">${teacher ? "No document, resource or demo yet." : "The teacher shares nothing with the assistants of this class for now."}</p>`; return; }
  const group = { doc: "Student space of this class", res: teacher ? "My resources (all my classes)" : "Resources of the teacher", demo: teacher ? "My demos (all my classes)" : "Demos of the teacher" };
  $("contentTable").innerHTML = ["doc", "res", "demo"].map((t) => {
    const list = rows.filter((r) => r.type === t);
    if (!list.length) return "";
    return `<h3>${group[t]}</h3><table><tr><th>Title</th><th>Type</th><th>Module</th>${t === "doc" ? "<th>Students</th>" : ""}<th>${teacher ? "Assistants" : "You may"}</th>${teacher && t === "doc" ? "<th>Before publication</th>" : ""}<th></th></tr>` +
      list.map((r) => `<tr><td>${esc(r.title)}${r.extra ? ` <span class="muted">${esc(r.extra)}</span>` : ""}</td><td>${esc(r.what)}</td><td>${esc(r.module)}</td>
        ${t === "doc" ? `<td>${r.published ? '<span class="badge ok">published</span>' : '<span class="badge closed">not published</span>'}</td>` : ""}
        <td>${teacher ? levelSelect(t === "doc" ? "doc" : t === "res" ? "resource" : "demo", r.id, r.own) : LEVEL[r.level]}</td>
        ${teacher && t === "doc" ? `<td>${r.published ? '<span class="muted">-</span>' : `<select class="ca-pre" data-id="${r.id}" style="width:auto">
            ${[["", `as the class (${cc.prepublish ? "shown" : "hidden"})`], ["1", "shown to the assistants"], ["0", "hidden until published"]].map(([v, l]) => {
              const cur = r.own_pre === true ? "1" : r.own_pre === false ? "0" : "";
              return `<option value="${v}" ${v === cur ? "selected" : ""}>${l}</option>`; }).join("")}</select>`}</td>` : ""}
        <td style="white-space:nowrap">${openBtns(r)}${r.type === "doc" && r.parts ? ` <button class="small orange" data-clocks="${r.id}" data-title="${esc(r.title)}">🔒 ${r.parts} locked part(s)</button>` : ""}</td></tr>`).join("") + `</table>`;
  }).join("");
  $("contentTable").querySelectorAll("[data-clocks]").forEach((b) => b.onclick = () => openLockPanel(b.dataset.clocks, b.dataset.title));
  // teacher: settings
  $("contentTable").querySelectorAll(".ca-item").forEach((sel) => sel.onchange = async () => {
    try {
      if (sel.dataset.kind === "doc") {
        const d = cc.docs.find((x) => x.id === sel.dataset.id);
        await rpc("t_set_doc_assistant", { p_doc: sel.dataset.id, p_access: sel.value, p_prepublish: d.own_prepublish });
      } else await rpc("t_set_item_assistant", { p_kind: sel.dataset.kind, p_id: sel.dataset.id, p_access: sel.value });
      toast("Saved.", "ok"); loadClassContentKeep();
    } catch (e) { toast(e.message, "error"); }
  });
  $("contentTable").querySelectorAll(".ca-pre").forEach((sel) => sel.onchange = async () => {
    const d = cc.docs.find((x) => x.id === sel.dataset.id);
    try { await rpc("t_set_doc_assistant", { p_doc: sel.dataset.id, p_access: d.own || "", p_prepublish: sel.value === "" ? null : sel.value === "1" }); toast("Saved.", "ok"); loadClassContentKeep(); }
    catch (e) { toast(e.message, "error"); }
  });
  // assistant: open
  $("contentTable").querySelectorAll("[data-copen]").forEach((b) => b.onclick = () => {
    rpc("a_log_open", { p_class: classId, p_what: b.dataset.what }).catch(() => {});
    window.open(b.dataset.copen, "_blank", "noopener");
  });
  $("contentTable").querySelectorAll("[data-cdoc]").forEach((b) => b.onclick = () => window.open("doc.html?assist=" + b.dataset.cdoc, "_blank"));
  $("contentTable").querySelectorAll("[data-cres]").forEach((b) => b.onclick = async () => {
    const r = cc.resources.find((x) => x.id === b.dataset.cres), dl = b.dataset.dl === "1";
    rpc("a_log_open", { p_class: classId, p_what: r.title + (dl ? " (download)" : "") }).catch(() => {});
    if (!r.storage_path) { window.open(new URL(r.url, location.href).href, "_blank", "noopener"); return; }
    const { data, error } = await db.storage.from(BUCKET).createSignedUrl(r.storage_path, 600, dl ? { download: true } : undefined);
    if (error) { toast("Cannot open the file: " + error.message, "error"); return; }
    window.open(data.signedUrl, "_blank", "noopener");
  });
}
async function loadClassContentKeep() {
  try { classContent = await rpc("a_class_content", { p_class: classId }); } catch (e) { return; }
  fillPushList();
  renderContent();
}
$("caLevel").onchange = async () => {
  try { await rpc("t_set_assistant_access", { p_class: classId, p_access: $("caLevel").value, p_prepublish: $("caPrepublish").checked }); toast("Saved for this class.", "ok"); loadClassContentKeep(); }
  catch (e) { toast(e.message, "error"); }
};
$("caPrepublish").onchange = $("caLevel").onchange;
// v26: what the assistants see of the results and of the student profiles
async function loadAssistantRules() {
  try {
    const r = await rpc("t_results_list", { p_class: classId });
    if (document.activeElement !== $("caResults")) $("caResults").value = r.class_rule || "view";
    if (document.activeElement !== $("caProfiles")) $("caProfiles").value = r.profile_rule || "view";
  } catch (e) { /* not the teacher */ }
}
$("caResults").onchange = $("caProfiles").onchange = async () => {
  try { await rpc("t_set_assistant_results", { p_class: classId, p_results: $("caResults").value, p_profiles: $("caProfiles").value }); toast("Saved for this class.", "ok"); }
  catch (e) { toast(e.message, "error"); }
};

// ------------------------------------------------------------------ v25: board check of a lab test
let boardQuiz = null, boardData = null;
async function openBoardCheck(quizId) {
  boardQuiz = quizId;
  try { boardData = await rpc("t_variant_check", { p_quiz: quizId }); } catch (e) { toast(e.message, "error"); return; }
  const q = boardData.quiz;
  $("boardTitle").textContent = "Board check · " + q.title;
  if (document.activeElement !== $("boardPenalty")) $("boardPenalty").value = Number(q.penalty || 0);
  $("boardPenaltyKind").value = q.penalty_kind || "points";
  renderBoardCheck();
  $("boardBox").classList.remove("hidden");
}
function penaltyText(p, kind, total) {
  p = Number(p || 0);
  if (!p) return "no penalty";
  return kind === "percent" ? `−${p} % (−${Math.round(p * total) / 100} pt)` : `−${p} pt`;
}
function renderBoardCheck() {
  const q = boardData.quiz, all = boardData.students;
  if (!q.boards.length) {
    $("boardBody").innerHTML = `<p class="far">This test has no numeric question with one value per board: nothing to check.</p>`;
    return;
  }
  const flagged = all.filter((r) => r.suspect), fixed = all.filter((r) => r.override != null);
  const shown = $("boardOnlySuspect").checked ? all.filter((r) => r.suspect || r.override != null) : all;
  const boardCells = (r) => q.boards.map((b) => {
    const n = r.by_board[String(b)] || 0;
    const cls = b === r.used ? "used" : b === r.best && r.suspect ? "best" : "";
    return `<td class="bcell ${cls}" title="Right answers with the values of board ${b}">${n}</td>`;
  }).join("");
  $("boardBody").innerHTML = `<p><strong>${flagged.length}</strong> student(s) flagged · <strong>${fixed.length}</strong> corrected ·
      ${all.length} student(s) answered · ${q.board_questions} question(s) depend on the board.</p>` +
    (shown.length === 0 ? `<p class="muted">Nobody to show. Untick "only the flagged students" to see everybody.</p>` :
    `<table class="board-table"><tr><th>Student</th><th>Sub-group</th><th>Typed</th>${q.boards.map((b) => `<th title="Right answers with board ${b}">B${b}</th>`).join("")}<th>Mark</th><th>Decision</th></tr>` +
    shown.map((r) => `<tr class="${r.suspect ? "suspect" : ""}"><td><button class="linklike" data-profile="${r.student_id}">${esc(r.name)}</button><div class="muted">${esc(r.matricule)}</div></td>
      <td>${esc(r.tp_group || "")}</td><td>${r.declared == null ? "-" : r.declared}${r.override != null ? ` <span class="badge info">→ ${r.override}</span>` : ""}</td>${boardCells(r)}
      <td>${r.mark == null ? "-" : Number(r.mark) + " / " + Number(q.total_points)}</td>
      <td style="white-space:nowrap">${r.override != null
        ? `<span class="muted">board ${r.override}, ${penaltyText(r.penalty, r.penalty_kind, q.total_points)}</span> <button class="small secondary" data-bundo="${r.student_id}">Undo</button>`
        : `<select class="bsel" data-student="${r.student_id}" style="width:auto">${q.boards.map((b) => `<option value="${b}" ${b === (r.suspect ? r.best : r.used) ? "selected" : ""}>board ${b}</option>`).join("")}</select>
           <button class="small ${r.suspect ? "orange" : "secondary"}" data-bfix="${r.student_id}">Recalculate</button>`}</td></tr>`).join("") + `</table>` +
    `<p class="muted">B1, B2…: number of right answers if the student had used the values of that board. Green: board used for his mark. Orange: board that fits better.</p>`);
  $("boardBody").querySelectorAll("[data-bfix]").forEach((b) => b.onclick = async () => {
    const id = b.dataset.bfix, board = Number($("boardBody").querySelector(`.bsel[data-student="${id}"]`).value);
    const r = all.find((x) => x.student_id === id);
    if (board === r.declared) { toast("This is the board he typed: nothing to correct.", "error"); return; }
    const pen = Number($("boardPenalty").value || 0), kind = $("boardPenaltyKind").value;
    const v = prompt(`${r.name}: recalculate with board ${board} (he typed ${r.declared}).\nPenalty (${kind === "percent" ? "% of the quiz scale" : "points of the quiz scale"}), 0 = none:`, String(pen));
    if (v === null) return;
    try {
      const res = await rpc("t_variant_override", { p_quiz: boardQuiz, p_student: id, p_board: board, p_penalty: Number(String(v).replace(",", ".")) || 0, p_kind: kind });
      toast(`Recalculated with board ${board}: new mark ${Number(res.mark)} / ${Number(q.total_points)}.`, "ok");
      openBoardCheck(boardQuiz);
    } catch (e) { toast(e.message, "error"); }
  });
  $("boardBody").querySelectorAll("[data-bundo]").forEach((b) => b.onclick = async () => {
    try { await rpc("t_variant_override", { p_quiz: boardQuiz, p_student: b.dataset.bundo, p_board: null }); toast("Back to the board he typed.", "ok"); openBoardCheck(boardQuiz); }
    catch (e) { toast(e.message, "error"); }
  });
}
$("quizBoardBtn").onclick = () => { const id = $("quizSelect").value || currentQuiz(); if (!id) { toast("Choose a quiz first.", "error"); return; } openBoardCheck(id); };
$("boardRefresh").onclick = () => openBoardCheck(boardQuiz);
$("boardClose").onclick = () => $("boardBox").classList.add("hidden");
$("boardBox").onclick = (ev) => { if (ev.target === $("boardBox")) $("boardBox").classList.add("hidden"); };
$("boardOnlySuspect").onchange = renderBoardCheck;
$("boardPenaltySave").onclick = async () => {
  try { await rpc("t_set_variant_penalty", { p_quiz: boardQuiz, p_penalty: Number($("boardPenalty").value || 0), p_kind: $("boardPenaltyKind").value }); toast("Default penalty saved for this test.", "ok"); }
  catch (e) { toast(e.message, "error"); }
};

// ------------------------------------------------------------------ export
$("exportBtn").onclick = async () => {
  if (!classId) return;
  try { downloadResults(await rpc("t_export", { p_class: classId })); }
  catch (e) { toast(e.message, "error"); }
};

init();

// v28.1: answer time of the server, shown at the bottom of the menu. Click: the details are copied (to send them).
setInterval(() => {
  const n = netSummary(120000), el = $("netInfo");
  if (!el || !n.count) return;
  el.textContent = `⏱ ${n.median} ms` + (n.inFlight > 2 ? ` · ${n.inFlight} waiting` : "");
  el.className = "net-info " + (n.median < 600 ? "ok" : n.median < 1500 ? "slow" : "bad");
}, 3000);
$("netInfo").onclick = async () => {
  const n = netSummary(600000);
  const text = "ClassPulse " + document.documentElement.dataset.version + " · " + new Date().toISOString() + " · " + navigator.userAgent + "\n" +
    `calls (10 min): ${n.count} · median ${n.median} ms · slowest ${n.max} ms · at the same time: max ${n.maxInFlight}\n` +
    n.perFunction.map((f) => `${f.fn}: ${f.n} × median ${f.median} ms, max ${f.max} ms`).join("\n");
  try { await navigator.clipboard.writeText(text); toast("Details copied: paste them in a message.", "ok"); }
  catch (e) { prompt("Copy these details:", text); }
};


// ------------------------------------------------------------------ v26: results of the finished quizzes
// The list of the finished quizzes of the class; one quiz in detail: success rate of each question, answers and mark
// of each student. The teacher corrects a mark (with a reason); the corrected mark is used everywhere.
const RES_LETTERS = "ABCDEFGH";
const RES_LEVEL = { none: "nothing", view: "read only", export: "read and download" };
const STATUS_TEXT = { "absent": "absent", "no answer": "present, no answer", "excused": "excused", "other group": "- (not his group)" };
let resultsList = null, resultsData = null;

// The mark cell of a quiz in the profile: mark, corrected mark, or why there is none.
function quizStatusCell(q) {
  if (q.mark != null) return `${Number(q.mark)} / ${Number(q.total_points)}` +
    (q.corrected ? ` <span class="badge info" title="Computed from the answers: ${q.computed == null ? "none" : Number(q.computed)}">corrected</span>` : "");
  if (q.status === "other group") return '<span class="muted">- (not his group)</span>';
  if (q.status === "excused") return '<span class="badge closed">excused</span>';
  return `<span class="badge no">${q.status === "absent" ? "absent" : "no answer"}</span> <span class="muted">(0)</span>`;
}

// Correct one mark: new mark (empty = back to the computed mark), then an optional reason.
async function editMark(m, after) {
  const total = Number(m.total);
  const v = prompt(`${m.name} · "${m.title}" (out of ${total})\nComputed from the answers: ${m.computed == null ? "no answer" : Number(m.computed)}\n\n` +
    `New mark (for example 3.5).\nLeave EMPTY to go back to the computed mark.`, m.corrected ? String(Number(m.mark)) : "");
  if (v === null) return;
  const raw = v.trim().replace(",", ".");
  let mark = null, reason = null;
  if (raw !== "") {
    mark = Number(raw);
    if (isNaN(mark) || mark < 0 || mark > total) { toast(`Type a number between 0 and ${total}.`, "error"); return; }
    reason = prompt("Reason (kept with the mark, optional):", "");
    if (reason === null) return;
  }
  try {
    await rpc("t_set_mark", { p_quiz: m.quizId, p_student: m.studentId, p_mark: mark, p_reason: reason });
    toast(mark === null ? "Back to the computed mark." : `Mark corrected: ${mark} / ${total}.`, "ok");
    if (after) after();
  } catch (e) { toast(e.message, "error"); }
}

async function loadResults() {
  $("resultsDetailCard").classList.add("hidden");
  $("resultsListCard").classList.remove("hidden");
  if (!classId) { $("resultsList").innerHTML = `<p class="muted">Choose a class.</p>`; return; }
  try { resultsList = await rpc("t_results_list", { p_class: classId }); } catch (e) { $("resultsList").innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  renderResultsList();
}
function renderResultsList() {
  const r = resultsList;
  if (!r) return;
  const f = norm($("resultsSearch").value);
  const list = r.quizzes.filter((q) => !f || norm(`${q.title} ${q.session} ${q.date} ${q.unit || ""}`).includes(f));
  if (!r.quizzes.length) { $("resultsList").innerHTML = `<p class="muted">No finished quiz in this class yet.</p>`; return; }
  const ruleSelect = (q) => `<select class="res-rule" data-id="${q.id}" style="width:auto;font-size:13px">
      <option value="" ${!q.own_rule ? "selected" : ""}>as the class (${RES_LEVEL[r.class_rule] || "read only"})</option>
      ${["none", "view", "export"].map((l) => `<option value="${l}" ${q.own_rule === l ? "selected" : ""}>${RES_LEVEL[l]}</option>`).join("")}</select>`;
  $("resultsList").innerHTML = `<table><tr><th>Date</th><th>Quiz</th><th>Type</th><th>Session</th><th>Answered</th><th>Mean</th>
      ${r.is_teacher ? "<th>Assistants</th>" : ""}<th></th></tr>` + list.map((q) => `<tr>
      <td style="white-space:nowrap">${esc(q.date)}${q.time ? " " + esc(q.time) : ""}</td>
      <td><strong>${esc(q.title)}</strong>${q.graded ? "" : ' <span class="muted">(not graded)</span>'}${q.empty ? ' <span class="badge no">empty: nobody answered</span>' : ""}
        ${q.corrected ? ` <span class="badge info">${q.corrected} corrected</span>` : ""}</td>
      <td>${KIND_LABEL[q.kind] || esc(q.kind)}${q.pace === "self" ? " · own pace" : ""}</td>
      <td>${esc(q.session)}${q.unit ? ` <span class="muted">(${esc(q.unit)})</span>` : ""}</td>
      <td>${q.answered} / ${q.expected}</td>
      <td>${q.mean == null || q.kind === "survey" ? "-" : `${Number(q.mean)} / ${Number(q.total_points)}`}</td>
      ${r.is_teacher ? `<td>${q.session_kind === "tp" ? ruleSelect(q) : '<span class="muted">teacher only</span>'}</td>` : ""}
      <td style="white-space:nowrap"><button class="small green" data-ropen="${q.id}">Open</button>
        ${r.is_teacher ? `<button class="small secondary" data-rren="${q.id}" title="Rename">✏</button> <button class="small red" data-rdel="${q.id}" title="Delete this run and its marks">🗑</button>` : ""}</td></tr>`).join("") + `</table>`;
  $("resultsList").querySelectorAll("[data-ropen]").forEach((b) => b.onclick = () => openResult(b.dataset.ropen));
  $("resultsList").querySelectorAll("[data-rdel]").forEach((b) => b.onclick = async () => {
    const q = r.quizzes.find((x) => x.id === b.dataset.rdel);
    const ok = await confirmTyped({ title: "Delete a quiz and its results", expected: q.title,
      message: q.empty ? `Nobody answered "${esc(q.title)}" (${esc(q.date)}).`
        : `<strong>${q.answered}</strong> student(s) answered "${esc(q.title)}" (${esc(q.date)}, ${esc(q.session)}). Their answers and marks are deleted for good: the marks disappear from the profiles and the Excel export.` });
    if (!ok) return;
    try { await rpc("t_quiz_delete", { p_quiz: q.id, p_confirm: q.title }); toast("Quiz and its results deleted.", "ok"); loadResults(); } catch (e) { toast(e.message, "error"); }
  });
  $("resultsList").querySelectorAll("[data-rren]").forEach((b) => b.onclick = async () => {
    const q = r.quizzes.find((x) => x.id === b.dataset.rren);
    const title = prompt("New title of this quiz (as shown in the results and the export):", q.title);
    if (title === null || !title.trim()) return;
    try { await rpc("t_quiz_rename", { p_quiz: q.id, p_title: title.trim() }); toast("Renamed.", "ok"); loadResults(); } catch (e) { toast(e.message, "error"); }
  });
  $("resultsList").querySelectorAll(".res-rule").forEach((sel) => sel.onchange = async () => {
    try { await rpc("t_set_quiz_assistant_results", { p_quiz: sel.dataset.id, p_level: sel.value }); toast("Saved for this quiz.", "ok"); }
    catch (e) { toast(e.message, "error"); }
  });
}
$("resultsSearch").oninput = renderResultsList;
$("resultsBack").onclick = () => { $("resultsDetailCard").classList.add("hidden"); $("resultsListCard").classList.remove("hidden"); loadResults(); };

// What a student answered to one question, as a short text: "B, C" or "3.2 V".
function answerText(qu, a) {
  if (!a) return "";
  if (qu.qtype === "number") return a.number == null ? "" : String(Number(a.number)) + (qu.unit ? " " + qu.unit : "");
  return (a.choice || []).map((i) => RES_LETTERS[i] || "?").join(", ");
}
function scoreClass(qu, a) {
  if (!a) return "";
  const pts = Number(qu.points);
  if (!(pts > 0)) return "res-neutral";
  return Number(a.score) >= pts ? "res-good" : Number(a.score) > 0 ? "res-part" : "res-bad";
}

async function openResult(quizId) {
  try { resultsData = await rpc("t_results_quiz", { p_quiz: quizId }); } catch (e) { toast(e.message, "error"); return; }
  renderResult();
  $("resultsListCard").classList.add("hidden");
  $("resultsDetailCard").classList.remove("hidden");
  window.scrollTo(0, 0);
}
function renderResult() {
  const d = resultsData, q = d.quiz, edit = d.level === "edit";
  $("resultsTitle").textContent = q.title;
  $("resultsExport").classList.toggle("hidden", !(edit || d.level === "export"));
  const qById = {};
  d.questions.forEach((qu) => { qById[qu.id] = qu; });
  const answeredSt = d.students.filter((s) => s.status === "answered");
  const marks = answeredSt.map((s) => Number(s.mark)).filter((x) => !isNaN(x));
  const mean = marks.length ? Math.round((marks.reduce((x, y) => x + y, 0) / marks.length) * 100) / 100 : null;
  const head = `<p class="muted">${esc(q.date)}${q.time ? " " + esc(q.time) : ""} · ${esc(q.session)}${q.unit ? " (" + esc(q.unit) + ")" : ""} ·
      ${KIND_LABEL[q.kind] || esc(q.kind)} · ${q.graded ? "marked out of " + Number(q.total_points) : "not graded"}${q.pace === "self" ? " · at own pace" : ""}
      ${q.per_student ? " · different questions for each student" : ""}</p>
    <div class="row" style="gap:30px;margin:8px 0 14px">
      <div><div class="stat">${answeredSt.length} / ${d.students.filter((s) => s.status !== "other group").length}</div><div class="muted">answered</div></div>
      <div><div class="stat">${mean == null || q.kind === "survey" ? "-" : mean + " / " + Number(q.total_points)}</div><div class="muted">mean mark</div></div>
      <div><div class="stat">${d.students.filter((s) => s.override != null).length}</div><div class="muted">corrected marks</div></div>
    </div>`;
  // ---- questions
  const qRows = d.questions.map((qu) => {
    const dist = qu.qtype === "choice" ? (qu.options || []).map((o, i) => `<span class="${(qu.correct || []).includes(i) ? "res-good" : ""}" title="${esc(o)}">${RES_LETTERS[i]}: ${(qu.counts || [])[i] || 0}</span>`).join(" ")
      : `<span class="muted">number${qu.unit ? " (" + esc(qu.unit) + ")" : ""}</span>`;
    const pct = qu.answers ? Math.round((100 * qu.full) / qu.answers) : null;
    const fixSel = edit ? `<select class="res-fix" data-q="${qu.id}" style="width:auto;font-size:12px">
        <option value="none" ${!qu.fix ? "selected" : ""}>as computed</option><option value="full" ${qu.fix === "full" ? "selected" : ""}>full points to all who answered</option>
        <option value="drop" ${qu.fix === "drop" ? "selected" : ""}>dropped (out of the mark)</option></select>` : (qu.fix ? `<span class="badge info">${qu.fix === "drop" ? "dropped" : "full points"}</span>` : "");
    return `<tr class="${qu.fix === "drop" ? "res-other" : ""}"><td>${qu.n}</td><td>${esc(qu.text)}${qu.ref ? ` <span class="muted">${esc(qu.ref)}</span>` : ""}<div>${fixSel}</div></td><td>${qu.answers}</td>
      <td>${pct == null ? "-" : `<span class="${pct >= 70 ? "res-good" : pct >= 40 ? "res-part" : "res-bad"}">${pct} %</span>`}</td>
      <td>${qu.avg_pct == null ? "-" : Number(qu.avg_pct) + " %"}</td><td class="res-dist">${dist}</td></tr>`;
  }).join("");
  // ---- students: one column per question (in the order of the quiz)
  const cols = d.questions;
  const sRows = d.students.map((s) => {
    const byQ = {};
    (s.answers || []).forEach((a) => { byQ[a.question_id] = a; });
    const markCell = s.status === "answered"
      ? `<strong>${s.mark == null ? "-" : Number(s.mark)}</strong>${s.override != null ? ` <span class="badge info" title="${esc((s.override_reason || "no reason") + " · " + (s.override_by || "") + " " + fmtWhen(s.override_at))}">corrected</span>` : ""}`
      : `<span class="muted">${STATUS_TEXT[s.status] || esc(s.status)}</span>`;
    return `<tr class="${s.status === "other group" ? "res-other" : ""}"><td><button class="linklike" data-profile="${s.id}">${esc(s.last_name)} ${esc(s.first_name)}</button>
        <div class="muted">${esc(s.matricule)}${s.tp_group ? " · " + esc(s.tp_group) : ""}</div>${makeupBadge(s.makeup)}</td>` +
      cols.map((qu) => { const a = byQ[qu.id]; return `<td class="${scoreClass(qu, a)}" title="${a ? "score " + Number(a.score) + " / " + Number(qu.points) : "no answer"}">${esc(answerText(qu, a))}</td>`; }).join("") +
      `<td>${s.points == null ? "" : Number(s.points)}</td>
       <td>${s.computed == null ? "" : Number(s.computed)}</td>
       <td>${markCell}</td>
       <td>${s.left_screen || ""}${s.locked ? ' <span class="badge no">locked</span>' : ""}${awayText(s.away, q)}</td>
       <td>${s.submitted_at ? fmtWhen(s.submitted_at) : ""}${s.board != null ? `<div class="muted">board ${s.board}${s.board_used != null ? " → " + s.board_used : ""}</div>` : ""}</td>
       <td style="white-space:nowrap">${edit && s.status !== "other group" ? `<button class="small secondary" data-rmark="${s.id}" title="Correct this mark">✏ Mark</button>` : ""}
         ${edit && s.override != null ? `<button class="small secondary" data-rundo="${s.id}" title="Back to the computed mark">↺</button>` : ""}
         ${edit && s.submitted_at && q.status !== "finished" ? `<button class="small secondary" data-rreopen="${s.id}">Let him change</button>` : ""}</td></tr>`;
  }).join("");
  $("resultsDetail").innerHTML = head +
    (edit && q.ask_variant ? `<p><button class="small secondary" id="resBoardBtn">🔢 Board check</button></p>` : "") +
    (edit && q.status === "finished" ? `<p><button class="small orange" id="resMakeupBtn">📝 Make-up for late or cut-off students…</button></p><div id="makeupPanel"></div>` : "") +
    `<h3>Questions</h3><div class="table-scroll"><table><tr><th>#</th><th>Question</th><th>Answers</th><th>Full marks</th><th>Average score</th><th>Choices (✓ in green)</th></tr>${qRows}</table></div>
    <h3 style="margin-top:14px">Students</h3>
    <p class="muted">Cells: the letters chosen (or the number typed). Green = full marks, orange = part of the points, red = 0. Hover a cell for its score.
      <em>Computed</em> = mark from the answers (penalty of a board correction included); <em>Mark</em> = the mark used everywhere.</p>
    <div class="table-scroll"><table class="res-students"><tr><th>Student</th>${cols.map((qu) => `<th title="${esc(qu.text)}">Q${qu.n}</th>`).join("")}
      <th>Points</th><th>Computed</th><th>Mark /${Number(q.total_points)}</th><th>Left</th><th>Handed in</th><th></th></tr>${sRows}</table></div>`;
  const stOf = (id) => d.students.find((x) => x.id === id);
  const reload = () => openResult(q.id);
  $("resultsDetail").querySelectorAll("[data-rmark]").forEach((b) => b.onclick = () => {
    const s = stOf(b.dataset.rmark);
    editMark({ quizId: q.id, title: q.title, total: q.total_points, studentId: s.id, name: `${s.last_name} ${s.first_name}`,
               mark: s.mark, computed: s.computed, corrected: s.override != null }, reload);
  });
  $("resultsDetail").querySelectorAll("[data-rundo]").forEach((b) => b.onclick = async () => {
    if (!confirm("Go back to the mark computed from the answers?")) return;
    try { await rpc("t_set_mark", { p_quiz: q.id, p_student: b.dataset.rundo, p_mark: null, p_reason: null }); toast("Back to the computed mark.", "ok"); reload(); }
    catch (e) { toast(e.message, "error"); }
  });
  $("resultsDetail").querySelectorAll("[data-rreopen]").forEach((b) => b.onclick = async () => {
    try { await rpc("t_reopen_submission", { p_quiz: q.id, p_student: b.dataset.rreopen }); toast("The student can change his answers again.", "ok"); reload(); }
    catch (e) { toast(e.message, "error"); }
  });
  if ($("resBoardBtn")) $("resBoardBtn").onclick = () => openBoardCheck(q.id);
  if ($("resMakeupBtn")) $("resMakeupBtn").onclick = () => openMakeupPanel(q.id, reload);
  // v27: a badly worded question: dropped for everybody, or full points to everybody who answered it
  $("resultsDetail").querySelectorAll(".res-fix").forEach((sel) => sel.onchange = async () => {
    const what = { none: "back to the computed scores", full: "full points to every student who answered it", drop: "dropped: out of the mark of every student" }[sel.value];
    if (!confirm(`Question: ${what}?\nThe marks of the whole quiz are recomputed (profiles, averages, export).`)) { reload(); return; }
    try { await rpc("t_fix_question", { p_quiz: q.id, p_question: sel.dataset.q, p_mode: sel.value }); toast("Marks recomputed.", "ok"); reload(); }
    catch (e) { toast(e.message, "error"); reload(); }
  });
}

// Excel file of one quiz: marks, answers, questions.
$("resultsExport").onclick = () => {
  const d = resultsData, q = d.quiz;
  if (!d) return;
  const qById = {};
  d.questions.forEach((qu) => { qById[qu.id] = qu; });
  const wb = XLSX.utils.book_new();
  const marks = [["Matricule", "Last name", "First name", "TD group", "TP group", "Status", "Points", "Computed mark", `Mark /${Number(q.total_points)}`, "Corrected", "Reason", "Left the screen", "Handed in"]];
  d.students.forEach((s) => marks.push([s.matricule, s.last_name, s.first_name, s.td_group || "", s.tp_group || "", s.status,
    s.points == null ? "" : Number(s.points), s.computed == null ? "" : Number(s.computed),
    s.status === "answered" ? (s.mark == null ? "" : Number(s.mark)) : (s.status === "absent" || s.status === "no answer" ? 0 : ""),
    s.override != null ? "yes" : "", s.override_reason || "", s.left_screen || 0, s.submitted_at ? fmtWhen(s.submitted_at) : ""]));
  const ans = [["Matricule", "Last name", "First name", "Question", "Ref", "Answer", "Score", "Out of"]];
  d.students.forEach((s) => (s.answers || []).forEach((a) => {
    const qu = qById[a.question_id] || {};
    ans.push([s.matricule, s.last_name, s.first_name, qu.n || "", qu.ref || "", answerText(qu, a), Number(a.score), Number(qu.points || 0)]);
  }));
  const qs = [["#", "Ref", "Question", "Answers", "Full marks", "Full marks %", "Average score %", "Correct"]];
  d.questions.forEach((qu) => qs.push([qu.n, qu.ref || "", qu.text, qu.answers, qu.full, qu.answers ? Math.round((100 * qu.full) / qu.answers) : "",
    qu.avg_pct == null ? "" : Number(qu.avg_pct), qu.qtype === "choice" ? (qu.correct || []).map((i) => RES_LETTERS[i]).join(", ") : "number"]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(marks), "Marks");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ans), "Answers");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(qs), "Questions");
  XLSX.writeFile(wb, `ClassPulse_${q.date}_${q.title}.xlsx`.replace(/[^\w.-]+/g, "_"));
};

// ------------------------------------------------------------------ v27: messages
// Teacher -> students (class, group, chosen students), students -> teacher (private), teacher <-> lab assistants.
let msgData = null;            // last t_messages result
let msgStudents = [];          // students of the class (picker)
let msgPicked = new Set();     // chosen student ids
let msgReplyTo = null;         // id of the message answered by the compose card
let staffReplyTo = null;

function msgWhen(t) { return t ? new Date(t).toLocaleString([], { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }) : ""; }
function msgBodyHtml(text) { return esc(text || "").replace(/\n/g, "<br>"); }
function msgDocLink(m) {
  return m.doc ? `<div style="margin-top:4px">📄 <a href="doc.html?d=${m.doc.id}&c=${m.class_id}" target="_blank" rel="noopener">${esc(m.doc.title || "document")}</a></div>` : "";
}

async function loadMessages() {
  if (!classId) { $("mailList").innerHTML = ""; return; }
  const teacher = can("messages");
  const cid = classId;
  try {
    // v28.1: the lists are asked at the same time (one wait instead of three). v29: no message in them (light).
    const [m, studs, docs] = await Promise.all([rpc("t_msg_meta", { p_class: cid }),
      teacher ? rpc("t_list_students", { p_class: cid }) : null, teacher && can("docs_publish") ? rpc("t_list_docs", { p_class: cid }) : []]);
    if (cid !== classId) return;
    msgData = m;
    if (teacher) {
      msgStudents = studs;
      const keep = $("msgDoc").value;
      $("msgDoc").innerHTML = `<option value="">none</option>` +
        docs.filter((d) => d.visible).map((d) => `<option value="${d.id}">${esc(d.title)}</option>`).join("");
      if ([...$("msgDoc").options].some((o) => o.value === keep)) $("msgDoc").value = keep;
    }
  } catch (e) { toast(e.message, "error"); return; }
  msgPicked = new Set([...msgPicked].filter((id) => msgStudents.some((s) => s.id === id)));
  fillMsgGroups();
  renderMsgPick();
  renderStaffCard();
  await loadMailList(true);
  updateMsgBadge();
}

function fillMsgGroups() {
  const groups = [...new Set(classGroups.td.concat(classGroups.tp))];
  const keep = $("msgGroup").value;
  $("msgGroup").innerHTML = groups.length ? groups.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join("")
                                          : `<option value="">no group in the student list</option>`;
  if (groups.includes(keep)) $("msgGroup").value = keep;
}

function syncMsgKind() {
  const k = $("msgKind").value;
  $("msgGroup").classList.toggle("hidden", k !== "group");
  $("msgPick").classList.toggle("hidden", k !== "students");
}
$("msgKind").onchange = syncMsgKind;
$("msgPickSearch").oninput = () => renderMsgPick();

function renderMsgPick() {
  const f = $("msgPickSearch").value.trim().toLowerCase();
  const list = msgStudents.filter((s) => !f || `${s.last_name} ${s.first_name} ${s.matricule}`.toLowerCase().includes(f) || msgPicked.has(s.id));
  $("msgPickList").innerHTML = list.slice(0, 80).map((s) => `<label class="pick-item"><input type="checkbox" data-mpick="${s.id}" ${msgPicked.has(s.id) ? "checked" : ""}>
      ${esc(s.last_name)} ${esc(s.first_name)} <span class="muted">${esc(s.matricule)}${s.td_group ? " · " + esc(s.td_group) : ""}${s.tp_group ? " · " + esc(s.tp_group) : ""}</span></label>`).join("")
    + (list.length > 80 ? `<p class="muted">… ${list.length - 80} more: refine the search.</p>` : "");
  $("msgPickList").querySelectorAll("[data-mpick]").forEach((c) => c.onchange = () => {
    if (c.checked) msgPicked.add(c.dataset.mpick); else msgPicked.delete(c.dataset.mpick);
    $("msgPickCount").textContent = `${msgPicked.size} student(s) chosen`;
  });
  $("msgPickCount").textContent = `${msgPicked.size} student(s) chosen`;
}
// v29: an assistant limited to some groups writes only to them (the server checks it too)

function renderStaffCard() {
  const teacher = msgData && msgData.is_teacher;
  const assistants = (msgData && msgData.assistants) || [];
  if (teacher) {
    $("staffTitle").textContent = "Assistants of this class";
    $("staffTo").innerHTML = assistants.length
      ? `<option value="">all the assistants (${assistants.length})</option>` + assistants.map((a) => `<option value="${a.user_id}">${esc(a.email)}</option>`).join("")
      : `<option value="">no assistant in this class</option>`;
    $("staffCard").classList.toggle("hidden", !assistants.length);
  } else {
    $("staffTitle").textContent = "Write to the teacher of this class";
    $("staffTo").innerHTML = `<option value="">the teacher</option>`;
    $("staffCard").classList.remove("hidden");
  }
}

// ---- v29: mailbox. One line per message (who, subject, start of the text, date); a click opens it in full.
let mailBox = "inbox", mailItems = [], mailTotal = 0, mailOpen = null, mailSearchTimer = null;
async function loadMailList(reset) {
  if (!classId) return;
  const cid = classId;
  let r;
  try { r = await rpc("t_msg_list", { p_class: cid, p_box: mailBox, p_search: $("mailSearch").value.trim() || null, p_offset: reset ? 0 : mailItems.length }); }
  catch (e) { toast(e.message, "error"); return; }
  if (cid !== classId) return;
  mailItems = reset ? r.items : mailItems.concat(r.items);
  mailTotal = r.total;
  if (reset) mailOpen = null;
  renderMailList();
}
function renderMailList() {
  const sent = mailBox === "sent";
  $("mailBoxes").querySelectorAll("[data-box]").forEach((b) => { b.className = "small " + (b.dataset.box === mailBox ? "" : "secondary"); });
  const unread = mailBox === "inbox" ? mailItems.filter((m) => !m.read).length : 0;
  $("msgUnread").textContent = unread ? `${unread} new` : ""; $("msgUnread").classList.toggle("hidden", !unread);
  $("mailList").innerHTML = mailItems.length ? mailItems.map((m) => `<div class="mail-row ${!sent && !m.read ? "unread" : ""}" data-mid="${m.id}">
      <button class="star" data-mstar="${m.id}" title="${m.starred ? "Unstar" : "Star"}">${m.starred ? "★" : "☆"}</button>
      <span class="who">${sent ? "To: " + esc(m.to || "") : (m.from_kind === "student" ? "👤 " : "🧑‍🏫 ") + esc(m.from || "")}</span>
      <span class="what">${esc(m.subject || "(no subject)")} <span class="snip">— ${esc(m.snippet || "")}</span>${m.has_doc ? " 📄" : ""}</span>
      <span class="when">${msgWhen(m.at)}${sent ? ` · read ${m.read_by}/${m.recipients}` : ""}</span></div>
      ${mailOpen && mailOpen.id === m.id ? `<div class="mail-open" id="mailOpen">${mailOpenHtml(mailOpen, sent)}</div>` : ""}`).join("")
    : `<p class="muted" style="padding:8px">${{ inbox: "No message received.", starred: "No starred message.", archived: "No archived message.", sent: "No message sent." }[mailBox]}</p>`;
  $("mailCount").textContent = mailTotal ? `${mailItems.length} / ${mailTotal}` : "";
  $("mailMore").classList.toggle("hidden", mailItems.length >= mailTotal);
  $("mailList").querySelectorAll(".mail-row").forEach((row) => row.onclick = (e) => { if (!e.target.closest("[data-mstar]")) openMail(Number(row.dataset.mid)); });
  $("mailList").querySelectorAll("[data-mstar]").forEach((b) => b.onclick = () => {
    const m = mailItems.find((x) => x.id === Number(b.dataset.mstar));
    flagMail(m, m.starred ? "unstar" : "star");
  });
  if (mailOpen) bindMailOpen(sent);
}
function mailOpenHtml(m, sent) {
  return `<div class="msg-head"><span>${sent ? "To: " + esc(m.to_name || m.target || "") : esc(m.from || "")}${m.from_matricule ? ` <span class="muted">${esc(m.from_matricule)}</span>` : ""}</span><span class="muted">${msgWhen(m.at)}</span></div>
    ${m.subject ? `<div class="msg-subject">${esc(m.subject)}</div>` : ""}<div class="msg-body">${msgBodyHtml(m.body)}</div>${msgDocLink(m)}
    <div class="msg-actions">${sent ? "" : `<button class="small" data-mact="reply">Reply</button>`}
      ${mailBox === "archived" ? `<button class="small secondary" data-mact="unarchive">Back to Received</button>` : sent ? "" : `<button class="small secondary" data-mact="archive">🗄 Archive</button>`}
      ${sent ? "" : `<button class="small secondary" data-mact="unread">Mark as unread</button>`}
      <button class="small red" data-mact="delete">Delete</button></div>`;
}
function bindMailOpen(sent) {
  const box = $("mailOpen");
  if (!box) return;
  box.querySelectorAll("[data-mact]").forEach((b) => b.onclick = async () => {
    const act = b.dataset.mact, m = mailItems.find((x) => x.id === mailOpen.id);
    if (act === "reply") { if (!mailOpen.loading) replyTo(mailOpen); return; }
    if (act === "delete" && !confirm("Delete this message? (Only for you: the others keep it.)")) return;
    await flagMail(m, act);
  });
}
async function openMail(id) {
  if (mailOpen && mailOpen.id === id) { mailOpen = null; renderMailList(); return; }
  const m = mailItems.find((x) => x.id === id);
  // shown at once (read, start of the text), the full text follows
  mailOpen = { id, loading: true, from: m && m.from, to_name: m && m.to, subject: m && m.subject, body: (m && m.snippet || "") + " …", at: m && m.at };
  if (m && !m.read && mailBox !== "sent") m.read = true;
  renderMailList();
  let full;
  try { full = await rpc("t_msg_get", { p_id: id }); } catch (e) { toast(e.message, "error"); return; }
  if (!mailOpen || mailOpen.id !== id) return;
  mailOpen = full;
  renderMailList();
  updateMsgBadge();
}
// star | unstar | archive | unarchive | delete | unread: shown at once, the server is told in the background
async function flagMail(m, action) {
  if (!m) return;
  const before = Object.assign({}, m);
  if (action === "star") m.starred = true;
  if (action === "unstar") m.starred = false;
  if (action === "unread") { m.read = false; mailOpen = null; }
  const leaves = ["archive", "unarchive", "delete"].includes(action) || (mailBox === "starred" && action === "unstar");
  if (leaves) { mailItems = mailItems.filter((x) => x !== m); mailTotal = Math.max(0, mailTotal - 1); if (mailOpen && mailOpen.id === m.id) mailOpen = null; }
  renderMailList();
  try { await rpc("t_msg_flag", { p_id: m.id, p_action: action }); }
  catch (e) { Object.assign(m, before); toast(e.message, "error"); loadMailList(true); return; }
  if (action === "archive") toast("Archived (folder 🗄 Archived).", "ok");
  updateMsgBadge();
}
$("mailBoxes").querySelectorAll("[data-box]").forEach((b) => b.onclick = () => { mailBox = b.dataset.box; loadMailList(true); });
$("mailMore").onclick = () => loadMailList(false);
$("mailSearch").oninput = () => { clearTimeout(mailSearchTimer); mailSearchTimer = setTimeout(() => loadMailList(true), 400); };

function replySubject(m) { const s = m.subject || ""; return /^re:/i.test(s) ? s : ("Re: " + (s || "your message")).slice(0, 200); }

function replyTo(m) {
  if (!m) return;
  if (m.from_kind === "student") {
    // answer one student: compose card, that student only
    $("msgKind").value = "students"; syncMsgKind();
    msgPicked = new Set([m.from_student]);
    $("msgPickSearch").value = "";
    renderMsgPick();
    $("msgSubject").value = replySubject(m);
    msgReplyTo = m.id;
    $("msgReplyNote").textContent = `Answer to ${m.from}.`;
    $("msgComposeCard").scrollIntoView({ behavior: "smooth" });
    $("msgBody").focus();
  } else {
    // staff: the teacher answers the assistant, the assistant answers the teacher
    if (msgData.is_teacher && [...$("staffTo").options].some((o) => o.value === m.from_user)) $("staffTo").value = m.from_user;
    $("staffSubject").value = replySubject(m);
    staffReplyTo = m.id;
    $("staffReplyNote").textContent = `Answer to ${m.from}.`;
    $("staffCard").scrollIntoView({ behavior: "smooth" });
    $("staffBody").focus();
  }
}

$("msgSendBtn").onclick = async () => {
  const kind = $("msgKind").value;
  if (kind === "students" && !msgPicked.size) { toast("Choose at least one student.", "error"); return; }
  if (kind === "group" && !$("msgGroup").value) { toast("No group to choose: import the groups with the student list.", "error"); return; }
  const what = kind === "class" ? "the whole class" : kind === "group" ? "group " + $("msgGroup").value : `${msgPicked.size} student(s)`;
  if (kind !== "students" && !confirm(`Send this message to ${what}?`)) return;
  $("msgSendBtn").disabled = true;
  try {
    const r = await rpc("t_send_message", {
      p_class: classId, p_kind: kind, p_group: kind === "group" ? $("msgGroup").value : null,
      p_students: kind === "students" ? [...msgPicked] : null, p_subject: $("msgSubject").value, p_body: $("msgBody").value,
      p_doc: $("msgDoc").value || null, p_reply_to: msgReplyTo });
    toast(`Message sent to ${r.recipients} student(s).`, "ok");
    $("msgSubject").value = ""; $("msgBody").value = ""; $("msgDoc").value = "";
    msgReplyTo = null; $("msgReplyNote").textContent = "";
    if (kind === "students") { msgPicked = new Set(); renderMsgPick(); }
    await loadMessages();
  } catch (e) { toast(e.message, "error"); }
  $("msgSendBtn").disabled = false;
};

$("staffSendBtn").onclick = async () => {
  $("staffSendBtn").disabled = true;
  try {
    const r = await rpc("t_send_staff", { p_class: classId, p_to: $("staffTo").value || null, p_subject: $("staffSubject").value,
      p_body: $("staffBody").value, p_reply_to: staffReplyTo });
    toast(r.recipients > 1 ? `Message sent to ${r.recipients} assistants.` : "Message sent.", "ok");
    $("staffSubject").value = ""; $("staffBody").value = "";
    staffReplyTo = null; $("staffReplyNote").textContent = "";
    await loadMessages();
  } catch (e) { toast(e.message, "error"); }
  $("staffSendBtn").disabled = false;
};

// Badge of the Messages tab: unread messages of the selected class (other classes: in the title of the badge).
async function updateMsgBadge() {
  let counts = {};
  try { counts = await rpc("t_unread_messages", {}); } catch (e) { return; }
  const here = (counts && counts[classId]) || 0;
  const elsewhere = Object.entries(counts || {}).filter(([k]) => k !== classId).reduce((a, [, n]) => a + Number(n), 0);
  const b = $("msgBadge");
  b.textContent = here ? String(here) : elsewhere ? "•" : "";
  b.title = elsewhere ? `${elsewhere} unread message(s) in your other classes` : "";
  b.classList.toggle("hidden", !here && !elsewhere);
}
poller(updateMsgBadge, 60000, () => !!classId);   // v28.1

// The personal page of the teacher, in edit mode.
$("myPageBtn").onclick = () => window.open(personalPageUrl("?edit"), "_blank", "noopener");


// ------------------------------------------------------------------ v28: confirmation by typing the exact name
// Resolves to null (cancelled) or { checked } once the typed text is exactly `expected`.
function confirmTyped({ title, message, expected, checkboxLabel, button }) {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.className = "modal";
    box.innerHTML = `<div class="card modal-content" style="max-width:560px">
      <h2 style="margin-top:0">🗑 ${esc(title)}</h2>
      <p>${message || ""}</p>
      ${checkboxLabel ? `<label class="tick"><input type="checkbox" id="ctCheck" style="width:auto"> ${checkboxLabel}</label>` : ""}
      <label for="ctInput">To confirm, type the exact name: <strong class="ct-name">${esc(expected)}</strong></label>
      <input id="ctInput" autocomplete="off">
      <div class="row" style="gap:8px;margin-top:12px"><button id="ctOk" class="red" disabled>${esc(button || "Delete for good")}</button>
        <button id="ctCancel" class="secondary">Cancel</button></div></div>`;
    document.body.appendChild(box);
    const input = box.querySelector("#ctInput"), ok = box.querySelector("#ctOk");
    input.oninput = () => { ok.disabled = input.value !== expected; };
    const close = (v) => { box.remove(); resolve(v); };
    box.querySelector("#ctCancel").onclick = () => close(null);
    ok.onclick = () => close({ checked: !!(box.querySelector("#ctCheck") && box.querySelector("#ctCheck").checked) });
    input.onkeydown = (e) => { if (e.key === "Enter" && !ok.disabled) ok.click(); if (e.key === "Escape") close(null); };
    input.focus();
  });
}

// ------------------------------------------------------------------ v28: question browser (bank and quiz editor)
// One component for ~1000 questions: tree module > chapter, search, filters, pages, ticks, bulk actions.
let bankBrowser = null, pickBrowser = null;
function makeQuestionBrowser(root, opts) {
  const st = { module: "", chapter: "", search: "", type: "", usage: "", page: 0, size: 50, ticked: new Set(), open: new Set(), dups: false };
  const bank = opts.mode === "bank";
  const kindOf = (q) => q.qtype === "number" ? "number" : q.correct.length ? "choice" : "survey";
  const dupKeys = () => {
    const count = {};
    allQuestions.forEach((q) => { const k = norm(q.text).replace(/[^a-z0-9]+/g, " ").trim(); count[k] = (count[k] || 0) + 1; });
    return count;
  };
  function filtered() {
    const f = norm(st.search);
    let list = allQuestions.filter((q) => (!st.module || q.module === st.module) && (!st.chapter || q.chapter === st.chapter)
      && (!st.type || kindOf(q) === st.type)
      && (!st.usage || (st.usage === "unused" ? !q.runs && !q.prepared : q.runs || q.prepared))
      && (!f || norm(`${q.text} ${q.ref} ${q.chapter} ${(q.options || []).join(" ")}`).includes(f)));
    if (st.dups) {
      const c = dupKeys();
      const key = (q) => norm(q.text).replace(/[^a-z0-9]+/g, " ").trim();
      list = list.filter((q) => c[key(q)] > 1).sort((a, b) => key(a).localeCompare(key(b)));
    }
    return list;
  }
  function tree() {
    const mods = [...new Set(allQuestions.map((q) => q.module))].sort();
    const n = (m, c) => allQuestions.filter((q) => q.module === m && (c === undefined || q.chapter === c)).length;
    const node = (label, count, m, c, cls) => `<button class="qb-node ${cls || ""} ${st.module === m && st.chapter === c ? "active" : ""}" data-m="${esc(m)}" data-c="${esc(c)}">${label} <span class="muted">${count}</span></button>`;
    return node("All the questions", allQuestions.length, "", "", "qb-all") + mods.map((m) => {
      const open = st.open.has(m) || st.module === m;
      const chs = [...new Set(allQuestions.filter((q) => q.module === m).map((q) => q.chapter))].sort();
      return `<div class="qb-mod"><button class="qb-toggle" data-open="${esc(m)}">${open ? "▾" : "▸"}</button>${node("📁 " + esc(m || "(no module)"), n(m), m, "")}` +
        (open ? `<div class="qb-chs">` + chs.map((c) => node(esc(c || "(no chapter)"), n(m, c), m, c)).join("") + `</div>` : "") + `</div>`;
    }).join("");
  }
  function rowHtml(q) {
    const inQuiz = !bank && opts.isPicked(q.id);
    const kind = kindOf(q);
    return `<tr class="${inQuiz ? "qb-in" : ""}"><td><input type="checkbox" class="qb-tick" value="${q.id}" ${st.ticked.has(q.id) ? "checked" : ""} ${inQuiz ? "disabled" : ""} style="width:auto"></td>
      <td><strong>${esc(q.ref)}</strong><div class="muted">${st.module ? "" : esc(q.module) + " · "}${esc(q.chapter)}</div></td>
      <td>${esc(q.text)}<div class="muted qb-opts">${kind === "number" ? "🔢 " + esc(numSpecText(q)) + (q.unit ? " " + esc(q.unit) : "")
        : (q.options || []).map((o, i) => `<span class="${q.correct.includes(i) ? "qb-ok" : ""}">${LETTERS[i]}. ${esc(o)}</span>`).join(" · ")}</div></td>
      <td>${kind === "survey" ? '<span class="kind">survey</span>' : kind === "number" ? "number" : q.correct.length > 1 ? "several" : "one"}</td>
      <td>${Number(q.points)}</td><td>${q.time_limit} s</td>
      <td title="runs in sessions · prepared quizzes">${q.runs || q.prepared ? `${q.runs} · ${q.prepared}` : '<span class="muted">unused</span>'}</td>
      <td>${inQuiz ? '<span class="badge ok">in the quiz</span>' : bank ? `<button class="small secondary" data-qedit="${q.id}">Edit</button>` : `<button class="small" data-qadd="${q.id}">＋</button>`}</td></tr>`;
  }
  function renderList() {
    const list = filtered();
    const pages = Math.max(1, Math.ceil(list.length / st.size));
    st.page = Math.min(st.page, pages - 1);
    const shown = list.slice(st.page * st.size, (st.page + 1) * st.size);
    const tickedN = st.ticked.size;
    const bulk = bank
      ? `<span><strong>${tickedN}</strong> ticked</span>
         <input class="qb-chapter" placeholder="chapter" style="width:110px"><button class="small secondary" data-bulk="chapter">Set chapter</button>
         <input class="qb-points" type="number" step="0.25" min="0.25" placeholder="points" style="width:80px"><button class="small secondary" data-bulk="points">Set points</button>
         <input class="qb-time" type="number" min="5" max="600" placeholder="time s" style="width:80px"><button class="small secondary" data-bulk="time_limit">Set time</button>
         <button class="small red" data-bulk="delete">🗑 Delete</button>`
      : `<span><strong>${tickedN}</strong> ticked</span> <button class="small green" data-bulk="add">＋ Add the ticked questions to the quiz</button>`;
    root.querySelector(".qb-list").innerHTML =
      `<div class="row qb-bulk" style="gap:6px;align-items:center;flex-wrap:wrap">${bulk}
        <button class="small secondary" data-tick="page">Tick this page</button><button class="small secondary" data-tick="all">Tick all ${list.length}</button>
        <button class="small secondary" data-tick="none">Untick</button></div>` +
      (list.length === 0 ? `<p class="muted">No question${allQuestions.length ? " matches" : ": import questions in the ❓ Questions tab"}.</p>` :
      `<div class="table-scroll"><table class="qb-table"><tr><th></th><th>Ref</th><th>Question</th><th>Answers</th><th>Pts</th><th>Time</th><th>Used</th><th></th></tr>${shown.map(rowHtml).join("")}</table></div>`) +
      `<div class="row qb-pager" style="gap:8px;align-items:center;margin-top:6px">
        <button class="small secondary" data-page="-1" ${st.page === 0 ? "disabled" : ""}>◀</button>
        <span>page ${st.page + 1} / ${pages} · ${list.length} question(s)</span>
        <button class="small secondary" data-page="1" ${st.page >= pages - 1 ? "disabled" : ""}>▶</button>
        <select class="qb-size" style="width:auto">${[25, 50, 100, 200].map((n) => `<option ${n === st.size ? "selected" : ""}>${n}</option>`).join("")}</select> <span class="muted">per page</span></div>`;
  }
  function render() {
    root.innerHTML = `<div class="qb"><div class="qb-tree">${tree()}</div><div class="qb-main">
      <div class="row" style="gap:6px;align-items:center;flex-wrap:wrap">
        <input class="qb-search" placeholder="🔍 Search (text, ref, chapter, options)" value="${esc(st.search)}" style="max-width:300px">
        <select class="qb-type" style="width:auto"><option value="">all types</option><option value="choice" ${st.type === "choice" ? "selected" : ""}>multiple choice</option>
          <option value="number" ${st.type === "number" ? "selected" : ""}>number</option><option value="survey" ${st.type === "survey" ? "selected" : ""}>survey</option></select>
        <select class="qb-usage" style="width:auto"><option value="">used or not</option><option value="unused" ${st.usage === "unused" ? "selected" : ""}>never used</option>
          <option value="used" ${st.usage === "used" ? "selected" : ""}>already used</option></select>
        ${bank ? `<label style="margin:0"><input type="checkbox" class="qb-dups" ${st.dups ? "checked" : ""} style="width:auto"> same text twice (duplicates)</label>` : ""}
      </div><div class="qb-list"></div></div></div>`;
    renderList();
  }
  // events (delegated once)
  root.addEventListener("click", async (ev) => {
    const t = ev.target;
    const nodeB = t.closest(".qb-node");
    if (nodeB) { st.module = nodeB.dataset.m; st.chapter = nodeB.dataset.c; st.page = 0; if (st.module) st.open.add(st.module); render(); return; }
    const tog = t.closest("[data-open]");
    if (tog) { const m = tog.dataset.open; if (st.open.has(m) || st.module === m) { st.open.delete(m); if (st.module === m) { st.module = ""; st.chapter = ""; } } else st.open.add(m); render(); return; }
    const pg = t.closest("[data-page]");
    if (pg) { st.page += Number(pg.dataset.page); renderList(); return; }
    const tk = t.closest("[data-tick]");
    if (tk) {
      const list = filtered().filter((q) => bank || !opts.isPicked(q.id));
      if (tk.dataset.tick === "none") st.ticked.clear();
      else (tk.dataset.tick === "all" ? list : list.slice(st.page * st.size, (st.page + 1) * st.size)).forEach((q) => st.ticked.add(q.id));
      renderList(); return;
    }
    const ed = t.closest("[data-qedit]");
    if (ed) { openQuestionEditor(allQuestions.find((q) => q.id === ed.dataset.qedit)); return; }
    const add = t.closest("[data-qadd]");
    if (add) { opts.onAdd([add.dataset.qadd]); return; }
    const bk = t.closest("[data-bulk]");
    if (bk) {
      const ids = [...st.ticked];
      if (!ids.length) { toast("Tick questions first.", "error"); return; }
      const what = bk.dataset.bulk;
      if (what === "add") { opts.onAdd(ids); st.ticked.clear(); renderList(); return; }
      if (what === "delete") {
        const used = allQuestions.filter((q) => ids.includes(q.id) && (q.runs || q.prepared)).length;
        if (!confirm(`Delete ${ids.length} question(s) from the bank?` + (used ? `\n${used} of them are used: they are only hidden (past marks are kept) and taken out of the prepared quizzes.` : ""))) return;
        try { const r = await rpc("t_delete_questions", { p_ids: ids }); toast(`${r.deleted} deleted` + (r.hidden ? `, ${r.hidden} hidden (already used)` : "") + ".", "ok"); }
        catch (e) { toast(e.message, "error"); return; }
      } else {
        const v = root.querySelector(what === "chapter" ? ".qb-chapter" : what === "points" ? ".qb-points" : ".qb-time").value.trim();
        if (v === "") { toast("Type the new value next to the button.", "error"); return; }
        const set = {}; set[what] = what === "chapter" ? v : Number(v);
        if (!confirm(`Change the ${what === "time_limit" ? "time" : what} of ${ids.length} question(s) to "${v}"?`)) return;
        try { const r = await rpc("t_bulk_questions", { p_ids: ids, p_set: set }); toast(`${r.updated} question(s) changed.`, "ok"); }
        catch (e) { toast(e.message, "error"); return; }
      }
      st.ticked.clear();
      await loadQuestions();
    }
  });
  root.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.classList.contains("qb-tick")) { if (t.checked) st.ticked.add(t.value); else st.ticked.delete(t.value); renderList(); }
    else if (t.classList.contains("qb-type")) { st.type = t.value; st.page = 0; renderList(); }
    else if (t.classList.contains("qb-usage")) { st.usage = t.value; st.page = 0; renderList(); }
    else if (t.classList.contains("qb-dups")) { st.dups = t.checked; st.page = 0; renderList(); }
    else if (t.classList.contains("qb-size")) { st.size = Number(t.value); st.page = 0; renderList(); }
  });
  root.addEventListener("input", (ev) => {
    if (ev.target.classList.contains("qb-search")) { st.search = ev.target.value; st.page = 0; renderList(); }
  });
  return { render, renderList, show(m, c) { st.module = m || ""; st.chapter = c || ""; st.page = 0; } };
}

// ------------------------------------------------------------------ v28: prepared quizzes (📝 Quizzes tab)
let tplList = [], tplEditing = null, tplPicked = [];
async function loadTemplates() {
  try { tplList = await rpc("t_list_templates", { p_class: classId }); } catch (e) { tplList = []; }
  const folders = [...new Set(tplList.map((t) => t.folder))].sort();
  const keep = $("tplFolderFilter").value;
  $("tplFolderFilter").innerHTML = `<option value="">All folders</option>` + folders.map((f) => `<option value="${esc(f)}" ${f === keep ? "selected" : ""}>${esc(f || "(no folder)")}</option>`).join("");
  $("folderList").innerHTML = folders.filter(Boolean).map((f) => `<option value="${esc(f)}">`).join("");
  // Live tab: the prepared quizzes that can be run in the selected session
  const sk = sessionKindNow();
  const usable = tplList.filter((t) => isTeacher() || t.kind === "tp" || sk !== "tp");
  $("tplSelect").innerHTML = usable.length ? folders.map((f) => {
    const items = usable.filter((t) => t.folder === f);
    return items.length ? `<optgroup label="${esc(f || "(no folder)")}">` + items.map((t) => `<option value="${t.id}">${esc(t.title)} · ${KIND_LABEL[t.kind] || ""} · ${t.count} q.${t.runs.length ? " · run " + t.runs.length + "×" : ""}</option>`).join("") + `</optgroup>` : "";
  }).join("") : `<option value="">- prepare a quiz in the 📝 Quizzes tab -</option>`;
  renderTplList();
}
function isTeacher() { return !classId || (classRoles[classId] || "teacher") === "teacher"; }
function sessionKindNow() { return live && live.session ? live.session.kind : ""; }

function renderTplList() {
  const f = norm($("tplSearch").value), folder = $("tplFolderFilter").value, kind = $("tplKindFilter").value, never = $("tplNeverRun").checked;
  const list = tplList.filter((t) => (!f || norm(`${t.title} ${t.folder} ${(t.chapters || []).join(" ")} ${(t.modules || []).join(" ")}`).includes(f))
    && ($("tplFolderFilter").value === "" || t.folder === folder) && (!kind || t.kind === kind) && (!never || !t.runs.length));
  if (!tplList.length) { $("tplList").innerHTML = `<p class="muted">No prepared quiz yet. Click <strong>＋ New quiz</strong>.</p>`; return; }
  const folders = [...new Set(list.map((t) => t.folder))].sort();
  const lastRun = (t) => t.runs.length ? `${t.runs.length}× · last ${esc(t.runs[0].date)}` : '<span class="muted">never run</span>';
  $("tplList").innerHTML = folders.map((fo) => `<h3 class="tpl-folder">📁 ${esc(fo || "(no folder)")}</h3><div class="table-scroll"><table><tr><th>Quiz</th><th>Type</th><th>Questions</th><th>Mark</th><th>Runs</th><th></th></tr>` +
    list.filter((t) => t.folder === fo).map((t) => `<tr>
      <td><strong>${esc(t.title)}</strong><div class="muted">${esc((t.chapters || []).join(", "))}</div>
        ${t.runs.length ? `<details class="tpl-runs"><summary class="muted">runs</summary>${t.runs.map((r) => `<div>${esc(r.date)} · ${esc(r.class)} · ${esc(r.session)} · ${esc(r.title)} · ${r.status === "finished" ? "finished" : r.status} · ${r.answered} answered</div>`).join("")}</details>` : ""}</td>
      <td>${KIND_LABEL[t.kind] || esc(t.kind)}${t.pace === "self" ? "<br><span class='muted'>own pace</span>" : ""}</td>
      <td>${t.per_student_count ? `${t.count} per student from ${t.pool}` : t.count}${t.shuffle ? "<br><span class='muted'>mixed order</span>" : ""}</td>
      <td>${t.graded ? "/" + Number(t.total_points) : '<span class="muted">not graded</span>'}</td>
      <td>${lastRun(t)}</td>
      <td style="white-space:nowrap">${t.mine || isTeacher() ? `<button class="small secondary" data-tedit="${t.id}">✏ Edit</button>` : ""}
        <button class="small secondary" data-tdup="${t.id}">⧉ Duplicate</button>
        ${sessionId ? `<button class="small green" data-trun="${t.id}" title="Adds a run of this quiz to the session selected in the Live tab">▶ Add to the session</button>` : ""}
        ${t.mine || isTeacher() ? `<button class="small red" data-tdel="${t.id}">🗑</button>` : ""}</td></tr>`).join("") + `</table></div>`).join("") ||
    `<p class="muted">No prepared quiz matches.</p>`;
}
["tplSearch"].forEach((id) => { $(id).oninput = renderTplList; });
["tplFolderFilter", "tplKindFilter", "tplNeverRun"].forEach((id) => { $(id).onchange = renderTplList; });

$("tplList").addEventListener("click", async (ev) => {
  const b = ev.target.closest("button"); if (!b) return;
  const t = tplList.find((x) => x.id === (b.dataset.tedit || b.dataset.tdup || b.dataset.trun || b.dataset.tdel));
  if (!t) return;
  if (b.dataset.tedit) { openTplEditor(t); return; }
  if (b.dataset.tdup) {
    const title = prompt("Title of the copy (same questions and settings):", t.title + " (copy)");
    if (title === null) return;
    try { const id = await rpc("t_duplicate_template", { p_class: classId, p_id: t.id, p_title: title.trim() }); await loadTemplates(); toast("Copy created.", "ok");
          const c = tplList.find((x) => x.id === id); if (c) openTplEditor(c); }
    catch (e) { toast(e.message, "error"); }
    return;
  }
  if (b.dataset.trun) {
    try { const id = await rpc("t_launch_template", { p_template: t.id, p_session: sessionId }); await loadQuizzes(); $("quizSelect").value = id;
          toast(`"${t.title}" added to the session "${live && live.session ? live.session.title : ""}". Run it from the Live tab.`, "ok"); }
    catch (e) { toast(e.code === "SESSION_NOT_FOUND" ? "Choose a session in the Live tab first (an assistant: a lab session)." : e.message, "error"); }
    return;
  }
  if (b.dataset.tdel) {
    const answered = t.runs.reduce((a, r) => a + Number(r.answered || 0), 0);
    const r = await confirmTyped({ title: "Delete a prepared quiz", expected: t.title,
      message: t.runs.length ? `This quiz was run <strong>${t.runs.length}</strong> time(s) (${answered} answer sheet(s)). By default its runs and their marks are KEPT in 📊 Results.`
                             : "This quiz was never run.",
      checkboxLabel: t.runs.length ? `Also delete its ${t.runs.length} run(s) with all their answers and marks` : null });
    if (!r) return;
    try { const x = await rpc("t_delete_template", { p_class: classId, p_id: t.id, p_confirm: t.title, p_with_results: r.checked });
          toast(x.runs_deleted ? `Quiz and ${x.runs_deleted} run(s) deleted.` : "Prepared quiz deleted (its results are kept).", "ok"); await loadTemplates(); if (sessionId) await loadQuizzes(); }
    catch (e) { toast(e.message, "error"); }
  }
});

async function openTplEditor(t) {
  if (!allQuestions.length || !allQuestions[0].hasOwnProperty("runs")) allQuestions = await rpc("t_list_questions", { p_module: null, p_class: classId });
  tplEditing = t ? t.id : null;
  $("tplEditorTitle").textContent = t ? "Change the quiz: " + t.title : "New quiz";
  $("tplRunsNote").classList.toggle("hidden", !(t && t.runs.length));
  $("tplRunsNote").textContent = t && t.runs.length ? `Already run ${t.runs.length} time(s): your changes apply to the next runs only (past answers and marks do not change).` : "";
  const d = t || { title: "", folder: $("tplFolderFilter").value || "", kind: isTeacher() ? "quiz" : "tp", pace: "live", lock_screen: true, ask_variant: false, graded: true,
                   total_points: 20, scoring: "partial", reveal_mode: "each", time_override: null, shuffle: false, per_student_count: null, show_on_projector: false, show_answer_count: false, question_ids: [] };
  $("quizTitle").value = d.title; $("quizFolder").value = d.folder || "";
  $("quizKind").value = d.kind; $("quizPace").value = d.pace; $("quizLock").checked = d.lock_screen; $("quizVariant").checked = d.ask_variant;
  $("quizGraded").checked = d.graded; $("quizTotal").value = Number(d.total_points); $("quizScoring").value = d.scoring; $("quizReveal").value = d.reveal_mode;
  $("quizTime").value = d.time_override ? String(d.time_override) : ""; $("quizShuffle").checked = d.shuffle;
  $("quizPerStudent").checked = !!d.per_student_count; $("quizPerStudentN").value = d.per_student_count || 5;
  $("quizProjector").checked = d.show_on_projector; $("quizShowCount").checked = d.show_answer_count;
  tplPicked = d.question_ids.filter((id) => allQuestions.some((q) => q.id === id));
  syncQuizOptions();
  renderTplPicked();
  if (!pickBrowser) pickBrowser = makeQuestionBrowser($("pickBrowser"), { mode: "pick", isPicked: (id) => tplPicked.includes(id),
    onAdd: (ids) => { tplPicked = tplPicked.concat(ids.filter((id) => !tplPicked.includes(id))); renderTplPicked(); pickBrowser.renderList(); } });
  pickBrowser.render();
  if ($("drawRules").children.length === 0) addDrawRule();
  $("tplListCard").classList.add("hidden");
  $("tplEditorCard").classList.remove("hidden");
  window.scrollTo(0, 0);
}
function renderTplPicked() {
  $("tplPickedCount").textContent = `(${tplPicked.length})`;
  const byId = Object.fromEntries(allQuestions.map((q) => [q.id, q]));
  $("tplPicked").innerHTML = tplPicked.length ? `<table class="tpl-picked">` + tplPicked.map((id, i) => {
    const q = byId[id] || { ref: "?", text: "(question no longer in the bank)", module: "", chapter: "" };
    return `<tr><td>${i + 1}</td><td><strong>${esc(q.ref)}</strong> <span class="muted">${esc(q.module)} · ${esc(q.chapter)}</span></td><td>${esc(q.text)}</td>
      <td style="white-space:nowrap"><button class="small secondary" data-pmove="${i}" data-d="-1" ${i === 0 ? "disabled" : ""}>↑</button><button class="small secondary" data-pmove="${i}" data-d="1" ${i === tplPicked.length - 1 ? "disabled" : ""}>↓</button>
      <button class="small secondary" data-prm="${i}">✕</button></td></tr>`;
  }).join("") + `</table>` + `<button class="small secondary" id="tplClearBtn" style="margin-top:6px">Remove all</button>`
    : `<p class="muted">No question yet: add them from the bank below (＋ on a line, or tick several), or use the random draw.</p>`;
}
$("tplPicked").addEventListener("click", (ev) => {
  const b = ev.target.closest("button"); if (!b) return;
  if (b.id === "tplClearBtn") { if (confirm("Remove all the questions of this quiz?")) tplPicked = []; }
  else if (b.dataset.pmove !== undefined) { const i = Number(b.dataset.pmove), j = i + Number(b.dataset.d); [tplPicked[i], tplPicked[j]] = [tplPicked[j], tplPicked[i]]; }
  else if (b.dataset.prm !== undefined) tplPicked.splice(Number(b.dataset.prm), 1);
  renderTplPicked();
  if (pickBrowser) pickBrowser.renderList();
});
$("tplNewBtn").onclick = () => openTplEditor(null);
$("tplCancelBtn").onclick = () => { $("tplEditorCard").classList.add("hidden"); $("tplListCard").classList.remove("hidden"); };
$("tplSaveBtn").onclick = async () => {
  if (!tplPicked.length) { toast("Add questions to the quiz first.", "error"); return; }
  const perStudent = $("quizPerStudent").checked ? Number($("quizPerStudentN").value) : null;
  if (perStudent && (perStudent < 1 || perStudent > tplPicked.length)) { toast(`Each student can get 1 to ${tplPicked.length} questions.`, "error"); return; }
  const data = { title: $("quizTitle").value.trim() || defaultQuizTitle(tplPicked), folder: $("quizFolder").value.trim(), question_ids: tplPicked,
    shuffle: $("quizShuffle").checked, kind: $("quizKind").value, pace: $("quizPace").value, lock_screen: $("quizLock").checked, ask_variant: $("quizVariant").checked,
    graded: $("quizGraded").checked, total_points: Number($("quizTotal").value) || 20, scoring: $("quizScoring").value, reveal_mode: $("quizReveal").value,
    time_override: $("quizTime").value ? Number($("quizTime").value) : null, per_student_count: perStudent,
    show_on_projector: $("quizProjector").checked, show_answer_count: $("quizShowCount").checked };
  try {
    await rpc("t_save_template", { p_class: classId, p_id: tplEditing, p_data: data });
    toast(tplEditing ? "Quiz saved (next runs use the new version)." : `Quiz "${data.title}" prepared. Run it from the Live tab.`, "ok");
    $("tplEditorCard").classList.add("hidden"); $("tplListCard").classList.remove("hidden");
    await loadTemplates();
  } catch (e) { toast(e.code === "SAME_QUESTION_TWICE" ? "The same question is twice in the list." : e.message, "error"); }
};

// Live tab: add a run of the chosen prepared quiz to the session
$("launchBtn").onclick = async () => {
  const id = $("tplSelect").value;
  if (!sessionId) { toast("Choose or create a session first.", "error"); return; }
  if (!id) { toast("Prepare a quiz in the 📝 Quizzes tab first.", "error"); return; }
  try { const qid = await rpc("t_launch_template", { p_template: id, p_session: sessionId }); await afterQuizChange("Quiz added to the session and selected. Click 1. Show the rules to run it.", qid); }
  catch (e) { toast(e.message, "error"); }
};
$("goQuizzesBtn").onclick = () => document.querySelector("nav button[data-tab=quizzes]").click();


// ------------------------------------------------------------------ v28: locked parts of a document
// In the page, a part to keep for later is marked  <section data-lock="ex2-correction" data-lock-label="Exercise 2: correction">.
// Before the page is stored, these parts are taken out (they go to the database apart) and replaced by a placeholder.
function splitLockedParts(text) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  const parts = [], seen = new Set();
  [...doc.querySelectorAll("[data-lock]")].filter((el) => !el.parentElement.closest("[data-lock]")).forEach((el) => {
    const key = (el.getAttribute("data-lock") || "").trim();
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(key)) throw new Error(`Locked part "${key}": use only letters, digits, - and _ in data-lock.`);
    if (seen.has(key)) throw new Error(`Two locked parts have the same name "${key}".`);
    seen.add(key);
    const h = el.querySelector("h1,h2,h3,h4,h5,h6,summary");
    const label = (el.getAttribute("data-lock-label") || (h && h.textContent) || key).trim().slice(0, 120);
    parts.push({ key, label, html: el.outerHTML });
    const ph = doc.createElement("div");
    ph.setAttribute("class", "cp-lock"); ph.setAttribute("data-cp-lock", key);
    el.replaceWith(ph);
  });
  if (!parts.length) return { html: text, parts };
  const doctype = /^\s*<!doctype[^>]*>/i.exec(text);
  return { html: (doctype ? doctype[0] + "\n" : "") + doc.documentElement.outerHTML, parts };
}

// Open or lock the parts of one document of the class, for the whole class or for a group (teacher or assistant).
async function openLockPanel(classDocId, title, after) {
  let data;
  try { data = await rpc("t_doc_locks", { p_class_doc: classDocId }); } catch (e) { toast(e.message, "error"); return; }
  let box = document.getElementById("lockPanel");
  if (!box) { box = document.createElement("div"); box.id = "lockPanel"; box.className = "modal"; document.body.appendChild(box); }
  const cols = [""].concat(data.groups);
  const isOpen = (p, g) => p.open.some((o) => o.group === g);
  const cell = (p, g) => {
    const o = p.open.find((x) => x.group === g), whole = g !== "" && isOpen(p, "");
    return o ? `<button class="small green" data-lk="${esc(p.key)}" data-g="${esc(g)}" data-open="0" title="Opened by ${esc(o.by || "")} ${fmtWhen(o.at)}. Click to lock again.">🔓 open</button>`
      : whole ? `<span class="muted">open (whole class)</span>`
      : `<button class="small secondary" data-lk="${esc(p.key)}" data-g="${esc(g)}" data-open="1">🔒 locked</button>`;
  };
  box.innerHTML = `<div class="card modal-content" style="max-width:980px">
    <div class="row" style="justify-content:space-between;align-items:center"><h2 style="margin:0">🔒 ${esc(title)}</h2><button class="secondary small" id="lpClose">Close</button></div>
    <p class="muted">A locked part is not sent to the students' phones at all. Open it for the whole class, or only for a TD group / TP sub-group
      (e.g. after the session of that group). You can lock it again.</p>
    ${data.parts.length ? `<div class="table-scroll"><table><tr><th>Part</th>${cols.map((g) => `<th>${g ? esc(g) : "Whole class"}</th>`).join("")}</tr>` +
      data.parts.map((p) => `<tr><td><strong>${esc(p.label)}</strong><div class="muted">${esc(p.key)}</div></td>${cols.map((g) => `<td>${cell(p, g)}</td>`).join("")}</tr>`).join("") +
      `<tr><td><em>All the parts</em></td>${cols.map((g) => `<td><button class="small orange" data-lk="" data-g="${esc(g)}" data-open="1">Open all</button></td>`).join("")}</tr></table></div>`
      : `<p>No locked part in this page.</p>`}</div>`;
  box.querySelector("#lpClose").onclick = () => { box.remove(); if (after) after(); };
  box.querySelectorAll("[data-lk]").forEach((b) => b.onclick = async () => {
    const open = b.dataset.open === "1", g = b.dataset.g;
    const what = b.dataset.lk ? `"${data.parts.find((p) => p.key === b.dataset.lk).label}"` : "ALL the locked parts";
    if (!confirm(`${open ? "Open" : "Lock again"} ${what} for ${g ? "group " + g : "the whole class"}?`)) return;
    try { await rpc("t_set_doc_unlock", { p_class_doc: classDocId, p_key: b.dataset.lk || null, p_group: g, p_open: open });
          toast(open ? "Opened: the students see it the next time they open the page." : "Locked again.", "ok"); openLockPanel(classDocId, title, after); }
    catch (e) { toast(e.message, "error"); }
  });
}

// ------------------------------------------------------------------ v28.2: make-up of a quiz
// After the quiz, chosen students get the questions THEY did not answer, one at a time, with the time of the quiz,
// on their class device, until a date. Their answers count in the same quiz.
const MAKEUP_KIND = { missed: "missed questions (network?)", late: "arrived late", left: "left the screen", absent: "absent", complete: "answered everything" };
function makeupBadge(m) {
  if (!m) return "";
  if (m.done) return `<span class="badge info" title="make-up done ${fmtWhen(m.done)}">make-up ✓</span>`;
  if (new Date(m.until) < new Date()) return `<span class="badge closed" title="not done in time">make-up expired</span>`;
  return `<span class="badge open" title="until ${fmtWhen(m.until)}">make-up ${m.pos}/${m.count}</span>`;
}
function localDateTime(d) { const z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; }
async function openMakeupPanel(quizId, after) {
  const box = $("makeupPanel");
  box.innerHTML = `<p class="muted">Loading…</p>`;
  let d;
  try { d = await rpc("t_makeup_candidates", { p_quiz: quizId }); } catch (e) { box.innerHTML = ""; toast(e.message, "error"); return; }
  const today = new Date(); today.setHours(23, 59, 0, 0);
  const rows = d.students.filter((x) => x.kind !== "complete" || x.makeup);
  box.innerHTML = `<div class="makeup-panel"><strong>Make-up: ${esc(d.quiz.title)}</strong>
    <p class="muted" style="margin:4px 0 8px">Each student chosen gets only the questions he did not answer (never one he answered), one at a time, with the time of the quiz,
      on his class device (home page › 📝 Make-up). His answers count in this quiz. Ticked by default: late, missed questions, left the screen.</p>
    ${rows.length ? `<div class="table-scroll"><table><tr><th></th><th>Student</th><th>Why</th><th>Questions to do</th><th>Make-up</th></tr>` + rows.map((x) => {
      const can = x.missing > 0 && !(x.makeup && !x.makeup.done);
      const pre = can && ["missed", "late", "left"].includes(x.kind);
      return `<tr><td><input type="checkbox" class="mk-pick" data-s="${x.student_id}" ${pre ? "checked" : ""} ${can ? "" : "disabled"} style="width:auto"></td>
        <td>${esc(x.name)} <span class="muted">${esc(x.matricule)}${x.group ? " · " + esc(x.group) : ""}</span></td>
        <td>${MAKEUP_KIND[x.kind] || esc(x.kind)}${x.kind === "late" && x.checked_at ? ` <span class="muted">(${new Date(x.checked_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})</span>` : ""}</td>
        <td>${x.missing} / ${d.quiz.count}</td>
        <td>${makeupBadge(x.makeup)} ${x.makeup && !x.makeup.done ? `<button class="small secondary" data-mk-cancel="${x.student_id}">Cancel</button>` : ""}</td></tr>`;
    }).join("") + `</table></div>` : `<p>Everybody answered every question.</p>`}
    <div class="row" style="margin-top:8px">
      <label style="margin:0">Until <input type="datetime-local" id="mkUntil" value="${localDateTime(today)}" style="width:auto"></label>
      <button class="green small" id="mkGrant">Give the make-up</button>
      <button class="secondary small" id="mkClose">Close</button>
      <span class="muted" id="mkCount"></span>
    </div></div>`;
  const count = () => { $("mkCount").textContent = box.querySelectorAll(".mk-pick:checked").length + " student(s) chosen"; };
  box.querySelectorAll(".mk-pick").forEach((c) => c.onchange = count); count();
  $("mkClose").onclick = () => { box.innerHTML = ""; };
  $("mkGrant").onclick = async () => {
    const ids = [...box.querySelectorAll(".mk-pick:checked")].map((c) => c.dataset.s);
    if (!ids.length) { toast("Tick at least one student.", "error"); return; }
    const until = new Date($("mkUntil").value);
    if (isNaN(until) || until <= new Date()) { toast("Choose a date and time in the future.", "error"); return; }
    try {
      const r = await rpc("t_makeup_grant", { p_quiz: quizId, p_students: ids, p_until: until.toISOString() });
      toast(`Make-up given to ${r.granted} student(s), until ${until.toLocaleString([], { weekday: "short", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}.`, "ok");
      if (after) after(); else openMakeupPanel(quizId);
    } catch (e) { toast(e.message, "error"); }
  };
  box.querySelectorAll("[data-mk-cancel]").forEach((b) => b.onclick = async () => {
    try { await rpc("t_makeup_cancel", { p_quiz: quizId, p_student: b.dataset.mkCancel }); toast("Make-up cancelled.", "ok"); openMakeupPanel(quizId, after); }
    catch (e) { toast(e.message, "error"); }
  });
}

// ------------------------------------------------------------------ v30: My space (announcement, office hours, proposals)
// Entered once here for all the classes of the teacher; read by the students ("My teachers") and by the personal page.
const WEEKDAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const PROP_KIND = { pfe: "Final-year project", master: "Master thesis", licence: "Licence project", mini: "Mini-project", other: "Other" };
let mySpace = null, propEditing = null;
function dayLabel(d) { return new Date(d + "T12:00:00").toLocaleDateString([], { weekday: "long", day: "2-digit", month: "short" }); }
function officeHtml(list) {
  if (!list || !list.length) return `<p class="muted">No office hours in the next two weeks.</p>`;
  return list.map((o) => `<div class="office-day ${o.cancelled ? "cancelled" : ""}"><span class="d">${esc(dayLabel(o.date))}</span>
    <span class="t">${esc(o.start)}–${esc(o.end)}${o.place ? " · " + esc(o.place) : ""}</span>
    ${o.cancelled ? `<span class="badge no">cancelled</span>${o.reason ? ` <span class="muted">${esc(o.reason)}</span>` : ""}` : o.extra ? `<span class="badge open">extra</span>${o.reason ? ` <span class="muted">${esc(o.reason)}</span>` : ""}` : ""}</div>`).join("");
}
async function loadMySpace() {
  try { mySpace = await rpc("t_myspace"); } catch (e) { toast(e.message, "error"); return; }
  const d = mySpace;
  // announcement
  const keep = [...$("annClasses").selectedOptions].map((o) => o.value);
  $("annClasses").innerHTML = d.classes.map((c) => `<option value="${c.id}" ${keep.includes(c.id) ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  if (!$("annUntil").value) { const t = new Date(Date.now() + 7 * 86400000); t.setHours(23, 59, 0, 0); $("annUntil").value = localDateTime(t); }
  $("annList").innerHTML = d.announcements.map((a) => `<div class="ann-banner" style="${a.active ? "" : "opacity:.5"}">${esc(a.body)}
      <div class="muted" style="font-size:12px">${a.active ? "until " + fmtWhen(a.until) : "ended"} · ${a.class_ids.length ? a.class_ids.map((id) => esc((d.classes.find((c) => c.id === id) || {}).name || "?")).join(", ") : "all my classes"}${a.public ? " · public page" : ""}
      ${a.active ? `<button class="small secondary" data-annend="${a.id}">End now</button>` : ""}</div></div>`).join("");
  $("annList").querySelectorAll("[data-annend]").forEach((b) => b.onclick = async () => {
    try { await rpc("t_announce_end", { p_id: Number(b.dataset.annend) }); toast("Announcement ended.", "ok"); loadMySpace(); } catch (e) { toast(e.message, "error"); }
  });
  // office hours
  $("slotList").innerHTML = d.slots.length ? `<table>` + d.slots.map((s) => `<tr><td><strong>${WEEKDAYS[s.weekday]}</strong></td><td>${esc(s.start)}–${esc(s.end)}</td>
      <td>${esc(s.place)}</td><td class="muted">${s.valid_from ? "from " + esc(s.valid_from) : ""} ${s.valid_until ? "until " + esc(s.valid_until) : ""}</td>
      <td><button class="small red" data-slotdel="${s.id}">Delete</button></td></tr>`).join("") + `</table>` : `<p class="muted">No weekly slot yet.</p>`;
  $("slotList").querySelectorAll("[data-slotdel]").forEach((b) => b.onclick = async () => {
    if (!confirm("Delete this weekly slot?")) return;
    try { await rpc("t_slot_delete", { p_id: Number(b.dataset.slotdel) }); loadMySpace(); } catch (e) { toast(e.message, "error"); }
  });
  $("officePreview").innerHTML = officeHtml(d.upcoming) + (d.exceptions.length ? `<p class="muted" style="margin:8px 0 2px">Changes:</p>` +
    d.exceptions.map((e) => `<div class="row" style="gap:6px"><span>${esc(dayLabel(e.day))}: ${e.kind === "cancel" ? "cancelled" : `extra ${esc(e.start)}–${esc(e.end)} ${esc(e.place)}`}${e.reason ? " — " + esc(e.reason) : ""}</span>
      <button class="small secondary" data-exdel="${e.id}">Undo</button></div>`).join("") : "");
  $("officePreview").querySelectorAll("[data-exdel]").forEach((b) => b.onclick = async () => {
    try { await rpc("t_exception_delete", { p_id: Number(b.dataset.exdel) }); loadMySpace(); } catch (e) { toast(e.message, "error"); }
  });
  if (!$("exDay").value) $("exDay").value = new Date().toISOString().slice(0, 10);
  // proposals
  $("propList").innerHTML = d.proposals.length ? d.proposals.map((p) => `<div class="prop-row ${p.status !== "open" ? "closed" : ""}">
      <div class="row" style="justify-content:space-between"><strong>${esc(p.title)}</strong>
        <span><span class="badge ${p.status === "open" ? "open" : "closed"}">${p.status}</span> ${p.public ? "" : '<span class="badge info">not public</span>'}</span></div>
      <div class="muted">${PROP_KIND[p.kind] || esc(p.kind)}${p.level ? " · " + esc(p.level) : ""} · ${p.places} place(s)${p.keywords ? " · " + esc(p.keywords) : ""}${p.assigned_note ? " · " + esc(p.assigned_note) : ""}</div>
      ${p.description ? `<p style="margin:6px 0;white-space:pre-line">${esc(p.description)}</p>` : ""}
      <div class="row" style="gap:6px"><button class="small" data-pint="${p.id}">👥 Interested: ${p.interested}</button>
        <button class="small secondary" data-pedit="${p.id}">✏ Edit</button>
        ${p.status === "open" ? `<button class="small green" data-passign="${p.id}">Assigned</button>` : `<button class="small secondary" data-preopen="${p.id}">Open again</button>`}
        <button class="small" data-pproj="${p.id}" title="A space for the team: thread, files, milestones, meetings">🎓 Start the project</button>
        <button class="small red" data-pdel="${p.id}">Delete</button></div>
      <div class="pint-box" id="pint-${p.id}"></div></div>`).join("") : `<p class="muted">No proposal yet.</p>`;
  const prop = (id) => d.proposals.find((x) => x.id === id);
  const saveStatus = async (p, status, note) => {
    try { await rpc("t_proposal_save", { p_id: p.id, p_data: Object.assign({}, p, { status, assigned_note: note == null ? p.assigned_note : note }) }); loadMySpace(); }
    catch (e) { toast(e.message, "error"); }
  };
  $("propList").querySelectorAll("[data-pedit]").forEach((b) => b.onclick = () => openPropForm(prop(b.dataset.pedit)));
  $("propList").querySelectorAll("[data-passign]").forEach((b) => b.onclick = () => {
    const note = prompt("Assigned: note (e.g. names of the students). The proposal leaves the students' list.", "");
    if (note !== null) saveStatus(prop(b.dataset.passign), "assigned", note);
  });
  $("propList").querySelectorAll("[data-pproj]").forEach((b) => b.onclick = () => startProjectFromProposal(b.dataset.pproj));   // v31
  $("propList").querySelectorAll("[data-preopen]").forEach((b) => b.onclick = () => saveStatus(prop(b.dataset.preopen), "open"));
  $("propList").querySelectorAll("[data-pdel]").forEach((b) => b.onclick = async () => {
    if (!confirm("Delete this proposal (and the list of interested students)?")) return;
    try { await rpc("t_proposal_delete", { p_id: b.dataset.pdel }); loadMySpace(); } catch (e) { toast(e.message, "error"); }
  });
  $("propList").querySelectorAll("[data-pint]").forEach((b) => b.onclick = async () => {
    const box = $("pint-" + b.dataset.pint);
    if (box.innerHTML) { box.innerHTML = ""; return; }
    let list = [];
    try { list = await rpc("t_proposal_interested", { p_id: b.dataset.pint }); } catch (e) { toast(e.message, "error"); return; }
    box.innerHTML = list.length ? `<table>` + list.map((x) => `<tr><td><strong>${esc(x.name)}</strong> <span class="muted">${esc(x.matricule)} · ${esc(x.class)}${x.group ? " · " + esc(x.group) : ""}</span>
        ${x.email ? `<div><a href="mailto:${esc(x.email)}">${esc(x.email)}</a></div>` : ""}</td><td style="white-space:pre-line">${esc(x.message || "")}</td><td class="muted">${fmtWhen(x.at)}</td></tr>`).join("") + `</table>`
      : `<p class="muted">Nobody yet.</p>`;
  });
}
function openPropForm(p) {
  propEditing = p || null;
  $("propForm").classList.remove("hidden");
  $("propTitle").value = p ? p.title : ""; $("propKind").value = p ? p.kind : "pfe"; $("propLevel").value = p ? p.level : "";
  $("propPlaces").value = p ? p.places : 2; $("propStatus").value = p ? p.status : "open"; $("propPublic").checked = p ? p.public : true;
  $("propDesc").value = p ? p.description : ""; $("propKeywords").value = p ? p.keywords : ""; $("propNote").value = p ? (p.assigned_note || "") : "";
  $("propTitle").focus();
}
$("propNewBtn").onclick = () => openPropForm(null);
$("propCancelBtn").onclick = () => { $("propForm").classList.add("hidden"); propEditing = null; };
$("propSaveBtn").onclick = async () => {
  const data = { title: $("propTitle").value, kind: $("propKind").value, level: $("propLevel").value, places: Number($("propPlaces").value) || 1,
    status: $("propStatus").value, public: $("propPublic").checked, description: $("propDesc").value, keywords: $("propKeywords").value, assigned_note: $("propNote").value };
  try { await rpc("t_proposal_save", { p_id: propEditing ? propEditing.id : null, p_data: data }); toast("Proposal saved.", "ok"); $("propForm").classList.add("hidden"); propEditing = null; loadMySpace(); }
  catch (e) { toast(e.message, "error"); }
};
$("annSaveBtn").onclick = async () => {
  const until = new Date($("annUntil").value);
  if (isNaN(until) || until <= new Date()) { toast("Choose a date and time in the future.", "error"); return; }
  try {
    await rpc("t_announce_save", { p_id: null, p_body: $("annBody").value, p_classes: [...$("annClasses").selectedOptions].map((o) => o.value),
      p_until: until.toISOString(), p_public: $("annPublic").checked });
    $("annBody").value = ""; toast("Announcement published.", "ok"); loadMySpace();
  } catch (e) { toast(e.message, "error"); }
};
$("slotAddBtn").onclick = async () => {
  try {
    await rpc("t_slot_save", { p_id: null, p_weekday: Number($("slotDay").value), p_start: $("slotStart").value, p_end: $("slotEnd").value,
      p_place: $("slotPlace").value, p_from: $("slotFrom").value || null, p_until: $("slotUntil").value || null });
    toast("Slot added.", "ok"); loadMySpace();
  } catch (e) { toast(e.message, "error"); }
};
$("exKind").onchange = () => $("exExtra").classList.toggle("hidden", $("exKind").value !== "extra");
$("exAddBtn").onclick = async () => {
  const extra = $("exKind").value === "extra";
  try {
    const r = await rpc("t_exception_save", { p_day: $("exDay").value, p_kind: $("exKind").value, p_slot: null,
      p_start: extra ? $("exStart").value : null, p_end: extra ? $("exEnd").value : null, p_place: extra ? $("exPlace").value : "",
      p_reason: $("exReason").value, p_notify: $("exNotify").checked ? [] : null });
    toast(r.classes_notified ? `Saved; message sent to ${r.classes_notified} class(es).` : "Saved.", "ok");
    $("exReason").value = ""; loadMySpace();
  } catch (e) { toast(e.message, "error"); }
};
