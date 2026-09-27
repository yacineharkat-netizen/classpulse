// ClassPulse - teacher console.

let classId = null;
let sessionId = null;
let sessionCode = null;
let live = null;              // last t_live result
let channel = null;
let pollTimer = null;
let attendanceTimer = null;
let autoTimer = null;
let allQuestions = [];

// ------------------------------------------------------------------ login
async function init() {
  $("autoDelay").textContent = CONFIG.autoNextDelayS;
  $("dropLowest").textContent = CONFIG.dropLowest;
  $("newSessionDate").value = new Date().toISOString().slice(0, 10);
  CONFIG.links.forEach((l, i) => { $("linkSelect").insertAdjacentHTML("beforeend", `<option value="${i}">${esc(l.label)}</option>`); });
  $("linkSelect").insertAdjacentHTML("beforeend", `<option value="custom">Other address…</option>`);
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
  await loadClasses();
}

// ------------------------------------------------------------------ navigation
document.querySelectorAll("nav button[data-tab]").forEach((b) => {
  b.onclick = () => {
    document.querySelectorAll("nav button[data-tab]").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll("main section").forEach((s) => s.classList.toggle("hidden", s.id !== "tab-" + b.dataset.tab));
    const loaders = { students: loadStudents, questions: loadQuestions, classes: loadClasses };
    if (loaders[b.dataset.tab]) loaders[b.dataset.tab]();
  };
});

// ------------------------------------------------------------------ classes
async function loadClasses() {
  const classes = await rpc("t_list_classes");
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
  classId = id;
  if (id) localStorage.setItem("cp_class", id);
  await loadSessions();
}

$("createClassBtn").onclick = async () => {
  try {
    classId = await rpc("t_create_class", { p_name: $("className").value, p_year: $("classYear").value });
    toast("Class created.", "ok");
    await loadClasses();
  } catch (e) { toast(e.message, "error"); }
};

// ------------------------------------------------------------------ sessions
async function loadSessions() {
  if (!classId) { $("sessionSelect").innerHTML = ""; return; }
  const sessions = await rpc("t_list_sessions", { p_class: classId });
  const keep = sessionId || localStorage.getItem("cp_session");
  $("sessionSelect").innerHTML = `<option value="">- choose a session -</option>` +
    sessions.map((s) => `<option value="${s.id}" data-code="${s.code}">${esc(s.date)} · ${esc(s.title)} · code ${s.code} · ${s.present} present</option>`).join("");
  if (keep && sessions.some((s) => s.id === keep)) $("sessionSelect").value = keep;
  await selectSession($("sessionSelect").value || null);
}

$("sessionSelect").onchange = () => selectSession($("sessionSelect").value);

$("createSessionBtn").onclick = async () => {
  try {
    const s = await rpc("t_create_session", { p_class: classId, p_title: $("newSessionTitle").value || "Session", p_date: $("newSessionDate").value });
    sessionId = s.id;
    toast("Session created, code " + s.code, "ok");
    await loadSessions();
  } catch (e) { toast(e.message, "error"); }
};

async function selectSession(id) {
  sessionId = id || null;
  clearInterval(pollTimer); clearInterval(attendanceTimer);
  $("liveArea").classList.toggle("hidden", !sessionId);
  if (!sessionId) { $("sessionUrl").textContent = ""; return; }
  localStorage.setItem("cp_session", sessionId);
  sessionCode = $("sessionSelect").selectedOptions[0].dataset.code;
  const url = siteUrl("student.html") + "?s=" + sessionCode;
  $("sessionUrl").innerHTML = `Student address: <a href="${url}" target="_blank">${url}</a>`;
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

$("attOnBtn").onclick = () => act("t_set_activity", { p_session: sessionId, p_activity: "attendance" }, "Attendance open.");
$("attOffBtn").onclick = () => act("t_set_attendance_open", { p_session: sessionId, p_open: false }, "Attendance closed.");
$("idleBtn").onclick = () => act("t_set_activity", { p_session: sessionId, p_activity: "idle" });
$("projectorBtn").onclick = () => window.open("projector.html?session=" + sessionId, "classpulse_projector");
$("linkBtn").onclick = () => {
  const v = $("linkSelect").value;
  let link = CONFIG.links[v];
  if (v === "custom") {
    const url = prompt("Address to open on the phones (https://...)");
    if (!url) return;
    link = { label: "Open the link", url };
  }
  act("t_set_activity", { p_session: sessionId, p_activity: "link", p_link_url: link.url, p_link_label: link.label }, "Link sent to the phones.");
};

// ------------------------------------------------------------------ live figures
async function refreshLive() {
  if (!sessionId) return;
  try { live = await rpc("t_live", { p_session: sessionId }); } catch (e) { return; }
  const s = live.session;
  $("activityBadge").textContent = { idle: "Waiting screen", attendance: "Attendance", quiz: "Quiz", link: "Link: " + (s.link_label || "") }[s.activity] || s.activity;
  $("presentCount").textContent = live.present;
  $("classSize").textContent = live.class_size;
  $("attState").textContent = s.attendance_open ? "open" : "closed";
  renderQuizLive();
  autoMode();
}

function renderQuizLive() {
  const q = live.quiz;
  const box = $("quizLive");
  if (!q) { box.innerHTML = `<p class="muted">No quiz running.</p>`; $("lockedList").textContent = "None."; return; }
  let left = "";
  if (q.phase === "question" || q.phase === "reveal") {
    const max = Math.max(1, ...(q.distribution || [0]));
    left = `<div><p><strong>Question ${q.index + 1} / ${q.count}</strong> · ${q.phase === "question" ? `<span class="timer">${formatSeconds(q.remaining_ms)} s</span>` : "answers shown"}</p>
      <p>${esc(q.question)}</p><div class="bars">` +
      q.options.map((o, i) => `<div class="bar"><span class="l">${LETTERS[i]}</span><div class="b ${q.correct.includes(i) ? "ok" : ""}" style="width:${Math.max(4, (200 * q.distribution[i]) / max)}px"></div>
        <span>${q.distribution[i]}</span><span class="muted">${esc(o)}</span></div>`).join("") + `</div></div>`;
  } else {
    left = `<div><p><strong>${esc(q.title)}</strong></p><p>${q.phase === "finished" ? "Finished." : "Not started."}</p></div>`;
  }
  const right = `<div><div class="stat">${q.answers} / ${live.present}</div><div class="muted">answers to this question</div>
    <div class="stat" style="margin-top:10px">${q.success_rate == null ? "-" : q.success_rate + " %"}</div><div class="muted">full marks</div></div>`;
  box.innerHTML = left + right;
  $("lockedList").innerHTML = q.locked.length === 0 ? "None." : `<table>` + q.locked.map((l) =>
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
  $("quizSelect").innerHTML = quizzes.map((q) => `<option value="${q.id}">${esc(q.title)} (${q.count} questions, ${q.status})</option>`).join("") ||
    `<option value="">- create a quiz below -</option>`;
  if (allQuestions.length === 0) allQuestions = await rpc("t_list_questions", { p_module: null });
  renderQuestionPicker();
}

function renderQuestionPicker() {
  const f = $("quizFilter").value.trim().toLowerCase();
  const list = allQuestions.filter((q) => !f || (q.module + " " + q.chapter).toLowerCase().includes(f));
  $("quizQuestionList").innerHTML = list.length === 0 ? `<p class="muted">No question. Import questions in the Questions tab.</p>` :
    `<table>` + list.map((q) => `<tr><td><input type="checkbox" value="${q.id}" style="width:auto"></td><td>${esc(q.module)} · ${esc(q.chapter)} · ${esc(q.ref)}</td>
      <td>${esc(q.text)}</td><td>${q.time_limit} s</td></tr>`).join("") + `</table>`;
}
$("quizFilter").oninput = renderQuestionPicker;

$("createQuizBtn").onclick = async () => {
  const ids = [...$("quizQuestionList").querySelectorAll("input:checked")].map((c) => c.value);
  try {
    await rpc("t_create_quiz", { p_session: sessionId, p_title: $("quizTitle").value || "Quiz", p_question_ids: ids });
    toast("Quiz created.", "ok");
    await loadQuizzes();
  } catch (e) { toast(e.message, "error"); }
};

const currentQuiz = () => (live && live.quiz ? live.quiz.id : $("quizSelect").value);
$("startBtn").onclick = () => {
  if (!$("quizSelect").value) { toast("Create or choose a quiz first.", "error"); return; }
  if (!confirm("Start this quiz now? The phones will show the first question.")) return;
  act("t_quiz_start", { p_quiz: $("quizSelect").value });
};
$("revealBtn").onclick = () => act("t_quiz_reveal", { p_quiz: currentQuiz() });
$("nextBtn").onclick = () => act("t_quiz_next", { p_quiz: currentQuiz() });
$("addTimeBtn").onclick = () => act("t_quiz_add_time", { p_quiz: currentQuiz(), p_seconds: 15 });
$("finishBtn").onclick = () => { if (confirm("Finish the quiz now?")) act("t_quiz_finish", { p_quiz: currentQuiz() }); };

// ------------------------------------------------------------------ attendance list
async function refreshAttendance() {
  if (!sessionId) return;
  let list;
  try { list = await rpc("t_attendance_list", { p_session: sessionId }); } catch (e) { return; }
  if (document.activeElement && document.activeElement.dataset && document.activeElement.dataset.student) return; // user is editing
  const opts = ["", "present", "late", "absent", "excused"];
  $("attendanceTable").innerHTML = `<table><tr><th>Name</th><th>Matricule</th><th>Status</th><th></th></tr>` + list.map((r) =>
    `<tr><td>${esc(r.name)} ${r.official ? "" : '<span class="badge no">not in official list</span>'}</td><td>${esc(r.matricule)}</td>
     <td><select data-student="${r.student_id}" style="width:auto">${opts.map((o) => `<option value="${o || "none"}" ${(r.status || "") === o ? "selected" : ""}>${o || "-"}</option>`).join("")}</select></td>
     <td class="muted">${r.method === "manual" ? "manual" : r.at ? new Date(r.at).toLocaleTimeString() : ""}</td></tr>`).join("") + `</table>`;
  $("attendanceTable").querySelectorAll("select").forEach((sel) => sel.onchange = async () => {
    await act("t_set_attendance", { p_session: sessionId, p_student: sel.dataset.student, p_status: sel.value });
    sel.blur();
    refreshAttendance();
  });
}

// ------------------------------------------------------------------ students
async function loadStudents() {
  if (!classId) return;
  const list = await rpc("t_list_students", { p_class: classId });
  $("studentsTable").innerHTML = `<p class="muted">${list.length} students · ${list.filter((s) => s.registered).length} registered a phone</p>
    <table><tr><th>Matricule</th><th>Name</th><th>Official list</th><th>Phone</th><th></th></tr>` + list.map((s) =>
    `<tr><td>${esc(s.matricule)}</td><td>${esc(s.last_name)} ${esc(s.first_name)}</td><td>${s.official ? "yes" : '<span class="badge no">no</span>'}</td>
     <td>${s.registered ? "registered" : "-"}${s.reset_allowed ? ' <span class="badge info">new phone allowed</span>' : ""}</td>
     <td>${s.registered ? `<button class="small secondary" data-reset="${s.id}">Allow a new phone</button>` : ""}</td></tr>`).join("") + `</table>`;
  $("studentsTable").querySelectorAll("[data-reset]").forEach((b) => b.onclick = async () => {
    if (!confirm("Allow this student to register a new phone? The old phone will stop working.")) return;
    try { await rpc("t_allow_new_device", { p_student: b.dataset.reset }); toast("The student can now log in on a new phone with his PIN.", "ok"); loadStudents(); }
    catch (e) { toast(e.message, "error"); }
  });
}

$("importStudentsBtn").onclick = async () => {
  const file = $("studentsFile").files[0];
  if (!file || !classId) { toast("Choose a class and a file.", "error"); return; }
  try {
    const rows = parseStudents(await readSheet(file));
    if (rows.length === 0) { toast("No student found: check the column names.", "error"); return; }
    const r = await rpc("t_import_students", { p_class: classId, p_rows: rows });
    toast(`${r.added} added, ${r.updated} updated.`, "ok");
    loadStudents();
  } catch (e) { toast(e.message, "error"); }
};

// ------------------------------------------------------------------ questions
async function loadQuestions() {
  allQuestions = await rpc("t_list_questions", { p_module: null });
  $("questionsTable").innerHTML = `<p class="muted">${allQuestions.length} questions</p><table><tr><th>Module</th><th>Chapter</th><th>Ref</th><th>Question</th><th>Correct</th><th>Pts</th><th>Time</th></tr>` +
    allQuestions.map((q) => `<tr><td>${esc(q.module)}</td><td>${esc(q.chapter)}</td><td>${esc(q.ref)}</td><td>${esc(q.text)}<br><span class="muted">${q.options.map((o, i) => LETTERS[i] + ". " + esc(o)).join(" · ")}</span></td>
      <td>${q.correct.map((c) => LETTERS[c]).join(",")}</td><td>${q.points}</td><td>${q.time_limit} s</td></tr>`).join("") + `</table>`;
}

$("importQuestionsBtn").onclick = async () => {
  const file = $("questionsFile").files[0];
  const module = $("moduleName").value.trim();
  if (!file || !module) { toast("Type the module name and choose a file.", "error"); return; }
  try {
    const { questions, problems } = parseQuestions(await readSheet(file));
    if (problems.length) { alert("Problems in the file:\n" + problems.join("\n")); return; }
    const r = await rpc("t_import_questions", { p_module: module, p_rows: questions });
    toast(`${r.imported} questions imported.`, "ok");
    loadQuestions();
  } catch (e) { toast(e.message, "error"); }
};

// ------------------------------------------------------------------ export
$("exportBtn").onclick = async () => {
  if (!classId) return;
  try { downloadResults(await rpc("t_export", { p_class: classId })); }
  catch (e) { toast(e.message, "error"); }
};

init();
