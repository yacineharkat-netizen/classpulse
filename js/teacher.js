// ClassPulse - teacher console.
(window.CP_FILES = window.CP_FILES || {})["teacher.js"] = "5"; // file version, checked by common.js

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
  await loadResources();
}

// ------------------------------------------------------------------ navigation
document.querySelectorAll("nav button[data-tab]").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("nav button[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll("main section").forEach((s) => s.classList.toggle("hidden", s.id !== "tab-" + b.dataset.tab));
    activeTab = b.dataset.tab;
    updateBanner();
    const loaders = { students: loadStudents, questions: loadQuestions, classes: loadClasses, resources: loadResources, sessions: loadSessions };
    if (loaders[b.dataset.tab]) loaders[b.dataset.tab]();
  };
});

// ------------------------------------------------------------------ classes
async function loadClasses() {
  const classes = await rpc("t_list_classes");
  classNames = {};
  classes.forEach((c) => { classNames[c.id] = `${c.name} ${c.year}`; });
  const keep = classId || localStorage.getItem("cp_class");
  $("classSelect").innerHTML = classes.map((c) => `<option value="${c.id}">${esc(c.name)} ${esc(c.year)}</option>`).join("") ||
    `<option value="">- create a class first -</option>`;
  if (keep && classes.some((c) => c.id === keep)) $("classSelect").value = keep;
  $("classesTable").innerHTML = `<table><tr><th>Class</th><th>Year</th><th>Students</th><th>Sessions</th></tr>` +
    classes.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.year)}</td><td>${c.students}</td><td>${c.sessions}</td></tr>`).join("") + `</table>`;
  await selectClass($("classSelect").value || null);
}

$("classSelect").onchange = () => selectClass($("classSelect").value);

async function selectClass(id) {
  const changed = id !== classId;
  classId = id;
  if (id) localStorage.setItem("cp_class", id);
  updateBanner();
  if (changed) { sessionId = null; localStorage.removeItem("cp_session"); }
  await loadSessions();
  // refresh the tab currently shown, so that it always matches the selected class
  if (changed && activeTab === "students") await loadStudents();
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
    allSessions.map((s) => `<option value="${s.id}" data-code="${s.code}">${esc(s.date)} ${s.time || ""} · ${SESSION_KIND[s.kind] || ""} · ${esc(s.title)} · code ${s.code} · ${s.present} present</option>`).join("");
  if (keep && allSessions.some((s) => s.id === keep)) $("sessionSelect").value = keep;
  renderSessionsTable();
  await selectSession($("sessionSelect").value || null);
}

function renderSessionsTable() {
  $("sessionsTable").innerHTML = allSessions.length === 0 ? `<p class="muted">No session yet. Create one in the Live session tab.</p>` :
    `<table><tr><th>Date</th><th>Time</th><th>Type</th><th>Title</th><th>Code</th><th>Present</th><th>Quizzes</th><th></th></tr>` +
    allSessions.map((s) => `<tr data-id="${s.id}"><td class="c-date">${esc(s.date)}</td><td class="c-time">${s.time || ""}</td>
      <td class="c-kind"><span class="kind ${s.kind}">${SESSION_KIND[s.kind] || s.kind}</span></td><td class="c-title">${esc(s.title)}</td>
      <td>${s.code}</td><td>${s.present}</td><td>${s.quizzes}</td>
      <td style="white-space:nowrap"><button class="small green" data-open="${s.id}">Open</button>
        <button class="small secondary" data-sedit="${s.id}">Edit</button> <button class="small red" data-sdel="${s.id}">Delete</button></td></tr>`).join("") + `</table>`;
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
    tr.querySelector(".c-time").innerHTML = `<input type="time" class="e-time" value="${s.time || ""}" style="width:110px">`;
    tr.querySelector(".c-kind").innerHTML = `<select class="e-kind" style="width:auto">${Object.entries(SESSION_KIND).map(([k, v]) => `<option value="${k}" ${k === s.kind ? "selected" : ""}>${v}</option>`).join("")}</select>`;
    tr.querySelector(".c-title").innerHTML = `<input class="e-title" value="${esc(s.title)}">`;
    b.textContent = "Save"; b.className = "small green";
    b.onclick = async () => {
      try {
        await rpc("t_update_session", { p_session: s.id, p_title: tr.querySelector(".e-title").value, p_date: tr.querySelector(".e-date").value,
          p_time: tr.querySelector(".e-time").value || null, p_kind: tr.querySelector(".e-kind").value });
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
  if (!sessionId) { $("sessionUrl").textContent = ""; return; }
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
  pollTimer = setInterval(refreshLive, CONFIG.teacherPollMs);
  attendanceTimer = setInterval(refreshAttendance, 5000);
}

// Every change: tell the phones through the live channel, then refresh.
async function act(fn, args, okMessage) {
  try {
    await rpc(fn, args);
    if (channel) channel.ping();
    if (okMessage) toast(okMessage, "ok");
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

async function saveSessionOptions() {
  await act("t_set_session_options", { p_session: sessionId, p_att_window: Number($("optWindow").value), p_check_location: $("optLocation").checked }, "Session settings saved.");
}
$("optWindow").onchange = saveSessionOptions;
$("optLocation").onchange = saveSessionOptions;
$("projectorBtn").onclick = () => window.open("projector.html?session=" + sessionId, "classpulse_projector");
// The push list: demos of the site (config.js) + the teacher's own resources + a free address.
function pushChoices() {
  const site = CONFIG.links.map((l) => ({ label: l.label, url: l.url, screen: l.screen, group: "Demos of the site" }));
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

function updateScreenBtn() {
  const c = pushChoices()[$("linkSelect").value];
  $("screenBtn").classList.toggle("hidden", !(c && c.screen));
}
$("linkSelect").onchange = updateScreenBtn;
$("screenBtn").onclick = () => {
  const c = pushChoices()[$("linkSelect").value];
  if (c && c.screen) window.open(new URL(c.screen, location.href).href, "classpulse_demo_screen");
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
    const r = await rpc("t_share_link", { p_session: sessionId, p_url: url, p_label: link.label });
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
  $("showQuizBtn").disabled = !s.active_quiz_id || s.activity === "quiz";
  if (document.activeElement !== $("optWindow")) $("optWindow").value = String(s.att_window_s || 15);
  $("optLocation").checked = !!s.check_location;
  checkLocation = !!s.check_location;
  renderQuizLive();
  autoMode();
}

function renderQuizLive() {
  const q = live.quiz;
  const box = $("quizLive");
  if (!q) { box.innerHTML = `<p class="muted">No quiz running.</p>`; $("lockedBox").classList.add("hidden"); return; }
  let left = "";
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
  const modeLabel = { each: "answers after each question", end: "answers at the end", never: "answers never shown" };
  $("quizSelect").innerHTML = quizzes.map((q) => `<option value="${q.id}">[${KIND_LABEL[q.kind] || "Quiz"}${q.graded ? "" : ", not graded"}] ${esc(q.title)} (${q.per_student ? q.count + " q. per student from " + q.pool : q.count + " q."}, /${Number(q.total_points)}, ${q.status}, ${modeLabel[q.reveal_mode] || ""}${q.time_override ? ", " + q.time_override + " s each" : ""})</option>`).join("") ||
    `<option value="">- create a quiz below -</option>`;
  allQuestions = await rpc("t_list_questions", { p_module: null });
  fillPickFilters();
  renderQuestionPicker();
  if ($("drawRules").children.length === 0) addDrawRule();
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
      <td>${esc(q.module)} · ${esc(q.chapter)} · ${esc(q.ref)}</td><td>${esc(q.text)}</td><td>${q.correct.length > 1 ? "several" : "one"}</td><td>${q.time_limit} s</td></tr>`).join("") + `</table>`;
  $("quizQuestionList").querySelectorAll("input[type=checkbox]").forEach((cb) => cb.onchange = () => {
    picked = cb.checked ? picked.concat(cb.value) : picked.filter((id) => id !== cb.value);
    $("pickCount").textContent = picked.length;
  });
}
$("pickModule").onchange = () => { $("pickChapter").value = ""; fillPickFilters(); renderQuestionPicker(); };
$("pickChapter").onchange = renderQuestionPicker;
$("quizFilter").oninput = renderQuestionPicker;
$("clearPickBtn").onclick = () => { picked = []; renderQuestionPicker(); };

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
  $("quizGraded").disabled = survey; if (survey) $("quizGraded").checked = false;
  $("quizProjector").disabled = perStudent;
  if (perStudent) $("quizProjector").checked = false;
  if (survey && !perStudent) $("quizProjector").checked = true;
}
["quizKind", "quizPerStudent"].forEach((id) => { $(id).onchange = syncQuizOptions; });

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
      p_per_student_count: perStudent, p_show_on_projector: $("quizProjector").checked });
    toast(perStudent ? `Quiz created: ${perStudent} question(s) per student, drawn from ${ids.length}.` : `Quiz created with ${ids.length} question(s).`, "ok");
    $("quizTitle").value = "";
    picked = [];
    await loadQuizzes();
    $("quizSelect").value = $("quizSelect").options[$("quizSelect").options.length - 1].value;
  } catch (e) { toast(e.message, "error"); }
};

const currentQuiz = () => (live && live.quiz ? live.quiz.id : $("quizSelect").value);
$("openBtn").onclick = () => {
  if (!$("quizSelect").value) { toast("Create or choose a quiz first.", "error"); return; }
  if (questionRunning() && !confirm("A question is running. Leave it and show the rules of the selected quiz?")) return;
  act("t_quiz_open", { p_quiz: $("quizSelect").value }, "The phones show the rules. No timer runs yet.");
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
$("revealBtn").onclick = () => act("t_quiz_reveal", { p_quiz: currentQuiz() });
$("nextBtn").onclick = () => act("t_quiz_next", { p_quiz: currentQuiz() });
$("addTimeBtn").onclick = () => act("t_quiz_add_time", { p_quiz: currentQuiz(), p_seconds: Number($("addTimeSel").value) },
  `+${$("addTimeSel").value} s added to the current question.`);
$("finishBtn").onclick = () => { if (confirm("Finish the quiz now?")) act("t_quiz_finish", { p_quiz: currentQuiz() }); };

// ------------------------------------------------------------------ attendance list
async function refreshAttendance() {
  if (!sessionId) return;
  let list;
  try { list = await rpc("t_attendance_list", { p_session: sessionId }); } catch (e) { return; }
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
  const far = enoughPositions ? list.filter((r) => checkLocation && r.distance > (CONFIG.farFromRoomM || 300)).length : 0;
  $("attendanceTable").innerHTML = (far ? `<p class="far">⚠ ${far} student(s) checked in far from the rest of the class.</p>` : "") +
    `<table><tr><th>Name</th><th>Matricule</th><th>Status</th><th></th>${checkLocation ? "<th>Position</th>" : ""}<th>Bonus ${SESSION_KIND[live && live.session.kind] || ""}</th></tr>` + list.map((r) =>
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

// ------------------------------------------------------------------ students
async function loadStudents() {
  if (!classId) { $("studentsTable").innerHTML = ""; return; }
  const all = await rpc("t_list_students", { p_class: classId });
  const f = norm($("studentSearch").value);
  const list = all.filter((s) => !f || norm(`${s.matricule} ${s.last_name} ${s.first_name}`).includes(f));
  $("studentsTable").innerHTML = `<p class="muted">${all.length} students${f ? ` · ${list.length} shown` : ""} · ${list.filter((s) => s.registered).length} registered a phone</p>
    <table><tr><th>Matricule</th><th>Last name</th><th>First name</th><th>Official list</th><th>Phone</th><th></th></tr>` + list.map((s) =>
    `<tr data-id="${s.id}"><td class="c-mat">${esc(s.matricule)}</td><td class="c-last"><button class="linklike" data-profile="${s.id}">${esc(s.last_name)}</button></td><td class="c-first">${esc(s.first_name)}</td>
     <td>${s.official ? "yes" : '<span class="badge no">no</span>'}</td>
     <td>${s.registered ? "registered" : "-"}${s.reset_allowed ? ' <span class="badge info">new phone allowed</span>' : ""}</td>
     <td style="white-space:nowrap"><button class="small secondary" data-edit="${s.id}">Edit</button>
       <button class="small red" data-del="${s.id}">Delete</button>
       ${s.registered ? `<button class="small secondary" data-reset="${s.id}">Allow a new phone</button>` : ""}</td></tr>`).join("") + `</table>`;
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
  if (!confirm(`Import ${rows.length} students from sheet "${$("stSheet").value}" into the class "${classNames[classId]}"?`)) return;
  try {
    const r = await rpc("t_import_students", { p_class: classId, p_rows: rows });
    toast(`${r.added} added, ${r.updated} updated.`, "ok");
    loadStudents();
  } catch (e) { toast(e.message, "error"); }
};

// ------------------------------------------------------------------ questions
async function loadQuestions(showModule) {
  allQuestions = await rpc("t_list_questions", { p_module: null });
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
    list.map((q) => `<tr><td><input type="checkbox" class="qdel" value="${q.id}" style="width:auto"><br><button class="small secondary" data-qedit="${q.id}">Edit</button></td><td>${esc(q.module)}</td><td>${esc(q.chapter)}</td><td>${esc(q.ref)}</td><td>${esc(q.text)}<br><span class="muted">${q.options.map((o, i) => LETTERS[i] + ". " + esc(o)).join(" · ")}</span></td>
      <td>${q.correct.length ? q.correct.map((c) => LETTERS[c]).join(",") : '<span class="kind">survey</span>'}</td><td>${q.points}</td><td>${q.time_limit} s</td></tr>`).join("") + `</table>`;
}
$("questionSearch").oninput = renderQuestionsTable;

$("qModuleFilter").onchange = renderQuestionsTable;

// Backup of the question bank: one sheet per module, same columns as the import template (re-importable).
$("exportBankBtn").onclick = async () => {
  const all = await rpc("t_list_questions", { p_module: null });
  if (all.length === 0) { toast("The bank is empty.", "error"); return; }
  const wb = XLSX.utils.book_new();
  [...new Set(all.map((q) => q.module))].sort().forEach((m) => {
    const rows = [["ref", "chapter", "question", "A", "B", "C", "D", "E", "correct", "points", "time_s"]];
    all.filter((q) => q.module === m).forEach((q) => rows.push([q.ref, q.chapter, q.text,
      ...[0, 1, 2, 3, 4].map((i) => q.options[i] || ""), q.correct.map((c) => LETTERS[c]).join(","), Number(q.points), q.time_limit]));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [8, 10, 60, 28, 28, 28, 28, 28, 8, 7, 7].map((w) => ({ wch: w }));
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
  renderDemos();
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

function renderDemos() {
  if (!$("demosTable")) return;
  const full = (u) => new URL(u, location.href).href;
  $("demosTable").innerHTML = CONFIG.links.length === 0 ? `<p class="muted">No demo declared in config.js.</p>` :
    `<table><tr><th>Demo</th><th></th></tr>` + CONFIG.links.map((l, i) => `<tr><td><strong>${esc(l.label)}</strong><br><span class="muted">${esc(l.url)}</span></td>
      <td style="white-space:nowrap">${l.screen ? `<a href="${esc(full(l.screen))}" target="classpulse_demo_screen"><button class="small orange">Open the big screen</button></a> ` : ""}
        <a href="${esc(full(l.url))}" target="_blank" rel="noopener"><button class="small secondary">Open the phone page</button></a>
        <button class="small green" data-push-demo="${i}">Push to phones</button></td></tr>`).join("") + `</table>`;
  $("demosTable").querySelectorAll("[data-push-demo]").forEach((b) => b.onclick = () => {
    const l = CONFIG.links[Number(b.dataset.pushDemo)];
    pushLink({ label: l.label, url: l.url });
  });
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
async function openProfile(studentId) {
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
      <td>${q.kind === "survey" ? "-" : q.mark == null ? '<span class="badge no">no answer</span>' : `${Number(q.mark)} / ${Number(q.total_points)}`}</td><td>${q.left_screen || ""}</td></tr>`).join("") + `</table>`;
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
