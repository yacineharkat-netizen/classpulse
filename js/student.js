// ClassPulse - student page.
(window.CP_FILES = window.CP_FILES || {})["student.js"] = "7"; // file version, checked by common.js
// Flow: session code -> (first time: registration) -> check-in with the rotating QR code
//       -> whatever the teacher pushes: waiting screen, link, quiz.

const params = new URLSearchParams(window.location.search);
let sessionCode = (params.get("s") || "").toUpperCase();
let attendanceCode = params.get("a");
let sessionInfo = null;     // {class_id, class_name, title}
let deviceToken = null;
let state = null;           // last state returned by s_state
let lastRendered = "";
let channel = null;
let localDeadline = 0;      // Date.now() value at which the current question closes
let selection = [];         // positions selected on screen for the current question
let selectionKey = "";      // quiz id + question index the selection belongs to
let armedQuiz = null;       // quiz id for which the student entered the guarded quiz screen
let sending = false;

// ------------------------------------------------------------------ helpers
function show(viewId) {
  ["viewCode", "viewRegister", "viewNewDevice", "viewLive"].forEach((v) => $(v).classList.toggle("hidden", v !== viewId));
}
function tokenKey() { return "cp_device_" + sessionInfo.class_id; }
function saveToken(token) {
  deviceToken = token;
  try { localStorage.setItem(tokenKey(), token); } catch (e) { /* private mode: token kept in memory only */ }
}
function dropAttendanceCodeFromUrl() {
  // The attendance code expires in seconds: do not keep it in the address bar.
  params.delete("a");
  const q = params.toString();
  history.replaceState(null, "", window.location.pathname + (q ? "?" + q : ""));
}

// ------------------------------------------------------------------ start
async function start() {
  if (!sessionCode) { show("viewCode"); return; }
  try {
    sessionInfo = await rpc("s_session_info", { p_code: sessionCode });
  } catch (e) {
    toast(e.message, "error");
    show("viewCode");
    return;
  }
  $("brand").textContent = sessionInfo.class_name;
  $("sessionLine").textContent = sessionInfo.title;
  try { deviceToken = localStorage.getItem(tokenKey()); } catch (e) { deviceToken = null; }
  if (!deviceToken) { show("viewRegister"); return; }
  await afterIdentified();
}

async function afterIdentified() {
  if (attendanceCode) {
    try {
      const result = await rpc("s_checkin", { p_device: deviceToken, p_code: sessionCode, p_att_code: attendanceCode });
      showCheckinResult(result);
    } catch (e) {
      if (e.code === "UNKNOWN_DEVICE") { forgetDevice(); return; }
      toast(e.message, "error");
    }
    attendanceCode = null;
    dropAttendanceCodeFromUrl();
  }
  show("viewLive");
  channel = liveChannel(sessionCode, fetchState);
  await fetchState();
  pollLoop();
  setInterval(tick, 250);
}

function forgetDevice() {
  try { localStorage.removeItem(tokenKey()); } catch (e) { /* ignore */ }
  deviceToken = null;
  toast("This phone is not registered for this class anymore. Register again.", "error");
  show("viewRegister");
}

// Optional position check: sent after a successful check-in, never before (the code would expire).
let positionSent = false;
function sendPositionIfAsked(result) {
  const asked = (state && state.check_location) || (sessionInfo && sessionInfo.check_location);
  if (!asked || positionSent || !(result === "PRESENT" || result === "ALREADY_PRESENT") || !navigator.geolocation) return;
  positionSent = true;
  navigator.geolocation.getCurrentPosition(
    (pos) => rpc("s_report_position", { p_device: deviceToken, p_code: sessionCode,
      p_lat: pos.coords.latitude, p_lon: pos.coords.longitude, p_acc: pos.coords.accuracy }).catch(() => {}),
    () => toast("Position not shared: the teacher will see it in the attendance list.", "error"),
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 60000 });
}

function showCheckinResult(result) {
  sendPositionIfAsked(result);
  const messages = {
    PRESENT: ["You are checked in. Welcome!", "ok"],
    ALREADY_PRESENT: ["You were already checked in.", "ok"],
    ATTENDANCE_CLOSED: ["Attendance is closed.", "error"],
    CODE_EXPIRED: ["This QR code has expired. Scan the one on the screen again.", "error"],
  };
  const m = messages[result] || [result, ""];
  toast(m[0], m[1]);
}

function pollLoop() {
  const delay = channel && channel.connected ? CONFIG.studentSafetyPollMs : CONFIG.studentPollMs;
  setTimeout(async () => { await fetchState(); pollLoop(); }, delay);
}

// ------------------------------------------------------------------ registration
$("codeBtn").onclick = () => {
  const code = $("codeInput").value.trim().toUpperCase();
  if (code.length !== 6) { toast("The code has 6 characters.", "error"); return; }
  params.set("s", code);
  window.location.search = params.toString();
};

$("regBtn").onclick = async () => {
  $("regBtn").disabled = true;
  try {
    const r = await rpc("s_register", {
      p_code: sessionCode, p_matricule: $("regMat").value, p_first_name: $("regFirst").value,
      p_last_name: $("regLast").value, p_pin: $("regPin").value, p_att_code: attendanceCode,
    });
    saveToken(r.device_token);
    if (attendanceCode) { showCheckinResult(r.checkin); attendanceCode = null; dropAttendanceCodeFromUrl(); }
    else toast("Registered. Now scan the QR code on the screen to check in.", "ok");
    await afterIdentified();
  } catch (e) {
    toast(e.message, "error");
  } finally {
    $("regBtn").disabled = false;
  }
};

$("toNewDevice").onclick = (ev) => { ev.preventDefault(); show("viewNewDevice"); };
$("toRegister").onclick = (ev) => { ev.preventDefault(); show("viewRegister"); };

$("ndBtn").onclick = async () => {
  try {
    const r = await rpc("s_login_new_device", { p_code: sessionCode, p_matricule: $("ndMat").value, p_pin: $("ndPin").value });
    saveToken(r.device_token);
    toast("Welcome back, " + r.first_name + ".", "ok");
    await afterIdentified();
  } catch (e) {
    toast(e.message, "error");
  }
};

// ------------------------------------------------------------------ state
async function fetchState() {
  if (!deviceToken) return;
  try {
    state = await rpc("s_state", { p_device: deviceToken, p_code: sessionCode });
  } catch (e) {
    if (e.code === "UNKNOWN_DEVICE") { forgetDevice(); return; }
    return; // network hiccup: keep the last screen, retry at next poll
  }
  const q = state.quiz;
  if (q && q.phase === "question") localDeadline = Date.now() + q.remaining_ms;
  // After a leave, if the report could not be sent, send it now.
  const pending = sessionStorage.getItem("cp_pending_leave");
  if (pending && q && q.quiz_id === pending && !q.locked) reportLeave("late_report");
  sessionStorage.removeItem("cp_pending_leave");
  if (!q || q.phase === "finished" || q.quiz_id !== armedQuiz) disarm(q);
  render();
}

function render() {
  const snapshot = JSON.stringify([state, selection, armedQuiz]).replace(/"remaining_ms":\d+/, "");
  if (snapshot === lastRendered) return;
  lastRendered = snapshot;

  $("presence").innerHTML = state.present ? '<span class="badge ok">Present</span>' : '<span class="badge no">Not checked in</span>';
  const who = `<p class="muted">${esc(state.student.first_name)} ${esc(state.student.last_name)} · ${esc(state.student.matricule)}</p>`;
  const live = $("viewLive");

  if (!state.present && state.attendance_open) {
    live.innerHTML = who + bigStatus("📷", "Scan the QR code on the screen", `It changes every ${state.att_window_s || 15} seconds. You can also type the code shown under it:`) +
      `<div class="card"><input id="attInput" maxlength="6" style="text-transform:uppercase;font-size:22px;letter-spacing:4px"><button id="attBtn" style="margin-top:10px;width:100%">Check in</button></div>`;
    $("attBtn").onclick = async () => {
      try {
        const r = await rpc("s_checkin", { p_device: deviceToken, p_code: sessionCode, p_att_code: $("attInput").value.trim().toUpperCase() });
        showCheckinResult(r);
        await fetchState();
      } catch (e) { toast(e.message, "error"); }
    };
    return;
  }

  if (state.activity === "quiz" && state.quiz) { renderQuiz(live, who); return; }
  if (state.activity === "quiz" && !state.present && !state.attendance_open) {
    live.innerHTML = who + bigStatus("⛔", "Quiz in progress", "Only students checked in during this session can take part.");
    return;
  }
  if (state.activity === "link" && state.link_url) {
    live.innerHTML = who + bigStatus("🔗", esc(state.link_label || "Open the link"), "") +
      `<a href="${esc(state.link_url)}" target="_blank" rel="noopener"><button style="width:100%;font-size:20px">Open</button></a>` + sharedLinksHtml();
    return;
  }
  if (state.present) {
    live.innerHTML = who + bigStatus("✅", "You are checked in", "Keep this page open. The next activity will appear here automatically.") + sharedLinksHtml();
  } else {
    live.innerHTML = who + bigStatus("⏳", "Waiting for the teacher", "Attendance is not open yet.");
  }
}

function bigStatus(icon, title, text) {
  return `<div class="big-status"><div class="icon">${icon}</div><div class="title">${title}</div><div class="muted">${text}</div></div>`;
}

// ------------------------------------------------------------------ quiz
function rulesFor(q) {
  if (q.kind === "survey") {
    return `<li>This is a <strong>survey</strong>: there is no right or wrong answer and it is <strong>not graded</strong>.</li>
      <li>Answer honestly: the teacher only sees the totals for the class, to improve the course.</li>`;
  }
  const what = !q.graded ? "This quiz is for practice: it is <strong>not counted</strong> in your marks."
    : q.kind === "test" ? "This is a graded test." : q.kind === "tp" ? "This is the test of the lab session (TP)." : "This quiz counts in your course mark.";
  const scoring = q.scoring === "all"
    ? `<li><strong>All or nothing:</strong> a question gives its points only if you tick exactly all the correct answers.</li>`
    : `<li><strong>Each wrong tick cancels one correct tick.</strong> With 3 correct answers, 1 correct tick gives one third of the points. A question never gives negative points; ticking everything gives 0.</li>`;
  return `<li>${what} Marked out of <strong>${Number(q.total_points)}</strong>${q.per_student ? "; each student has his own questions" : ""}.</li>
    <li><strong>A question may have one or more correct answers.</strong> Tick every answer you think is correct.</li>${scoring}`;
}

// Documents and links shared by the teacher during this session (kept after they were pushed).
function sharedLinksHtml() {
  const list = state.shared_links || [];
  if (!list.length) return "";
  return `<div class="card"><strong>Documents of this session</strong>` +
    list.map((l) => `<p><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label || l.url)}</a></p>`).join("") + `</div>`;
}
function renderQuiz(live, who) {
  const q = state.quiz;
  const head = `<div class="row" style="justify-content:space-between"><strong>${esc(q.title)}</strong>` +
    (q.index >= 0 && q.phase !== "finished" ? `<span class="muted">Question ${q.index + 1} / ${q.count}</span>` : "") + `</div>`;

  if (q.phase === "finished") {
    const markText = q.kind === "survey" ? "Thank you for your answers."
      : `${q.graded ? "Your mark" : "Your score (practice, not counted)"}: <strong style="font-size:26px">${q.total == null ? "-" : q.total} / ${Number(q.total_points)}</strong>`;
    let html = who + head + bigStatus("🏁", q.kind === "survey" ? "Survey finished" : "Quiz finished", markText) + sharedLinksHtml();
    if (q.review) {
      html += `<div class="protected">` + q.review.map((r, i) => `<div class="card"><div class="muted">Question ${i + 1} · ${r.score == null ? "no answer" : Number(r.score) + " / " + Number(r.points)}</div>
        <div class="question-text">${esc(r.question)}</div>` + r.options.map((o, pos) => {
          let cls = "option";
          if (r.correct && r.correct.includes(pos)) cls += " correct"; else if (r.mine && r.mine.includes(pos)) cls += " wrong";
          return `<div class="${cls}"><strong>${LETTERS[pos]}.</strong> ${esc(o)}</div>`;
        }).join("") + `</div>`).join("") + watermark() + `</div>`;
    }
    live.innerHTML = html;
    return;
  }
  if (q.locked) {
    live.innerHTML = who + head + `<div class="locked-screen"><div style="font-size:54px">🔒</div><h2>You are locked</h2>
      <p>You left the quiz screen. Your answers are frozen.</p><p><strong>Raise your hand: only the teacher can unlock you.</strong></p></div>`;
    return;
  }
  if (armedQuiz !== q.quiz_id) {
    // Rules first. In the "lobby" phase no timer runs: the teacher starts question 1 when students are ready.
    live.innerHTML = who + head + `<div class="card">
      <div style="font-size:42px;text-align:center">📝</div><h2 style="text-align:center">Read the rules</h2>
      <ol class="rules">${rulesFor(q)}
        <li>You can change your answer until the time of the question is over.</li>
        <li><strong>Do not leave this screen</strong> (no other app, no other tab, no notification opened). If you leave, you are locked and only the teacher can unlock you.</li>
        <li>Your name and student number are printed on the questions: any photo or screenshot shows who took it.</li>
      </ol>
      <button id="enterBtn" class="orange" style="width:100%;font-size:19px">I have read the rules, I am ready</button></div>`;
    $("enterBtn").onclick = enterQuiz;
    return;
  }
  if (q.phase === "lobby") {
    live.innerHTML = who + head + bigStatus("✅", "You are ready", "The first question will appear when the teacher starts the quiz. Stay on this screen.");
    return;
  }

  const key = q.quiz_id + ":" + q.index;
  if (selectionKey !== key) { selectionKey = key; selection = q.my_answer ? q.my_answer.slice() : []; }
  const reveal = q.phase === "reveal";
  const answered = q.my_answer && q.my_answer.length > 0;
  let html = who + head;
  if (!reveal) html += `<div class="row" style="justify-content:space-between"><span class="timer" id="timer"></span>` +
    `<span class="answer-kind ${q.multiple === false ? "single" : "multi"}">${q.survey ? "Survey: your opinion, not graded" : q.multiple === false ? "Only one correct answer" : q.multiple ? "Several correct answers: tick all" : "One or more answers may be correct"}</span></div><div class="progress"><div id="bar"></div></div>`;
  html += `<div class="protected"><div class="question-text">${esc(q.question)}</div>`;
  q.options.forEach((opt, pos) => {
    let cls = "option";
    if (reveal && q.correct) {
      if (q.correct.includes(pos)) cls += " correct";
      else if (q.my_answer && q.my_answer.includes(pos)) cls += " wrong";
    } else if (reveal) {
      if (q.my_answer && q.my_answer.includes(pos)) cls += " selected";
    } else if (selection.includes(pos)) cls += " selected";
    html += `<button class="${cls}" data-pos="${pos}" ${reveal ? "disabled" : ""}><strong>${LETTERS[pos]}.</strong> ${esc(opt)}</button>`;
  });
  html += watermark() + `</div>`;
  if (reveal && q.survey) {
    html += `<div class="card" style="text-align:center"><strong>${answered ? "✔ Thank you, answer recorded" : "No answer"}</strong></div>`;
  } else if (reveal && q.reveal_mode === "each") {
    html += `<div class="card" style="text-align:center"><strong>${answered ? "Your score: " + Number(q.my_score) : "No answer"}</strong></div>`;
  } else if (reveal) {
    html += `<div class="card" style="text-align:center"><strong>${answered ? "✔ Answer recorded" : "No answer"}</strong><br>
      <span class="muted">${q.reveal_mode === "end" ? "The correct answers will be shown at the end of the quiz." : "The correct answers are not shown for this quiz."}</span></div>`;
  } else {
    html += `<button id="sendBtn" class="orange" style="width:100%;font-size:19px;margin-top:6px">${answered ? "Change my answer" : "Send my answer"}</button>`;
    if (answered) html += `<p class="muted" style="text-align:center">✔ Answer received. You can change it until the time is over.</p>`;
  }
  live.innerHTML = html;
  if (!reveal) {
    live.querySelectorAll(".option").forEach((b) => b.onclick = () => toggleOption(Number(b.dataset.pos), q.multiple !== false));
    $("sendBtn").onclick = sendAnswer;
    tick();
  }
}

function toggleOption(pos, multiple) {
  if (multiple) selection = selection.includes(pos) ? selection.filter((p) => p !== pos) : selection.concat(pos);
  else selection = [pos];
  render();
}

async function sendAnswer() {
  if (sending) return;
  if (selection.length === 0) { toast("Choose an answer first.", "error"); return; }
  sending = true;
  try {
    await rpc("s_answer", { p_device: deviceToken, p_code: sessionCode, p_quiz: state.quiz.quiz_id, p_index: state.quiz.index, p_positions: selection });
    await fetchState();
  } catch (e) {
    toast(e.message, "error");
    await fetchState();
  } finally {
    sending = false;
  }
}

function tick() {
  if (!state || !state.quiz || state.quiz.phase !== "question") return;
  const left = localDeadline - Date.now();
  const t = $("timer");
  if (t) t.textContent = formatSeconds(left) + " s";
  const bar = $("bar");
  if (bar) bar.style.width = Math.max(0, Math.min(100, (left / Math.max(state.quiz.duration_ms || 1, 1)) * 100)) + "%";
  const btn = $("sendBtn");
  if (btn) btn.disabled = left <= 0;
}

// Name and student number printed across the question: a screenshot or a photo shows who took it.
function watermark() {
  const tag = esc(`${state.student.last_name} ${state.student.first_name} · ${state.student.matricule}`);
  return `<div class="watermark" aria-hidden="true">${Array(14).fill(`<span>${tag}</span>`).join("")}</div>`;
}
// No text selection, no copy, no long-press menu on the quiz.
["copy", "cut", "contextmenu", "selectstart", "dragstart"].forEach((ev) =>
  document.addEventListener(ev, (e) => { if (e.target.closest && e.target.closest(".protected")) e.preventDefault(); }));

// ------------------------------------------------------------------ anti-leave guard
async function enterQuiz() {
  armedQuiz = state.quiz.quiz_id;
  rpc("s_quiz_ready", { p_device: deviceToken, p_code: sessionCode, p_quiz: armedQuiz }).catch(() => {});
  const el = document.documentElement;
  // Full screen exists on Android/desktop browsers, not on iPhone: we still guard with visibility.
  if (el.requestFullscreen) { try { await el.requestFullscreen({ navigationUI: "hide" }); } catch (e) { /* refused: ignore */ } }
  await keepScreenOn();
  lastRendered = "";
  render();
}

// Keep the screen on during the quiz: a phone going to sleep would count as leaving the screen.
let wakeLock = null;
async function keepScreenOn() {
  try { if ("wakeLock" in navigator) wakeLock = await navigator.wakeLock.request("screen"); } catch (e) { wakeLock = null; }
}

function disarm(q) {
  if (armedQuiz && (!q || q.phase === "finished" || q.quiz_id !== armedQuiz)) {
    armedQuiz = null;
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  }
}

function guardActive() {
  return armedQuiz && state && state.quiz && state.quiz.quiz_id === armedQuiz &&
    (state.quiz.phase === "question" || state.quiz.phase === "reveal") && !state.quiz.locked;
}

function reportLeave(kind) {
  const quizId = state.quiz.quiz_id;
  sessionStorage.setItem("cp_pending_leave", quizId);
  // keepalive: the request is still sent while the browser puts the page in background.
  fetch(CONFIG.supabaseUrl + "/rest/v1/rpc/s_report_leave", {
    method: "POST", keepalive: true,
    headers: { "Content-Type": "application/json", apikey: CONFIG.supabaseAnonKey, Authorization: "Bearer " + CONFIG.supabaseAnonKey },
    body: JSON.stringify({ p_device: deviceToken, p_code: sessionCode, p_quiz: quizId, p_kind: kind }),
  }).then((r) => { if (r.ok) sessionStorage.removeItem("cp_pending_leave"); }).catch(() => {});
  state.quiz.locked = true;
  lastRendered = "";
  render();
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && guardActive()) reportLeave("left_screen");
  if (document.visibilityState === "visible") { if (armedQuiz) keepScreenOn(); fetchState(); }
});
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && guardActive()) reportLeave("exit_fullscreen");
});

start();
