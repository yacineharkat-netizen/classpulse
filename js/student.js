// ClassPulse - student page.
(window.CP_FILES = window.CP_FILES || {})["student.js"] = "24"; // file version, checked by common.js
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
let liveNumKey = "", liveNumDraft = "";   // number typed for the current question of a live quiz

// ------------------------------------------------------------------ helpers
function show(viewId) {
  $("viewLive").classList.toggle("hidden", viewId !== "viewLive");
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
// ------------------------------------------------------------------ student space (documents, outside the sessions)
// Every class this phone is registered in keeps a token in localStorage ("cp_device_<class id>").
const DOC_KIND = { course: "Course", tp: "Lab", code: "Code", other: "Document" };
async function renderSpace() {
  const tokens = accountTokens().map((t) => t.token);
  const box = $("spaceBox");
  if (!tokens.length) {
    box.classList.toggle("hidden", !params.has("space"));
    $("spaceList").innerHTML = `<p class="muted">This device is not signed in.</p><a href="index.html"><button style="width:100%">Sign in or register</button></a>`;
    return;
  }
  const blocks = [];
  for (const token of tokens) {
    try {
      const sp = await rpc("s_space", { p_device: token });
      if (sp.docs.length === 0) continue;                 // a class with nothing to show is not listed
      blocks.push(`<div class="space-class"><h3>${esc(sp.class_name)}</h3>` + (
        sp.docs.map((d) => `<a class="space-doc" href="${esc(d.stored ? "doc.html?d=" + d.id + "&c=" + sp.class_id : new URL(d.url, location.href).href)}" ${d.stored ? "" : 'target="_blank" rel="noopener"'}>
          <span class="k ${esc(d.kind)}">${DOC_KIND[d.kind] || "Document"}</span><span>${esc(d.title)}</span></a>`).join("")) + `</div>`);
    } catch (e) { /* token of a deleted class: ignore */ }
  }
  $("spaceList").innerHTML = blocks.join("") || `<p class="muted">No document yet.</p>`;
  box.classList.remove("hidden");
}

async function start() {
  if (params.has("space")) $("spaceBox").open = true;
  renderSpace();
  // old registration links (?reg=...) and a page opened without a session: everything starts from the home page
  if (params.has("checkin")) { startCheckinHome(); return; }
  if (params.get("reg") || (!sessionCode && !params.has("space"))) { location.replace("index.html"); return; }
  if (!sessionCode) return;
  try {
    sessionInfo = await rpc("s_session_info", { p_code: sessionCode });
  } catch (e) {
    toast(e.message, "error");
    setTimeout(() => location.replace("index.html"), 2500);
    return;
  }
  // remembered for the protected demos: they open only for a phone checked in this session
  try { localStorage.setItem("cp_last_session", sessionCode); } catch (e) { /* private mode */ }
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw-demos.js", { scope: "./d/" }).catch(() => {});
  $("brand").textContent = sessionInfo.class_name;
  $("sessionLine").textContent = sessionInfo.title;
  try { deviceToken = localStorage.getItem(tokenKey()) || localStorage.getItem("cp_reader_" + sessionInfo.class_id); } catch (e) { deviceToken = null; }
  // v22: there is one place to sign in or register, the home page. It sends the phone back here afterwards.
  if (!deviceToken) { goSignIn(); return; }
  if (params.get("checked")) { showCheckinResult(params.get("checked")); params.delete("checked"); dropAttendanceCodeFromUrl(); }
  await deviceGate();
}

// ------------------------------------------------------------------ class device (v24)
// The first device used in a session becomes the class device. Another device must be allowed by the teacher:
// for this session only, or as the new class device.
let gateTimer = null;
async function deviceGate() {
  let claim;
  try { claim = await rpc("s_claim_device", { p_token: deviceToken, p_kind: deviceKind() }); }
  catch (e) {
    if (e.code === "UNKNOWN_DEVICE") { forgetDevice(); return; }
    toast(e.message, "error"); return;
  }
  if (claim.linked) { promoteToken(sessionInfo.class_id); await afterIdentified(); return; }
  // not the class device: maybe already allowed for this session
  try { await rpc("s_state", { p_device: deviceToken, p_code: sessionCode }); await afterIdentified(); return; }
  catch (e) { if (e.code !== "UNKNOWN_DEVICE") { toast(e.message, "error"); return; } }
  renderDeviceGate(claim.device_kind || "device", "none");
}
function renderDeviceGate(otherKind, status) {
  show("viewLive");
  $("presence").innerHTML = '<span class="badge no">Not your class device</span>';
  const live = $("viewLive");
  if (status === "pending") {
    live.innerHTML = bigStatus("⏳", "Waiting for the teacher", "Your request is on his screen. Keep this page open.") +
      `<button id="gateCancel" class="secondary" style="width:100%">Cancel and go back to the home page</button>`;
    $("gateCancel").onclick = () => { location.href = "index.html"; };
    return;
  }
  live.innerHTML = bigStatus("📵", "This device is not your class device",
      `Attendance and quizzes are done with your class device (your ${esc(otherKind)}).` + (status === "refused" ? "<br><strong>Your last request was refused.</strong>" : "")) +
    `<div class="card"><p><strong>You do not have your class device today?</strong></p>
       <button id="gateSession" class="orange" style="width:100%">Ask to use this device for this session only</button>
       <p style="margin-top:14px"><strong>You changed your device?</strong></p>
       <button id="gateReplace" class="secondary" style="width:100%">Ask to make this device my class device</button>
       <p class="muted" style="margin-top:12px">The teacher (or the assistant) accepts on his screen. Your documents stay available on every device.</p></div>`;
  const ask = async (kind) => {
    try {
      await rpc("s_device_request", { p_token: deviceToken, p_code: sessionCode, p_kind: kind, p_device_kind: deviceKind() });
      renderDeviceGate(otherKind, "pending");
      clearInterval(gateTimer);
      gateTimer = setInterval(async () => {
        let st;
        try { st = await rpc("s_device_state", { p_token: deviceToken, p_code: sessionCode }); } catch (e) { return; }
        if (st.status === "pending") return;
        clearInterval(gateTimer);
        if (st.status === "accepted") {
          if (st.linked) promoteToken(sessionInfo.class_id);
          toast("The teacher allowed this device.", "ok");
          await afterIdentified();
        } else renderDeviceGate(otherKind, "refused");
      }, 3000);
    } catch (e) { toast(e.message, "error"); }
  };
  $("gateSession").onclick = () => ask("session");
  $("gateReplace").onclick = () => ask("replace");
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

function goSignIn() {
  const q = "s=" + sessionCode + (attendanceCode ? "&a=" + attendanceCode : "");
  location.replace("index.html?next=" + encodeURIComponent(q));
}

function forgetDevice() {
  try { localStorage.removeItem(tokenKey()); localStorage.removeItem("cp_reader_" + sessionInfo.class_id); } catch (e) { /* ignore */ }
  deviceToken = null;
  toast("This phone is not linked to your account anymore. Sign in again.", "error");
  setTimeout(goSignIn, 1500);
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
    OTHER_GROUP: ["This session is for another group. The teacher has been told: wait, he can let you in.", "error"],
  };
  const m = messages[result] || [result, ""];
  toast(m[0], m[1]);
}

function pollLoop() {
  // Always poll every few seconds: the live channel (instant update) is not reliable on every network,
  // and a phone that misses "show the rules" would only see the quiz once the timer is already running.
  const delay = Math.min(CONFIG.studentPollMs || 4000, 3000);
  setTimeout(async () => { await fetchState(); pollLoop(); }, delay);
}

// ------------------------------------------------------------------ check-in from the home page (no session known yet)
// The phone scans the QR code of the screen, or types the attendance code: the session is found from the code.
function startCheckinHome() {
  if (!accountTokens().length) { location.replace("index.html"); return; }
  $("brand").textContent = "Check in";
  show("viewLive");
  renderCheckinHome();
}
function checkinBoxHtml(label) {
  return `<div class="checkin-choice"><button id="scanBtn" class="orange">📷 Scan the QR code</button>
        <button id="typeBtn" class="secondary">⌨ Type the code</button></div>
      <div id="scanBox" class="card scanner hidden"><video id="scanVideo" playsinline muted></video>
        <p class="muted" id="scanMsg">Point the camera at the QR code of the screen.</p><button id="scanStop" class="secondary" style="width:100%">Cancel</button></div>
      <div id="typeBox" class="card hidden"><label for="attInput">${label}</label>
        <input id="attInput" maxlength="6" autocomplete="off" style="text-transform:uppercase;font-size:22px;letter-spacing:4px">
        <button id="attBtn" style="margin-top:10px;width:100%">Check in</button></div>`;
}
function wireCheckinBox(onCancel) {
  $("scanBtn").onclick = startScan;
  $("scanStop").onclick = () => { stopScan(); onCancel(); };
  $("typeBtn").onclick = () => { $("typeBox").classList.remove("hidden"); $("attInput").focus(); };
  $("attBtn").onclick = () => checkinWith($("attInput").value);
}
function renderCheckinHome() {
  $("viewLive").innerHTML = bigStatus("📷", "Check in", "Scan the QR code shown by the teacher, or type the attendance code written under it.") +
    checkinBoxHtml("Attendance code given by the teacher");
  wireCheckinBox(renderCheckinHome);
}
// Finds the session from what was scanned or typed, then opens it (the check-in is done there).
async function checkinFromHome(text) {
  const raw = String(text || "").trim();
  const s = raw.match(/[?&]s=([A-Za-z0-9]+)/), a = raw.match(/[?&]a=([A-Za-z0-9]+)/);
  if (s) { location.href = "student.html?s=" + s[1].toUpperCase() + (a ? "&a=" + a[1].toUpperCase() : ""); return true; }
  const code = (a ? a[1] : raw).toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) { toast("This is not a ClassPulse attendance code.", "error"); return false; }
  for (const t of accountTokens()) {
    try {
      const found = await rpc("s_find_session", { p_device: t.token, p_att_code: code });
      if (found) { location.href = "student.html?s=" + found.code + "&a=" + code; return true; }
    } catch (e) { /* next course */ }
  }
  toast("No open attendance of your courses has this code. Check the code on the screen.", "error");
  return false;
}

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
  if (scanning) return;   // do not destroy the camera view
  const typingCode = document.activeElement && document.activeElement.id === "attInput";
  if (typingCode && state && !state.present && state.attendance_open) return;
  const typing = document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("numAnswer");
  if (typing && state && state.quiz && state.quiz.pace === "self" && state.quiz.phase === "self") return;
  if (document.activeElement && document.activeElement.id === "liveNum" && state && state.quiz && state.quiz.phase === "question"
      && liveNumKey === state.quiz.quiz_id + ":" + state.quiz.index) { tick(); return; }
  const snapshot = JSON.stringify([state, selection, armedQuiz]).replace(/"remaining_ms":\d+/, "");
  if (snapshot === lastRendered) return;
  lastRendered = snapshot;

  $("homeLink").classList.toggle("hidden", state.activity === "quiz" && !!state.quiz);
  $("presence").innerHTML = state.present ? '<span class="badge ok">Present</span>' : '<span class="badge no">Not checked in</span>';
  const who = `<p class="muted">${esc(state.student.first_name)} ${esc(state.student.last_name)} · ${esc(state.student.matricule)}</p>`;
  const live = $("viewLive");

  if (state.ended) {
    live.innerHTML = who + bigStatus("⏹", "The session is over", "Thank you. Attendance and quizzes are closed.");
    return;
  }

  if (!state.present && state.attendance_open) {
    live.innerHTML = who + bigStatus("📷", "Check in", (state.att_window_s || 15) >= 3600 ? "Type the attendance code given by the teacher." : `The code on the screen changes every ${state.att_window_s || 15} seconds.`) +
      checkinBoxHtml("Code shown under the QR code");
    wireCheckinBox(() => { lastRendered = ""; render(); });
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

// ------------------------------------------------------------------ check-in: in-page QR scanner or typed code
let scanning = false, scanStream = null;

async function checkinWith(text) {
  // Accepts the scanned address (".../student.html?s=ABC123&a=XYZ789") or the code alone.
  if (!sessionCode) return checkinFromHome(text);
  let code = String(text || "").trim();
  const m = code.match(/[?&]a=([A-Za-z0-9]+)/);
  if (m) code = m[1];
  code = code.toUpperCase();
  if (!/^[A-Z0-9]{4,8}$/.test(code)) { toast("This is not a ClassPulse attendance code.", "error"); return false; }
  try {
    const r = await rpc("s_checkin", { p_device: deviceToken, p_code: sessionCode, p_att_code: code });
    showCheckinResult(r);
    if (document.activeElement) document.activeElement.blur();
    lastRendered = "";
    await fetchState();
    return r === "PRESENT" || r === "ALREADY_PRESENT";
  } catch (e) { toast(e.message, "error"); return false; }
}

// jsQR (Apache-2.0) is only downloaded when the phone has no built-in QR decoder.
function loadJsQR() {
  if (window.jsQR) return Promise.resolve();
  return new Promise((ok, ko) => { const sc = document.createElement("script"); sc.src = "lib/jsQR.js"; sc.onload = ok; sc.onerror = ko; document.head.appendChild(sc); });
}

async function startScan() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    toast("No camera access in this browser: use 'Type the code'.", "error"); return;
  }
  try {
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
  } catch (e) { toast("Camera refused: use 'Type the code', or allow the camera for this site.", "error"); return; }
  scanning = true;
  $("scanBox").classList.remove("hidden");
  $("scanBtn").classList.add("hidden");
  const video = $("scanVideo");
  video.srcObject = scanStream;
  await video.play().catch(() => {});
  let detector = null;
  if ("BarcodeDetector" in window) { try { detector = new BarcodeDetector({ formats: ["qr_code"] }); } catch (e) { detector = null; } }
  if (!detector) { try { await loadJsQR(); } catch (e) { stopScan(); toast("Scanner not available: use 'Type the code'.", "error"); return; } }
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
  const loop = async () => {
    if (!scanning) return;
    let text = null;
    try {
      if (video.readyState >= 2) {
        if (detector) {
          const found = await detector.detect(video);
          if (found.length) text = found[0].rawValue;
        } else {
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const found = window.jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
          if (found) text = found.data;
        }
      }
    } catch (e) { /* next frame */ }
    if (text) {
      stopScan();
      const ok = await checkinWith(text);
      if (!ok) { if (sessionCode) { lastRendered = ""; render(); } else renderCheckinHome(); }
      return;
    }
    setTimeout(loop, 200);
  };
  loop();
}

function stopScan() {
  scanning = false;
  if (scanStream) { scanStream.getTracks().forEach((t) => t.stop()); scanStream = null; }
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
// "3 (±2 %)" + "V" -> "3 V (±2 %)"
function withUnit(expected, unit) {
  if (!unit) return expected;
  return expected.includes(" (±") ? expected.replace(" (±", " " + unit + " (±") : expected + " " + unit;
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
        <div class="question-text">${esc(r.question)}</div>` + (r.qtype === "number"
          ? `<div class="option ${Number(r.score) > 0 ? "correct" : "wrong"}">Your answer: <strong>${r.my_number == null ? "-" : Number(r.my_number)} ${esc(r.unit || "")}</strong></div>
             <div class="muted">Accepted: ${esc(withUnit(r.expected || "", r.unit || ""))}</div>`
          : "") + (r.options || []).map((o, pos) => {
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
  if (q.pace === "self" && (!q.lock_screen || armedQuiz === q.quiz_id)) { renderSelfPaced(live, who, head, q); return; }
  if (q.pace === "self") {
    // self-paced test with the screen lock: the rules first, then the questions
    live.innerHTML = who + head + `<div class="card">
      <div style="font-size:42px;text-align:center">📝</div><h2 style="text-align:center">Read the rules</h2>
      <ol class="rules">${rulesFor(q)}
        <li>You answer in any order, at your own pace, until the teacher closes the test.</li>
        <li><strong>Do not leave this screen</strong> (no other app, no other tab, no notification opened). If you leave, you are locked and only the teacher can unlock you.</li>
        <li>Your name and student number are printed on the questions: any photo or screenshot shows who took it.</li>
      </ol>
      <button id="enterBtn" class="orange" style="width:100%;font-size:19px">I have read the rules, I am ready</button></div>`;
    $("enterBtn").onclick = enterQuiz;
    return;
  }
  if (armedQuiz !== q.quiz_id) {
    // Rules first. In the "lobby" phase no timer runs: the teacher starts question 1 when students are ready.
    live.innerHTML = who + head + `<div class="card">
      <div style="font-size:42px;text-align:center">📝</div><h2 style="text-align:center">Read the rules</h2>
      ${q.phase === "question" || q.phase === "reveal" ? `<p class="far" style="text-align:center">The quiz has already started: tap the button below now to join the current question.</p>` : ""}
      <ol class="rules">${rulesFor(q)}
        <li>You can change your answer until the time of the question is over.</li>
        ${q.lock_screen ? `<li><strong>Do not leave this screen</strong> (no other app, no other tab, no notification opened). If you leave, you are locked and only the teacher can unlock you.</li>` : `<li>You may leave this screen during this quiz: nothing is locked.</li>`}
        <li>Your name and student number are printed on the questions: any photo or screenshot shows who took it.</li>
      </ol>
      <button id="enterBtn" class="orange" style="width:100%;font-size:19px">I have read the rules, I am ready</button></div>`;
    $("enterBtn").onclick = enterQuiz;
    return;
  }
  if (q.phase === "lobby") {
    live.innerHTML = who + head + bigStatus("✅", "You are ready", "The first question will appear when the teacher starts the quiz." + (q.lock_screen ? " Stay on this screen." : ""));
    return;
  }

  const key = q.quiz_id + ":" + q.index;
  if (selectionKey !== key) { selectionKey = key; selection = q.my_answer ? q.my_answer.slice() : []; }
  const reveal = q.phase === "reveal";
  if (q.qtype === "number") { renderLiveNumber(live, who, head, q, key, reveal); return; }
  const answered = q.my_answer && q.my_answer.length > 0;
  let html = who + head;
  if (!reveal) html += `<div class="row" style="justify-content:space-between"><span class="timer" id="timer"></span>` +
    `<span class="answer-kind ${q.multiple === false ? "single" : "multi"}">${q.survey ? "Survey: your opinion, not graded" : q.multiple === false ? "Only one correct answer" : q.multiple ? "Several correct answers: tick all" : "One or more answers may be correct"}</span></div><div class="progress"><div id="bar"></div></div>`;
  html += `<div class="protected"><div class="question-text">${esc(q.question)}</div>`;
  (q.options || []).forEach((opt, pos) => {
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

// A question of a live quiz whose answer is a number: one field, the same timer, the answer can be changed until the time is over.
function renderLiveNumber(live, who, head, q, key, reveal) {
  const saved = q.my_number == null ? "" : String(Number(q.my_number));
  if (liveNumKey !== key) { liveNumKey = key; liveNumDraft = saved; }
  const answered = q.my_number != null;
  let html = who + head;
  if (!reveal) html += `<div class="row" style="justify-content:space-between"><span class="timer" id="timer"></span><span class="answer-kind single">Type a number</span></div>
    <div class="progress"><div id="bar"></div></div>`;
  html += `<div class="protected"><div class="question-text">${esc(q.question)}</div>`;
  if (reveal) {
    html += `<div class="option ${q.reveal_mode === "each" ? (Number(q.my_score) > 0 ? "correct" : "wrong") : "selected"}">Your answer: <strong>${answered ? saved : "-"} ${esc(q.unit || "")}</strong></div>` +
      (q.expected ? `<div class="muted">Accepted: ${esc(withUnit(q.expected, q.unit || ""))}</div>` : "");
  } else {
    html += `<div class="row" style="gap:8px;align-items:center"><input id="liveNum" inputmode="decimal" autocomplete="off" value="${esc(liveNumDraft)}" style="font-size:22px;max-width:200px">
      <span style="font-size:18px">${esc(q.unit || "")}</span></div><p class="muted">Use a dot or a comma (2.5 or 2,5).</p>`;
  }
  html += watermark() + `</div>`;
  if (reveal && q.reveal_mode === "each") {
    html += `<div class="card" style="text-align:center"><strong>${answered ? "Your score: " + Number(q.my_score) : "No answer"}</strong></div>`;
  } else if (reveal) {
    html += `<div class="card" style="text-align:center"><strong>${answered ? "✔ Answer recorded" : "No answer"}</strong><br>
      <span class="muted">${q.reveal_mode === "end" ? "The correct answers will be shown at the end of the quiz." : "The correct answers are not shown for this quiz."}</span></div>`;
  } else {
    html += `<button id="sendBtn" class="orange" style="width:100%;font-size:19px;margin-top:6px">${answered ? "Change my answer" : "Send my answer"}</button>`;
    if (answered) html += `<p class="muted" style="text-align:center">✔ Answer received: ${esc(saved)} ${esc(q.unit || "")}. You can change it until the time is over.</p>`;
  }
  live.innerHTML = html;
  if (!reveal) {
    $("liveNum").oninput = () => { liveNumDraft = $("liveNum").value; };
    $("sendBtn").onclick = sendNumber;
    tick();
  }
}
async function sendNumber() {
  if (sending) return;
  const v = parseFloat(String(liveNumDraft).trim().replace(",", "."));
  if (String(liveNumDraft).trim() === "" || isNaN(v)) { toast("Type a number (for example 2.5).", "error"); return; }
  sending = true;
  try {
    await rpc("s_answer_number", { p_device: deviceToken, p_code: sessionCode, p_quiz: state.quiz.quiz_id, p_index: state.quiz.index, p_number: v });
    if (document.activeElement) document.activeElement.blur();
    lastRendered = "";
    await fetchState();
  } catch (e) { toast(e.message, "error"); lastRendered = ""; await fetchState(); }
  finally { sending = false; }
}

// ------------------------------------------------------------------ self-paced quiz (lab test)
// Every question at once; each answer is saved on its own and can be changed until the teacher closes the test.
// By default no full screen and no lock (during a lab, students go back and forth between the phone and their tools);
// the teacher can turn the lock on for a test (v23).
const drafts = {};            // quiz id + index -> unsaved value typed or ticked by the student
function renderSelfPaced(live, who, head, q) {
  const key = (i) => q.quiz_id + ":" + i;
  const intro = `<div class="card"><strong>${q.kind === "tp" ? "Lab test" : "Test"} · at your own pace</strong>
    <div class="muted">Answer in any order. Each answer is saved when you tap <em>Save</em> and can be changed until the teacher closes the test.
    ${q.graded ? "Marked out of " + Number(q.total_points) + "." : "Not graded."} Numbers: use a dot or a comma (2.5 or 2,5).</div></div>`;
  if (q.ask_variant && q.variant == null) {
    live.innerHTML = who + head + intro + `<div class="card"><strong>Number of your board</strong>
      <p class="muted">It is written on your ESP32 / your kit. It sets the values expected for your group.</p>
      <input id="variantInput" type="number" min="1" max="99" inputmode="numeric" style="font-size:22px">
      <button id="variantBtn" class="orange" style="width:100%;margin-top:10px">Confirm</button></div>`;
    $("variantBtn").onclick = async () => {
      const v = Number($("variantInput").value);
      try { await rpc("s_set_variant", { p_device: deviceToken, p_code: sessionCode, p_quiz: q.quiz_id, p_variant: v }); await fetchState(); }
      catch (e) { toast(e.message, "error"); }
    };
    return;
  }
  const items = q.items || [];
  const done = items.filter((it) => it.answered).length;
  let html = who + head + intro + (q.ask_variant ? `<p class="muted">Board number: <strong>${q.variant}</strong></p>` : "") +
    `<p><strong>${done} / ${items.length}</strong> answers saved</p><div class="protected">`;
  items.forEach((it) => {
    const k = key(it.index);
    html += `<div class="card" id="item${it.index}"><div class="muted">Question ${it.index + 1}${it.answered ? " · <span style='color:#2E7D4F;font-weight:700'>✔ saved</span>" : ""}</div>
      <div class="question-text">${esc(it.text)}</div>`;
    if (it.qtype === "number") {
      const val = drafts[k] !== undefined ? drafts[k] : (it.my_number == null ? "" : String(Number(it.my_number)));
      html += `<div class="row" style="gap:8px;align-items:center"><input class="numAnswer" data-index="${it.index}" inputmode="decimal" value="${esc(val)}" style="font-size:20px;max-width:180px">
        <span style="font-size:18px">${esc(it.unit || "")}</span></div>`;
    } else {
      const sel = drafts[k] !== undefined ? drafts[k] : (it.my_answer || []);
      if (!it.survey) html += `<div class="answer-kind ${it.multiple === false ? "single" : "multi"}" style="display:inline-block;margin-bottom:6px">${it.multiple === false ? "Only one correct answer" : "One or more answers may be correct"}</div>`;
      html += (it.options || []).map((o, pos) => `<div class="option ${sel.includes(pos) ? "selected" : ""}" data-index="${it.index}" data-pos="${pos}"><strong>${LETTERS[pos]}.</strong> ${esc(o)}</div>`).join("");
    }
    html += `<button class="saveBtn orange" data-index="${it.index}" style="width:100%;margin-top:8px">${it.answered ? "Save my new answer" : "Save"}</button></div>`;
  });
  live.innerHTML = html + watermark() + `</div>`;
  live.querySelectorAll(".numAnswer").forEach((inp) => inp.oninput = () => { drafts[key(inp.dataset.index)] = inp.value; });
  live.querySelectorAll(".option[data-pos]").forEach((b) => b.onclick = () => {
    const it = items[Number(b.dataset.index)], k = key(it.index), pos = Number(b.dataset.pos);
    const cur = drafts[k] !== undefined ? drafts[k] : (it.my_answer || []).slice();
    drafts[k] = it.multiple === false ? [pos] : (cur.includes(pos) ? cur.filter((p) => p !== pos) : cur.concat(pos));
    b.parentElement.querySelectorAll(".option").forEach((o) => o.classList.toggle("selected", drafts[k].includes(Number(o.dataset.pos))));
  });
  live.querySelectorAll(".saveBtn").forEach((b) => b.onclick = async () => {
    const it = items[Number(b.dataset.index)], k = key(it.index);
    const args = { p_device: deviceToken, p_code: sessionCode, p_quiz: q.quiz_id, p_index: it.index, p_positions: null, p_number: null };
    if (it.qtype === "number") {
      const raw = drafts[k] !== undefined ? drafts[k] : (it.my_number == null ? "" : String(it.my_number));
      const v = parseFloat(String(raw).trim().replace(",", "."));
      if (raw === "" || isNaN(v)) { toast("Type a number (for example 2.5).", "error"); return; }
      args.p_number = v;
    } else {
      args.p_positions = drafts[k] !== undefined ? drafts[k] : (it.my_answer || []);
      if (!args.p_positions.length) { toast("Choose an answer first.", "error"); return; }
    }
    b.disabled = true;
    try {
      await rpc("s_answer_self", args);
      delete drafts[k];
      toast(`Answer ${it.index + 1} saved.`, "ok");
      lastRendered = "";
      await fetchState();
    } catch (e) { toast(e.message, "error"); b.disabled = false; }
  });
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
  if (state.quiz.lock_screen && el.requestFullscreen) { try { await el.requestFullscreen({ navigationUI: "hide" }); } catch (e) { /* refused: ignore */ } }
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
    selectionKey = ""; selection = [];   // a reset quiz keeps its id: start again with nothing ticked
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
    if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
  }
}

function guardActive() {
  return armedQuiz && state && state.quiz && state.quiz.quiz_id === armedQuiz && state.quiz.lock_screen &&
    (state.quiz.phase === "question" || state.quiz.phase === "reveal" || state.quiz.phase === "self") && !state.quiz.locked;
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
// Computer keyboards: the PrintScreen key counts as leaving the quiz (a phone screenshot cannot be detected by a web page).
function onPrintScreen(e) { if (e.key === "PrintScreen" && guardActive()) reportLeave("printscreen"); }
document.addEventListener("keyup", onPrintScreen);
document.addEventListener("keydown", onPrintScreen);
document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && guardActive()) reportLeave("exit_fullscreen");
});

start();
