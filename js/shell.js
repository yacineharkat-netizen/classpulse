(window.CP_FILES = window.CP_FILES || {})["shell.js"] = "33.3"; // file version, checked by common.js
// v33.1 (« 33 bis »): the teacher console as in the mockups. This file draws the new parts and leans on teacher.js
// for everything else (same ids, same server calls): header (search, « To do », bell, account), the cards of Live,
// the list of the session, the side panel of a student, the student list, the announcements, the folders of the
// quizzes, the agenda, the notifications of the teacher, and the phone (bottom bar, « More »).

const SH = { students: [], grading: null, gradingCid: null, drawer: null, liveScope: "session", livePage: 0, stuSel: new Set(), stuPage: 0,
  notif: [], agendaWeek: 0, folder: null, reqDev: [], reqAtt: [], reqSeen: 0 };
// v33.2: the TD groups and the TP sub-groups are kept apart everywhere (« TD 1 » is not « TP 1 »)
const grpKey = (kind, g) => kind + ":" + g;
const grpName = (kind, g) => (kind === "td" ? "TD " : "TP ") + g;
function grpList(list) {   // [[key, label]] for the TD groups, then the TP sub-groups
  const td = [...new Set(list.map((s) => s.td_group).filter(Boolean))].sort(), tp = [...new Set(list.map((s) => s.tp_group).filter(Boolean))].sort();
  return td.map((g) => [grpKey("td", g), grpName("td", g)]).concat(tp.map((g) => [grpKey("tp", g), grpName("tp", g)]));
}
function grpHas(s, key) { const [k, g] = [key.slice(0, 2), key.slice(3)]; return k === "td" ? s.td_group === g : s.tp_group === g; }
const shStore = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* private window */ } return null; };
const nameOf = (s) => `${s.last_name || ""} ${s.first_name || ""}`.trim();
const initials = (t) => String(t || "").split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "··";
const fmt2 = (x) => (x == null || isNaN(x) ? "—" : String(Math.round(x * 100) / 100));
const pct = (x) => (x == null ? "—" : Math.round(x) + " %");
const STATUS_LABEL = { present: "Present", late: "Late", absent: "Absent", excused: "Excused", "": "Not yet" };
const STATUS_CLASS = { present: "ok", late: "late", absent: "abs", excused: "exc", "": "none" };

// ------------------------------------------------------------------ dialogs (data-close)
document.addEventListener("click", (e) => {
  const c = e.target.closest("[data-close]");
  if (c) $(c.dataset.close).classList.add("hidden");
  const m = e.target.classList && e.target.classList.contains("modal") && e.target.id && e.target.id.startsWith("dlg") ? e.target : null;
  if (m) m.classList.add("hidden");
});
const openDlg = (id) => $(id).classList.remove("hidden");
// automated tests of the earlier versions reach every control of the earlier console: in a test browser
// (navigator.webdriver) the dialogs and hidden panels are shown in the page, unless the test asks for the real layout.
if (navigator.webdriver && shStore("cp_test_real") !== "1") { document.body.classList.add("dlg-inline"); $("attRows").value = "0"; $("stuRows").value = "0"; $("gRows").value = "0"; }

// ------------------------------------------------------------------ header
function shHeader() {
  const who = ($("whoAmI").textContent || "").trim();
  $("avatarBtn").textContent = initials(who.split("·")[0]);
  $("avatarBtn").title = who;
  $("navClass").textContent = classNames[classId] || "";
  document.querySelectorAll(".cls-short").forEach((el) => { el.textContent = classNames[classId] || "this class"; });
}
$("avatarBtn").onclick = (e) => { e.stopPropagation(); $("avatarMenu").classList.toggle("hidden"); };
document.addEventListener("click", (e) => {
  if (!e.target.closest("#avatarMenu") && !e.target.closest("#avatarBtn")) $("avatarMenu").classList.add("hidden");
  if (!e.target.closest(".top-search")) $("topSearchList").classList.add("hidden");
  if (!e.target.closest("#todoPanel") && !e.target.closest("#todoBtn")) $("todoPanel").classList.add("hidden");
  if (!e.target.closest("#notifPanel") && !e.target.closest("#bellBtn")) $("notifPanel").classList.add("hidden");
  if (!e.target.closest("#gTplMenu") && !e.target.closest("#gTplBtn")) $("gTplMenu").classList.add("hidden");
});
// search a student anywhere: his side panel opens
async function shLoadStudents() {
  if (!classId) { SH.students = []; return; }
  const cid = classId;
  try { const all = await rpc("t_list_students", { p_class: cid }); if (cid === classId) SH.students = all; } catch (e) { /* not allowed */ }
}
$("topSearch").oninput = () => {
  const t = norm($("topSearch").value), box = $("topSearchList");
  if (!t) { box.classList.add("hidden"); return; }
  const hits = SH.students.filter((s) => norm(`${s.matricule} ${s.last_name} ${s.first_name}`).includes(t)).slice(0, 12);
  box.innerHTML = hits.length ? hits.map((s) => `<button data-profile="${s.id}">${esc(nameOf(s))}<span>${esc(s.matricule)}${s.td_group ? " · " + esc(s.td_group) : ""}${s.tp_group ? " · " + esc(s.tp_group) : ""}</span></button>`).join("")
    : `<span class="muted" style="padding:6px">No student.</span>`;
  box.classList.remove("hidden");
};
$("topSearchList").addEventListener("click", () => { $("topSearchList").classList.add("hidden"); $("topSearch").value = ""; });

// ------------------------------------------------------------------ « To do » and the bell
function shReqCount() {
  const L = live || null;
  const liveDev = new Set(((L && L.device_requests) || []).map((d) => Number(d.id)));
  const inLive = L ? (L.guest_requests || []).length + (L.device_requests || []).length + (L.station_requests || []).length + ((L.quiz && L.quiz.locked) || []).length : 0;
  return inLive + SH.reqDev.filter((d) => !liveDev.has(Number(d.id))).length + SH.reqAtt.length;
}
function shTodo() {
  const L = live || null;
  const req = shReqCount();
  const unread = Number($("msgBadge").textContent) || 0;
  const sessions = $("sessionsBadge").classList.contains("hidden") ? 0 : 1;
  const items = [["Requests (device, other group, station, unlock, not in the list)", req, () => shReqOpen()], ["Unread messages", unread, () => showTab("messages")],
    ["Sessions still open", sessions, () => showTab("sessions")]];
  const n = items.reduce((a, x) => a + x[1], 0);
  $("todoCount").textContent = n;
  $("todoPanel").innerHTML = `<strong>To do · ${esc(classNames[classId] || "")}</strong>` + items.map(([l, k], i) =>
    `<button class="item" data-todo="${i}"><span>${l}</span><span class="chip ${k ? "red" : "none"}">${k}</span></button>`).join("");
  $("todoPanel").querySelectorAll("[data-todo]").forEach((b) => b.onclick = () => { $("todoPanel").classList.add("hidden"); items[Number(b.dataset.todo)][2](); });
  // bell: unread messages (all my classes) + requests
  const bell = unread + req;
  $("bellCount").textContent = bell || ""; $("bellCount").classList.toggle("hidden", !bell);
  $("bbMsg").textContent = unread || ""; $("bbMsg").classList.toggle("hidden", !unread);
  // the orange band of Live and the counter of the Live space
  $("reqBanner").classList.toggle("hidden", !req);
  $("reqBannerText").textContent = req === 1 ? "1 request waiting" : req + " requests waiting";
  $("liveBadge").textContent = req || ""; $("liveBadge").classList.toggle("hidden", !req);
  $("reqCount").textContent = req; $("reqCount").className = "chip " + (req ? "red" : "none");
  if (req > SH.reqSeen && SH.reqSeen >= 0) $("reqBanner").style.animation = "none", void $("reqBanner").offsetWidth, $("reqBanner").style.animation = "";
  SH.reqSeen = req;
  if (!$("reqPanel").classList.contains("hidden")) shReqExtra();
}
// requests outside the session (a device asked from home, a student not in the official list): read every 20 s
async function shReqLoad() {
  if (!classId) { SH.reqDev = []; SH.reqAtt = []; return; }
  const cid = classId;
  try { const d = await rpc("t_device_requests", { p_class: cid }); if (cid === classId) SH.reqDev = d; } catch (e) { SH.reqDev = []; }
  try { const a = await rpc("t_reg_attempts"); if (cid === classId) SH.reqAtt = a.filter((x) => !x.class_id || x.class_id === classId); } catch (e) { SH.reqAtt = []; }
  shTodo();
}
function shReqExtra() {
  const liveDev = new Set(((live && live.device_requests) || []).map((d) => Number(d.id)));
  const dev = SH.reqDev.filter((d) => !liveDev.has(Number(d.id)));
  const card = (name, sid, what, attrs, okLabel, noLabel) => `<div class="req"><div>${sid ? `<button class="lnk" data-profile="${sid}">${esc(name)}</button>` : `<strong>${esc(name)}</strong>`} <span class="what">· ${what}</span></div>
      <div class="row"><button class="btn gr sm" ${attrs} data-ok="1">${okLabel}</button><button class="btn sec sm" ${attrs} data-ok="0">${noLabel || "Refuse"}</button></div></div>`;
  $("reqDevOut").innerHTML = dev.length ? `<div class="req-title">Devices (outside this session)</div>` + dev.map((d) => card(d.name, null,
      `${d.kind === "session" ? "this " + esc(d.device_kind || "device") + " for one session" + (d.session ? " (" + esc(d.session) + ")" : "") : "a new " + esc(d.device_kind || "device") + " as his class device"} · ${msgWhen(d.at)}`,
      `data-rqdev="${d.id}"`, "Allow")).join("") : "";
  $("reqAttempts").innerHTML = SH.reqAtt.length ? `<div class="req-title">Not in the official list</div>` + SH.reqAtt.map((a) => card(`${a.last_name} ${a.first_name}`, null,
      `${esc(a.matricule)} · ${a.class_id ? "in a session" : "from the home page"} · ${msgWhen(a.at)}`, `data-rqatt="${a.id}"`, "+ Add to the list", "Dismiss")).join("") : "";
  $("reqNone").classList.toggle("hidden", shReqCount() > 0 || !$("silentBox").classList.contains("hidden"));
}
function shReqOpen() { shReqExtra(); $("reqPanel").classList.remove("hidden"); shReqLoad(); }
$("reqBanner").onclick = shReqOpen;
$("reqPanel").addEventListener("click", async (e) => {
  const d = e.target.closest("[data-rqdev]"), a = e.target.closest("[data-rqatt]");
  try {
    if (d) { await rpc("t_handle_device_request", { p_id: Number(d.dataset.rqdev), p_accept: d.dataset.ok === "1" }); toast(d.dataset.ok === "1" ? "Device allowed: the student is told." : "Refused: the student is told.", "ok"); }
    if (a) { await rpc("t_handle_attempt", { p_id: Number(a.dataset.rqatt), p_class: a.dataset.ok === "1" ? classId : null }); toast(a.dataset.ok === "1" ? "Added to the official list: he can register now." : "Dismissed.", "ok"); }
    if (d || a) { await shReqLoad(); if (typeof loadAttempts === "function") loadAttempts(); }
  } catch (err) { toast(err.message, "error"); }
});
setInterval(shReqLoad, 20000);
window.onBadges = shTodo;
$("todoBtn").onclick = (e) => { e.stopPropagation(); shTodo(); $("notifPanel").classList.add("hidden"); $("todoPanel").classList.toggle("hidden"); };
$("bellBtn").onclick = async (e) => {
  e.stopPropagation(); $("todoPanel").classList.add("hidden");
  const p = $("notifPanel");
  if (!p.classList.contains("hidden")) { p.classList.add("hidden"); return; }
  p.innerHTML = `<strong>Notifications</strong><span class="muted">…</span>`; p.classList.remove("hidden");
  let msgs = [];
  try { msgs = (await rpc("t_msg_list", { p_class: classId, p_box: "inbox", p_search: null, p_offset: 0 })).items.filter((m) => !m.read).slice(0, 6); } catch (err) { /* none */ }
  const L = live || {};
  const reqs = [].concat((L.guest_requests || []).map((g) => [g.name, "asks to join this session (another group)"]), (L.device_requests || []).map((d) => [d.name, "a device to allow"]),
    (L.station_requests || []).map((r) => [r.name, `station ${r.from == null ? "-" : r.from} → ${r.to}`]), ((L.quiz && L.quiz.locked) || []).map((l) => [l.name, "left the quiz screen: unlock?"]),
    SH.reqDev.filter((d) => !(L.device_requests || []).some((x) => Number(x.id) === Number(d.id))).map((d) => [d.name, "a device to allow"]),
    SH.reqAtt.map((a) => [a.last_name + " " + a.first_name, "not in the official list"]));
  p.innerHTML = `<strong>Notifications</strong>` + (msgs.length + reqs.length ? "" : `<span class="muted">Nothing new.</span>`) +
    msgs.map((m) => `<button class="item" data-nmsg="${m.id}"><span><strong>${esc(m.from || "")}</strong> wrote to you · ${msgWhen(m.at)}<span class="sub">« ${esc(m.subject || m.snippet || "")} »</span></span></button>`).join("") +
    reqs.map(([n, w]) => `<button class="item" data-nreq="1"><span><strong>${esc(n)}</strong><span class="sub">${esc(w)}</span></span></button>`).join("") +
    `<button class="lnk" id="notifSettings" style="margin-top:4px">Notifications on this device…</button>`;
  p.querySelectorAll("[data-nmsg]").forEach((b) => b.onclick = () => { p.classList.add("hidden"); showTab("messages"); setTimeout(() => openMail(Number(b.dataset.nmsg)), 600); });
  p.querySelectorAll("[data-nreq]").forEach((b) => b.onclick = () => { p.classList.add("hidden"); shReqOpen(); });
  $("notifSettings").onclick = () => { p.classList.add("hidden"); showTab("notifset"); };
};

// ------------------------------------------------------------------ notifications of the teacher (Web Push)
function pushKey() { return (window.CONFIG && CONFIG.vapidPublicKey) || ""; }
function b64ToBytes(b) { const p = "=".repeat((4 - (b.length % 4)) % 4), raw = atob((b + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from([...raw].map((c) => c.charCodeAt(0))); }
const pushPossible = () => !!pushKey() && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
async function tPushOn() {
  if (!pushPossible()) { toast("This browser cannot receive notifications (on an iPhone: first « Add to Home Screen »).", "error"); return false; }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") { toast("Notifications refused by the browser: allow them in the settings of the site.", "error"); return false; }
    const reg = await navigator.serviceWorker.register("sw-push.js");
    await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(pushKey()) });
    const j = sub.toJSON();
    await rpc("t_push_subscribe", { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    shStore("cp_tpush", "on"); toast("Notifications turned on for this device.", "ok"); return true;
  } catch (e) { toast(e.message, "error"); return false; }
}
async function tPushOff() {
  try {
    const reg = await navigator.serviceWorker.getRegistration("sw-push.js"), sub = reg && await reg.pushManager.getSubscription();
    if (sub) { await rpc("t_push_unsubscribe", { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
    shStore("cp_tpush", "off"); toast("Notifications turned off on this device.", "ok");
  } catch (e) { toast(e.message, "error"); }
  shNotifState();
}
async function shNotifState() {
  let state = !pushKey() ? "The site has no notification key yet (config.js)." : !pushPossible() ? "This browser cannot receive notifications here (iPhone: add ClassPulse to the home screen first)."
    : Notification.permission === "denied" ? "Blocked by the browser: allow the notifications in the settings of this site." : "Off on this device.";
  try {
    const reg = pushPossible() && await navigator.serviceWorker.getRegistration("sw-push.js"), sub = reg && await reg.pushManager.getSubscription();
    if (sub && Notification.permission === "granted") state = "On for this device: messages of the students and requests.";
  } catch (e) { /* keep */ }
  $("tNotifState").textContent = state;
  const ask = pushPossible() && Notification.permission === "default" && shStore("cp_tpush_later") !== "1" && shStore("cp_tpush") !== "on";
  $("notifAsk").classList.toggle("hidden", !ask);
}
$("notifAskOn").onclick = async () => { $("notifAsk").classList.add("hidden"); await tPushOn(); shNotifState(); };
$("notifAskLater").onclick = () => { shStore("cp_tpush_later", "1"); $("notifAsk").classList.add("hidden"); };
$("tNotifOn").onclick = async () => { await tPushOn(); shNotifState(); };
$("tNotifOff").onclick = tPushOff;
// a click on a notification opens teacher.html?space=…
(function () { const sp = new URLSearchParams(location.search).get("space"); if (sp) setTimeout(() => showSpace(sp === "msg" ? "msg" : sp), 1200); })();

// ------------------------------------------------------------------ Live: the three cards
function shLive() {
  shHeader();
  const L = live, has = !!(sessionId && L && L.session);
  $("lvSummary").classList.toggle("hidden", !has);
  $("lvCodeChip").textContent = has ? L.session.code || sessionCode || "" : "";
  ["lvAttToggle", "lvFloat", "lvProj", "lvMoreBtn"].forEach((id) => { $(id).disabled = !has; });
  shTodo();
  if (!has) return;
  const s = L.session, list = lastAttendance || [];
  const late = list.filter((r) => r.status === "late").length;
  $("lvTitle").textContent = s.title + (s.ended_at ? " · ended" : "");
  $("lvPresent").textContent = L.present;
  $("lvExpected").textContent = `/ ${L.class_size} expected · ${late} late`;
  const open = !!s.attendance_open;
  $("lvAttToggle").textContent = open ? "Close the attendance" : "Open the attendance";
  $("lvAttToggle").className = "btn sm " + (open ? "sec" : "gr");
  $("lvAttCode").classList.toggle("hidden", !open);
  $("lvAttCodeTxt").textContent = $("attCodeBig").textContent;
  $("lvAttNote").textContent = Number(s.att_window_s) >= 999999 ? "· fixed until you close" : Number(s.att_window_s) >= 86400 ? "· fixed for the day" : "· changes every " + s.att_window_s + " s";
  // requests: in the window (To do, bell, orange band)
  $("reqNone").classList.toggle("hidden", shReqCount() > 0 || !$("silentBox").classList.contains("hidden"));
  // quiz
  const q = L.quiz;
  $("lqTitle").textContent = q ? q.title : "Quiz";
  let chip = "", bar = 0, ans = "No quiz running: choose one, or « ＋ Run a prepared quiz ».";
  if (q) {
    if (q.pace === "self") { chip = q.phase === "self" ? "open, own pace" : q.phase; bar = L.present ? 100 * (q.done || 0) / L.present : 0; ans = `<strong>${q.done || 0} / ${L.present}</strong> finished · ${q.started || 0} started`; }
    else if (q.phase === "question" || q.phase === "reveal") {
      chip = `Q${q.index + 1} / ${q.count}` + (q.phase === "question" ? ` · ${formatSeconds(q.remaining_ms)} s` : " · answers shown");
      bar = L.present ? 100 * (q.answers || 0) / L.present : 0; ans = `<strong>${q.answers || 0} / ${L.present}</strong> answers`;
    } else if (q.phase === "lobby") { chip = "rules on the phones"; ans = `<strong>${q.ready || 0} / ${L.present}</strong> ready`; }
    else chip = q.phase === "finished" ? "finished" : "not started";
  }
  $("lqChip").textContent = chip;
  $("lqBar").style.width = Math.min(100, bar) + "%";
  $("lqAnswers").innerHTML = ans;
  const self = q && q.pace === "self";
  $("lqAdd30").disabled = !q || self || q.phase !== "question";
}
window.onLiveRefresh = shLive;
$("lvAttToggle").onclick = () => { const L = live; if (!L) return; (L.session.attendance_open ? $("attOffBtn") : $("attOnBtn")).click(); };
$("lvFloat").onclick = () => $("floatQrBtn").click();
$("lvProj").onclick = () => $("projectorBtn").click();
$("lvMoreBtn").onclick = () => openDlg("dlgMore");
$("lvNewBtn").onclick = () => openSessionDialog(null);   // v33.2: the same dialog creates and edits a session
$("lqAdd30").onclick = () => { $("addTimeSel").value = "30"; $("addTimeBtn").click(); };
$("lqPush").onclick = () => { openDlg("dlgMore"); setTimeout(() => { $("linkSelect").scrollIntoView({ block: "center" }); $("linkSelect").focus(); }, 50); };
$("lqDraw").onclick = () => { $("draw1Btn").click(); setTimeout(() => { const n = $("drawList").querySelector("td"); if (n) toast("At the board: " + n.textContent, "ok"); }, 900); };
$("lqBigQr").onclick = () => $("joinQrBtn").click();
$("lqMoreBtn").onclick = () => openDlg("dlgQuiz");
$("lqLaunchBtn").onclick = () => { openDlg("dlgQuiz"); setTimeout(() => $("tplSelect").focus(), 50); };

// ------------------------------------------------------------------ Live: the list (present, late, then absent)
function shScopes(list) {
  const L = live, s = L && L.session;
  const groups = grpList(list);
  const sessLabel = s && s.kind !== "course" && (L.run && L.run.group) ? "Group of the session (" + L.run.group + ")" : s && s.kind !== "course" && (s.groups || []).length ? "Group of the session" : "Section (this session)";
  return [["session", sessLabel], ["all", "Whole section"]].concat(groups);
}
window.renderLiveList = function (list) {
  const scopes = shScopes(list);
  if (!scopes.some((x) => x[0] === SH.liveScope)) SH.liveScope = "session";
  $("attScopes").innerHTML = scopes.map(([k, l]) => `<button class="pill ${SH.liveScope === k ? "on" : ""}" data-scope="${esc(k)}">${esc(l)}</button>`).join("");
  const term = norm($("attSearch").value);
  let rows;
  if (term) rows = list.filter((r) => norm(r.name + " " + r.matricule).includes(term));
  else if (SH.liveScope === "session") rows = list.filter((r) => r.member || r.run_member || r.this_run || r.status);
  else if (SH.liveScope === "all") rows = list.slice();
  else rows = list.filter((r) => grpHas(r, SH.liveScope));
  const ended = !!(live && live.session && (live.session.ended_at || !live.session.attendance_open));
  const st = (r) => r.status || (ended ? "absent" : "");
  const ORDER = { present: 0, late: 1, "": 2, absent: 3, excused: 4 };
  rows.sort((a, b) => (ORDER[st(a)] - ORDER[st(b)]) || String(a.name).localeCompare(String(b.name)));
  const cnt = (k) => rows.filter((r) => st(r) === k).length;
  $("attCounts").innerHTML = `<span class="chip ok">${cnt("present")} present</span><span class="chip late">${cnt("late")} late</span>`
    + (cnt("") ? `<span class="chip none">${cnt("")} not yet</span>` : "") + `<span class="chip abs">${cnt("absent")} absent</span>` + (cnt("excused") ? `<span class="chip exc">${cnt("excused")} excused</span>` : "");
  const per = Number($("attRows").value) || 0, pages = per ? Math.max(1, Math.ceil(rows.length / per)) : 1;
  SH.livePage = Math.min(SH.livePage, pages - 1);
  const shown = per ? rows.slice(SH.livePage * per, SH.livePage * per + per) : rows;
  const enough = list.filter((r) => r.located).length >= 3;
  const kind = live && live.session ? live.session.kind : "";
  const opts = ["", "present", "late", "absent", "excused"];
  const html = `<table class="v-table"><thead><tr><th>Student</th><th>TD</th><th>TP</th><th>Arrival</th><th>Presence</th><th>Note</th></tr></thead><tbody>` + shown.map((r) => {
    const s = r.status || "", note = [];
    if (!r.official) note.push("not in the official list");
    if (!r.member) note.push(r.status ? "guest" : "other group");
    if (r.method === "manual") note.push("changed by hand");
    if (checkLocation && r.located && r.distance != null && enough && r.distance > (CONFIG.farFromRoomM || 300)) note.push("📍 " + (r.distance >= 1000 ? (r.distance / 1000).toFixed(1) + " km" : r.distance + " m") + " away");
    return `<tr><td><button class="lnk" data-profile="${r.student_id}">${esc(r.name)}</button></td><td>${esc(r.td_group || "")}</td><td>${esc(r.tp_group || "")}</td>
      <td>${r.at && r.method !== "manual" ? new Date(r.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</td>
      <td><select class="st-sel ${s || "none"}" data-student="${r.student_id}" aria-label="Presence of ${esc(r.name)}">${opts.map((o) => `<option value="${o || "none"}" ${s === o ? "selected" : ""}>${o ? STATUS_LABEL[o] : (ended ? "Absent" : "Not yet")}</option>`).join("")}</select></td>
      <td class="note">${esc(note.join(" · "))} <span class="bonus-cell"><button class="btn sec sm" data-bonus="${r.student_id}" data-pts="-0.25" title="Bonus ${esc(SESSION_KIND[kind] || "")} −0.25">−</button>
        <strong>${Number(r.bonus) ? "+" + Number(r.bonus) : "0"}</strong><button class="btn gr sm" data-bonus="${r.student_id}" data-pts="0.25" title="Bonus ${esc(SESSION_KIND[kind] || "")}">+0.25</button></span></td></tr>`;
  }).join("") + `</tbody></table>` + (pages > 1 ? `<div class="pager">Page ${SH.livePage + 1} / ${pages} <button class="btn sec sm" data-lpage="-1">◀</button><button class="btn sec sm" data-lpage="1">▶</button></div>` : "");
  if (html === attLastHtml) return;
  attLastHtml = html;
  $("attendanceTable").innerHTML = html;
  shLive();
};
$("attScopes").addEventListener("click", (e) => { const b = e.target.closest("[data-scope]"); if (!b) return; SH.liveScope = b.dataset.scope; SH.livePage = 0; attLastHtml = ""; window.renderLiveList(lastAttendance); });
$("attRows").onchange = () => { SH.livePage = 0; attLastHtml = ""; window.renderLiveList(lastAttendance); };
$("attendanceTable").addEventListener("click", (e) => { const b = e.target.closest("[data-lpage]"); if (!b) return; SH.livePage = Math.max(0, SH.livePage + Number(b.dataset.lpage)); attLastHtml = ""; window.renderLiveList(lastAttendance); });

// ------------------------------------------------------------------ the marks of the class (shared by the student list and the side panel)
async function shGrading(force) {
  if (!classId) return null;
  if (!force && SH.grading && SH.gradingCid === classId) return SH.grading;
  if (!force && typeof GT !== "undefined" && GT.raw && GT.cid === classId) { SH.grading = GT.raw; SH.gradingCid = classId; return SH.grading; }
  const cid = classId;
  try { const g = await rpc("t_grading", { p_class: cid }); if (cid !== classId) return null; SH.grading = g; SH.gradingCid = cid; return g; }
  catch (e) { return null; }
}
// attendance of every student: only his own sessions (a TP of another sub-group does not count)
function shPresence(g) {
  const d = g.data, out = {};
  const taken = new Set(d.attendance.map((a) => a.session_id));
  const att = {}; d.attendance.forEach((a) => { att[a.session_id + "|" + a.student_id] = a.status; });
  const member = (ses, st) => { const gs = ses.groups && ses.groups.length ? ses.groups : (ses.group ? [ses.group] : []);
    if (!gs.length) return true; if (ses.kind === "td") return gs.includes(st.td_group); if (ses.kind === "tp") return gs.includes(st.tp_group); return gs.includes(st.td_group) || gs.includes(st.tp_group); };
  d.students.forEach((st) => {
    let n = 0, p = 0, l = 0, a = 0;
    d.sessions.filter((ses) => taken.has(ses.id)).forEach((ses) => {
      const s = att[ses.id + "|" + st.id];
      if (!s && !member(ses, st)) return;
      if (s === "excused") return;
      n++; if (s === "present") p++; else if (s === "late") { p++; l++; } else a++;
    });
    out[st.id] = { rate: n ? 100 * p / n : null, late: l, absent: a, n };
  });
  return out;
}
function shFinals(g) {
  try { const b = GRADE.build(g), o = {}; b.rows.forEach((r) => { o[r.st.id] = r.final; }); return { finals: o, b }; } catch (e) { return { finals: {}, b: null }; }
}

// ------------------------------------------------------------------ My class › Students (the list of the mockup)
window.onStudents = function (all) { SH.students = all; shStudents(); };
async function shStudents() {
  const all = SH.students;
  const groups = grpList(all);
  const gsel = $("stuGroup"), keep = gsel.value;
  gsel.innerHTML = `<option value="">All</option>` + groups.map(([k, l]) => `<option value="${esc(k)}" ${k === keep ? "selected" : ""}>${esc(l)}</option>`).join("");
  const t = norm($("stuSearch").value), gv = gsel.value, out = $("stuRemoved").checked;
  $("stuRemovedN").textContent = all.filter((s) => s.removed).length;
  const rows = all.filter((s) => !!s.removed === out && (!t || norm(`${s.matricule} ${s.last_name} ${s.first_name}`).includes(t)) && (!gv || grpHas(s, gv)));
  const g = await shGrading();
  const pres = g ? shPresence(g) : {}, fin = g ? shFinals(g).finals : {};
  const per = Number($("stuRows").value) || 0, pages = per ? Math.max(1, Math.ceil(rows.length / per)) : 1;
  SH.stuPage = Math.min(SH.stuPage, pages - 1);
  const shown = per ? rows.slice(SH.stuPage * per, SH.stuPage * per + per) : rows;
  const phone = window.matchMedia("(max-width: 760px)").matches;
  $("stuTable").innerHTML = phone
    ? shown.map((s) => `<button class="stu-row" data-profile="${s.id}"><span><strong>${esc(nameOf(s))}</strong><span class="muted" style="display:block;font-size:13px">${esc(s.td_group || "—")} · ${esc(s.tp_group || "—")} · presence ${pct(pres[s.id] && pres[s.id].rate)}</span></span><span class="muted">${fmt2(fin[s.id])} ›</span></button>`).join("")
    : `<table class="v-table"><thead><tr><th><input type="checkbox" id="stuAllBox" aria-label="Choose all" style="min-height:0"></th><th>Student</th><th>Student number</th><th>TD</th><th>TP</th><th>Presence</th><th>Late</th><th>Final mark</th><th>Device</th></tr></thead><tbody>` +
      shown.map((s) => `<tr class="${s.removed ? "removed-row" : ""}"><td><input type="checkbox" data-stusel="${s.id}" ${SH.stuSel.has(s.id) ? "checked" : ""} aria-label="Choose ${esc(nameOf(s))}" style="min-height:0"></td>
        <td><button class="lnk" data-profile="${s.id}">${esc(nameOf(s))}</button>${s.official === false || s.in_official_list === false ? ' <span class="chip red">not official</span>' : ""}</td>
        <td>${esc(s.matricule)}</td><td>${esc(s.td_group || "")}</td><td>${esc(s.tp_group || "")}</td><td>${pct(pres[s.id] && pres[s.id].rate)}</td><td>${pres[s.id] ? pres[s.id].late : "—"}</td>
        <td>${fmt2(fin[s.id])}</td><td class="note">${s.registered || s.device_kind ? esc(s.device_kind || "linked") : '<span class="muted">none</span>'}</td></tr>`).join("") + `</tbody></table>`;
  $("stuTable").insertAdjacentHTML("beforeend", (pages > 1 ? `<div class="pager">${rows.length} student(s) · page ${SH.stuPage + 1} / ${pages} <button class="btn sec sm" data-spage="-1">◀</button><button class="btn sec sm" data-spage="1">▶</button></div>` : `<div class="pager">${rows.length} student(s)</div>`));
  shStuSelBar();
}
function shStuSelBar() { $("stuSelBar").classList.toggle("hidden", !SH.stuSel.size); $("stuSelCount").textContent = SH.stuSel.size; }
$("stuSearch").oninput = () => { SH.stuPage = 0; shStudents(); };
$("stuGroup").onchange = () => { SH.stuPage = 0; shStudents(); };
$("stuRemoved").onchange = () => { SH.stuPage = 0; SH.stuSel.clear(); shStudents(); };
$("stuRows").onchange = () => { SH.stuPage = 0; shStudents(); };
$("stuTable").addEventListener("change", (e) => {
  if (e.target.id === "stuAllBox") { $("stuTable").querySelectorAll("[data-stusel]").forEach((c) => { c.checked = e.target.checked; if (c.checked) SH.stuSel.add(c.dataset.stusel); else SH.stuSel.delete(c.dataset.stusel); }); shStuSelBar(); return; }
  const c = e.target.closest("[data-stusel]"); if (!c) return;
  if (c.checked) SH.stuSel.add(c.dataset.stusel); else SH.stuSel.delete(c.dataset.stusel);
  shStuSelBar();
});
$("stuTable").addEventListener("click", (e) => { const b = e.target.closest("[data-spage]"); if (b) { SH.stuPage = Math.max(0, SH.stuPage + Number(b.dataset.spage)); shStudents(); } });
$("stuManageBtn").onclick = () => { $("stuManage").classList.remove("hidden"); $("stuCard").classList.add("hidden"); };
$("stuBackBtn").onclick = () => { $("stuManage").classList.add("hidden"); $("stuCard").classList.remove("hidden"); };
function writeTo(ids) {
  showTab("messages");
  $("composeWrap").classList.remove("hidden");
  $("msgKind").value = "students"; syncMsgKind();
  msgPicked = new Set(ids); renderMsgPick();
  setTimeout(() => $("msgBody").focus(), 200);
}
$("stuSelWrite").onclick = () => writeTo([...SH.stuSel]);
$("stuSelGroup").onclick = async () => {
  const td = prompt(`TD group of the ${SH.stuSel.size} student(s) (empty = no change, « - » = none):`, ""); if (td === null) return;
  const tp = prompt("TP sub-group (empty = no change, « - » = none):", ""); if (tp === null) return;
  try { await rpc("t_move_students", { p_class: classId, p_students: [...SH.stuSel], p_td: td.trim() || null, p_tp: tp.trim() || null });
    toast("Groups changed.", "ok"); SH.stuSel.clear(); SH.grading = null; loadStudents(); } catch (e) { toast(e.message, "error"); }
};
$("stuSelReopen").onclick = () => { toast("Choose the quiz, then « Make-up » for the selected students.", "ok"); showTab("results"); showRt("quizzes"); };

// ------------------------------------------------------------------ the card of a student (v33.2: everything about him from here)
// presence in the session, groups, write, device, PIN, his sessions, his quizzes (his answers, a make-up for him alone,
// the mark), and the protected removal: first « Take out of the class » (results kept), then « Erase » by typing his name.
window.openDrawer = async function (id) {
  const d = $("drawer");
  d.innerHTML = `<p class="muted">…</p>`; d.classList.remove("hidden");
  $("topSearchList").classList.add("hidden");
  let p;
  try { p = await rpc("t_student_profile", { p_student: id }); } catch (e) { d.classList.add("hidden"); toast(e.message, "error"); return; }
  SH.drawer = id;
  const g = await shGrading();
  const st = p.student, name = nameOf(st);
  const mine = p.sessions.filter((x) => x.status !== "other group");
  const counted = mine.filter((x) => x.status !== "excused"), here = counted.filter((x) => x.status === "present" || x.status === "late");
  const late = mine.filter((x) => x.status === "late").length;
  let finalTxt = "—", finalLabel = "Final mark", cells = [];
  if (g) {
    const fb = shFinals(g), b = fb.b;
    if (b) {
      const r = b.rows.find((x) => x.st.id === id);
      if (r) { finalTxt = fmt2(r.final); const v = (g.visibility || []).find((x) => x.item === "final"); finalLabel = "Final" + (v && v.visible ? " (shown)" : " (hidden)");
        cells = b.cols.map((c, j) => ({ c, j, x: r.cells[j] })).filter(({ x }) => x.st !== "none"); }
    }
  }
  const row = sessionId ? (lastAttendance || []).find((r) => r.student_id === id) : null;
  const tdList = [...new Set(SH.students.map((s) => s.td_group).filter(Boolean))].sort(), tpList = [...new Set(SH.students.map((s) => s.tp_group).filter(Boolean))].sort();
  const sel = (cls, cur, list) => `<select class="${cls}"><option value="">—</option>${[...new Set(list.concat(cur ? [cur] : []))].map((x) => `<option ${x === cur ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>`;
  const hist = (key) => ((g && g.mark_log) || []).filter((l) => l.student_id === id && l.key === key).slice(0, 2).map((l) => `${fmtWhen(l.at)}: ${esc(l.old || "—")} → ${esc(l.new || "—")}`).join(" · ");
  const chipOf = (s) => ({ present: "ok", late: "late", absent: "abs", excused: "exc" }[s] || "none");
  const qName = (q) => (q.unit ? q.unit + (q.run_group ? " · " + q.run_group : "") + " · " : "") + q.title;
  const qState = (q) => q.status === "answered" ? `<strong>${q.mark == null ? "—" : fmt2(Number(q.mark))}</strong><span class="muted">/${fmt2(Number(q.total_points))}</span>${q.corrected ? '<span style="color:#E8741E"> •</span>' : ""}`
    : `<span class="muted">${{ "no answer": "no answer (0)", absent: "absent (0)", excused: "excused", "other group": "another pass" }[q.status] || esc(q.status)}</span>`;
  const quizzes = p.quizzes.filter((q) => q.status !== "other group" || q.mark != null);
  d.innerHTML = `<div class="card-head"><span class="ini">${esc(initials(st.last_name + " " + st.first_name))}</span>
      <div class="grow"><strong style="font-size:19px">${esc(name)}</strong><div class="small-t">${esc(st.matricule)}${st.email ? ` · <a href="mailto:${esc(st.email)}">${esc(st.email)}</a>` : ""}
        ${st.removed ? ' · <span class="chip red">taken out of the class</span>' : ""}${st.official === false ? ' · <span class="chip red">not official</span>' : ""}</div></div>
      <button class="btn sec sm" id="drClose" aria-label="Close the panel">Close</button></div>
    <div class="box"><strong style="font-size:14px">${row ? "In the session now" : "Groups"}</strong>
      ${row ? `<div class="pills">${["present", "late", "absent", "excused"].map((k) => `<button class="pill ${row.status === k ? "on" : ""}" data-drst="${k}">${STATUS_LABEL[k]}</button>`).join("")}</div>` : ""}
      <div class="row" style="gap:10px"><label class="small-t">TD ${sel("dr-td", st.td_group, tdList)}</label><label class="small-t">TP ${sel("dr-tp", st.tp_group, tpList)}</label>
        <button class="btn sec sm" id="drGroups" data-perm-req="students_edit">Save the groups</button></div></div>
    <div class="pills"><button class="btn or sm" id="drWrite">Write</button><button class="btn sec sm" id="drDevice">Allow a new device</button>
      <button class="btn sec sm" id="drPin">${st.pin_locked ? "Unlock the PIN (locked)" : "Unlock the PIN"}</button><button class="btn sec sm" id="drFull">Full profile…</button></div>
    <div class="kpis"><div><span>Presence</span><strong>${counted.length ? Math.round(100 * here.length / counted.length) + " %" : "—"}</strong></div>
      <div><span>Late</span><strong>${late}</strong></div><div><span>${finalLabel}</span><strong>${finalTxt}</strong></div>
      <div><span>Device</span><strong style="font-size:14px">${st.registered ? esc(st.device_kind || "linked") : "none"}</strong></div></div>
    <div class="dr-section"><strong style="font-size:14px">Presence — his sessions only</strong>
      <div class="chips">${mine.map((x) => `<span class="chip ${chipOf(x.status)}" title="${esc(x.date)} ${esc(x.title)}">${esc(x.unit || x.title)}${x.status === "late" ? " · late" : x.status === "absent" ? " · absent" : x.status === "excused" ? " · excused" : " ✓"}</span>`).join("") || '<span class="muted">No session yet.</span>'}</div>
      <span class="small-t">The TP sessions of the other sub-groups are not shown.</span></div>
    <div class="dr-section"><strong style="font-size:14px">Quizzes and tests</strong>
      ${quizzes.map((q) => `<div class="dr-quiz"><span>${esc(qName(q))} <span class="muted small-t">${esc(q.date)}</span>${q.makeup_until ? ` <span class="chip late">make-up until ${esc(fmtWhen(q.makeup_until))}</span>` : ""}</span>
        <span style="white-space:nowrap">${qState(q)} <button class="lnk" data-drans="${q.quiz_id}">Answers</button> <button class="lnk" data-drmk="${q.quiz_id}" data-perm-req="makeup">Make-up</button></span></div>
        <div id="drAns_${q.quiz_id}" class="hidden"></div>`).join("") || '<span class="muted">No quiz yet.</span>'}</div>
    <div class="dr-section"><strong style="font-size:14px">Marks of the final calculation (click to correct)</strong>
      <table><tbody>${cells.map(({ c, j, x }) => `<tr><td>${esc(c.title)}</td><td><button class="lnk" data-drmark="${j}">${x.st === "abs" ? (x.noans ? "no answer (0)" : "abs (0)") : x.st === "exc" ? "exc" : fmt2(x.v)}</button>${x.corrected || x.forced ? '<span style="color:#E8741E"> •</span>' : ""} <span class="muted">/${fmt2(c.scale)}</span></td>
        <td class="small-t">${hist(c.key)}</td></tr>`).join("") || '<tr><td class="muted">No mark yet.</td></tr>'}</tbody></table></div>
    <div class="dr-danger teacher-only"><strong style="font-size:14px">Remove this student</strong>
      ${st.removed ? `<span class="small-t">Taken out of the class on ${esc(fmtWhen(st.removed_at))}: he is in no list, his results are kept.</span>
        <div class="row" style="gap:8px"><button class="btn sec sm" id="drBack">Bring him back to the class</button><button class="btn sm red" id="drErase">Erase for good…</button></div>`
      : `<span class="small-t">« Take out of the class »: he leaves the lists and the marks; his attendance, answers and marks are kept (you can bring him back).</span>
        <div class="row" style="gap:8px"><button class="btn sec sm" id="drRemove">Take out of the class</button><button class="btn sm red" id="drErase">Erase for good…</button></div>`}</div>`;
  const reopen = () => window.openDrawer(id);
  $("drClose").onclick = () => { d.classList.add("hidden"); SH.drawer = null; };
  d.querySelectorAll("[data-drst]").forEach((b) => b.onclick = async () => {
    await act("t_set_attendance", { p_session: sessionId, p_student: id, p_status: b.dataset.drst }, `${name}: ${STATUS_LABEL[b.dataset.drst].toLowerCase()}`);
    attLastHtml = ""; await refreshAttendance(); reopen();
  });
  $("drGroups").onclick = async () => {
    try { await rpc("t_set_student_groups", { p_student: id, p_td: d.querySelector(".dr-td").value, p_tp: d.querySelector(".dr-tp").value }); toast("Groups saved.", "ok"); SH.grading = null; loadStudents(); }
    catch (e) { toast(e.message, "error"); }
  };
  $("drWrite").onclick = () => { d.classList.add("hidden"); writeTo([id]); };
  $("drDevice").onclick = async () => { if (confirm(`Allow ${name} to link a new device (his next device becomes his class device)?`)) await act("t_allow_new_device", { p_student: id }, "Done: his next device becomes his class device."); };
  $("drPin").onclick = async () => { await act("t_unlock_pin", { p_student: id }, "PIN unlocked."); reopen(); };
  $("drFull").onclick = () => openProfile(id);
  // his answers to one quiz (the text of each answer, the expected value of his station)
  d.querySelectorAll("[data-drans]").forEach((b) => b.onclick = async () => {
    const box = $("drAns_" + b.dataset.drans);
    if (!box.classList.contains("hidden")) { box.classList.add("hidden"); return; }
    box.innerHTML = `<p class="muted">…</p>`; box.classList.remove("hidden");
    try { const c = await rpc("t_quiz_compare", { p_quiz: b.dataset.drans, p_a: id, p_b: id }); box.innerHTML = cmpTable(c, true); }
    catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  });
  // a make-up for him alone
  d.querySelectorAll("[data-drmk]").forEach((b) => b.onclick = async () => {
    const days = prompt(`Make-up of this quiz for ${name} alone: how many days does he have? (he takes it on his class device)`, "2");
    if (days === null) return;
    const n = Math.max(0.05, Number(String(days).replace(",", ".")) || 2);
    try { const r = await rpc("t_makeup_grant", { p_quiz: b.dataset.drmk, p_students: [id], p_until: new Date(Date.now() + n * 86400000).toISOString() });
      if (r && Number(r.granted) === 0) { toast("Nothing to make up: he answered every question of this quiz.", "error"); return; }
      toast("Make-up given: he sees it on his home page.", "ok"); reopen(); }
    catch (e) { toast(e.message, "error"); }
  });
  d.querySelectorAll("[data-drmark]").forEach((b) => b.onclick = () => {
    d.classList.add("hidden");
    showTab("results"); showRt("marks");
    setTimeout(() => { if (GT.b) { GT.edit = { j: Number(b.dataset.drmark), sid: id }; GT.entry = null; renderMarks(); } }, 900);
  });
  const after = async () => { SH.grading = null; await shLoadStudents(); if (activeTab === "students") shStudents(); };
  if ($("drRemove")) $("drRemove").onclick = async () => {
    if (!confirm(`Take ${name} out of the class?\nHe leaves the lists and the marks. His attendance, answers and marks are kept: you can bring him back.`)) return;
    try { await rpc("t_remove_student", { p_student: id, p_remove: true }); toast(`${name} is taken out of the class (results kept).`, "ok"); await after(); reopen(); } catch (e) { toast(e.message, "error"); }
  };
  if ($("drBack")) $("drBack").onclick = async () => {
    try { await rpc("t_remove_student", { p_student: id, p_remove: false }); toast(`${name} is back in the class.`, "ok"); await after(); reopen(); } catch (e) { toast(e.message, "error"); }
  };
  $("drErase").onclick = async () => {
    const ok = await confirmTyped({ title: "Erase a student for good", expected: st.last_name,
      message: `Everything of <strong>${esc(name)}</strong> (${esc(st.matricule)}) is deleted: attendance, answers, marks, messages. This cannot be undone.
        To keep his results, use « Take out of the class » instead.`, button: "Erase for good" });
    if (!ok) return;
    try { await rpc("t_erase_student", { p_student: id, p_confirm: st.last_name }); toast(`${name} is erased.`, "ok"); d.classList.add("hidden"); SH.drawer = null; await after(); }
    catch (e) { toast(e.message, "error"); }
  };
  if (typeof applyRole === "function") try { d.querySelectorAll(".teacher-only").forEach((el) => el.classList.toggle("hidden", isAssistant())); } catch (e) { /* role unknown */ }
};

// ------------------------------------------------------------------ « Compare two students » (results of one quiz)
// the text of each answer (not a letter: the choices may be mixed for each student), the number typed, the station,
// the value expected for that station, the points, the time it was saved, and the likely reason of a difference
function cmpAnswer(qu, a) {
  if (!a || (!a.choice && a.number == null)) return a && a.drawn === false ? '<span class="muted">not drawn for him</span>' : '<span class="muted">no answer saved</span>';
  if (qu.qtype === "number") return `<strong>${esc(String(Number(a.number)))}</strong>${qu.unit ? " " + esc(qu.unit) : ""}`;
  return (a.choice || []).map((i) => esc((qu.options || [])[i] != null ? qu.options[i] : "?")).join("<br>") || '<span class="muted">nothing ticked</span>';
}
function cmpWhy(qu, A, B, sa, sb) {
  const why = [];
  const ea = A && A.expected, eb = B && B.expected;
  if (qu.qtype === "number") {
    if ((sa.station_used || null) !== (sb.station_used || null)) why.push("different stations: different expected values");
    else if (ea !== eb) why.push("different values drawn for each one");
    if (A && B && A.number != null && B.number != null && Number(A.number) === Number(B.number) && Number(A.score) !== Number(B.score)) why.push("same number, other expected value (station or tolerance " + Number(qu.tolerance) + " %)");
  } else if (A && B && JSON.stringify(A.choice) === JSON.stringify(B.choice) && Number(A.score) !== Number(B.score)) why.push("same answer, other score: question corrected after one of them?");
  if (A && B && ((A.choice || A.number != null) ? 1 : 0) !== ((B.choice || B.number != null) ? 1 : 0)) why.push("one answer not saved");
  if (qu.dropped) why.push("question dropped (out of the mark)");
  return why.join(" · ");
}
function cmpTable(c, single) {
  const S = c.students, sa = S[0], sb = S[1] || S[0];
  const head = single ? "" : `<tr><th></th><th>${esc(sa.name)}</th><th>${esc(sb.name)}</th></tr>`;
  const st = (s) => `${s.station != null ? "station " + s.station + (s.station_used != null && s.station_used !== s.station ? " → " + s.station_used : "") : "no station"}`;
  const top = single ? `<p class="small-t">${esc(st(sa))} · ${fmt2(Number(sa.points))} point(s) on ${fmt2(Number(sa.max || c.quiz.max_points))} · mark ${sa.mark == null ? "—" : fmt2(Number(sa.mark))} / ${fmt2(Number(c.quiz.total_points))}</p>`
    : `<tr><td>Station</td><td>${esc(st(sa))}</td><td>${esc(st(sb))}</td></tr>
      <tr><td>Points</td><td>${fmt2(Number(sa.points))} / ${fmt2(Number(sa.max || c.quiz.max_points))}</td><td>${fmt2(Number(sb.points))} / ${fmt2(Number(sb.max || c.quiz.max_points))}</td></tr>
      <tr><td>Penalty</td><td>${Number(sa.penalty) ? "−" + fmt2(Number(sa.penalty)) : "—"}</td><td>${Number(sb.penalty) ? "−" + fmt2(Number(sb.penalty)) : "—"}</td></tr>
      <tr><td>Mark / ${fmt2(Number(c.quiz.total_points))}</td><td><strong>${sa.mark == null ? "—" : fmt2(Number(sa.mark))}</strong>${sa.override != null ? " (corrected)" : ""}</td><td><strong>${sb.mark == null ? "—" : fmt2(Number(sb.mark))}</strong>${sb.override != null ? " (corrected)" : ""}</td></tr>`;
  const rows = c.questions.map((qu) => {
    const A = (qu.answers || [])[0], B = single ? null : (qu.answers || [])[1];
    const cell = (a) => `${cmpAnswer(qu, a)}${a && a.expected != null ? `<div class="exp">expected: ${esc(a.expected)}${qu.unit ? " " + esc(qu.unit) : ""}</div>` : ""}
      ${a && a.score != null ? `<div class="exp">${fmt2(Number(a.score))} / ${fmt2(Number(qu.points))} pt · ${new Date(a.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</div>` : ""}`;
    const diff = !single && A && B && Number(A.score || 0) !== Number(B.score || 0);
    const why = single ? "" : cmpWhy(qu, A, B, sa, sb);
    return `<tr class="${diff ? "diff" : ""}"><td><strong>Q${qu.n}</strong> ${esc(qu.text)}${qu.qtype === "choice" ? `<div class="exp">correct: ${(qu.correct || []).map((i) => esc((qu.options || [])[i] || "?")).join(" · ") || "—"}</div>` : ""}
      ${why ? `<div class="why">${esc(why)}</div>` : ""}</td><td>${cell(A)}</td>${single ? "" : `<td>${cell(B)}</td>`}</tr>`;
  }).join("");
  return single ? top + `<table class="cmp-table">${rows}</table>` : `<table class="cmp-table">${head}${top}<tr><td colspan="3" class="req-title">Questions (orange: different points)</td></tr>${rows}</table>`;
}
window.openCompare = function (d) {
  const list = d.students.filter((s) => s.status !== "other group");
  const opts = (cur) => list.map((s) => `<option value="${s.id}" ${s.id === cur ? "selected" : ""}>${esc(s.last_name + " " + s.first_name)} · ${s.status === "answered" ? (s.mark == null ? "—" : Number(s.mark)) : STATUS_TEXT[s.status] || s.status}</option>`).join("");
  const ans = list.filter((s) => s.status === "answered");
  $("cmpA").innerHTML = opts((ans[0] || list[0] || {}).id); $("cmpB").innerHTML = opts((ans[1] || list[1] || {}).id);
  $("cmpOut").innerHTML = `<p class="muted">Choose two students, then « Compare ».</p>`;
  $("cmpGo").onclick = async () => {
    if ($("cmpA").value === $("cmpB").value) { toast("Choose two different students.", "error"); return; }
    $("cmpOut").innerHTML = `<p class="muted">…</p>`;
    try { const c = await rpc("t_quiz_compare", { p_quiz: d.quiz.id, p_a: $("cmpA").value, p_b: $("cmpB").value }); $("cmpOut").innerHTML = cmpTable(c, false); }
    catch (e) { $("cmpOut").innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  };
  $("dlgCompare").classList.remove("hidden");
  if (ans.length >= 2) $("cmpGo").click();
};

// ------------------------------------------------------------------ Results: the phone buttons Marks / Calculation / Visibility
document.querySelectorAll("[data-rtgo]").forEach((b) => { b.onclick = () => { showTab("results"); showRt(b.dataset.rtgo); }; });
$("gTplBtn").addEventListener("click", (e) => e.stopPropagation());
// Content › Quizzes: « Results to the students » of each prepared quiz (its column of marks, opened or closed)
window.tplVisCell = function (t) {
  if (typeof GT === "undefined" || !GT.b || GT.cid !== classId) return '<span class="muted">—</span>';
  const col = GT.b.cols.find((c) => c.type === "quiz" && c.quizzes.some((q) => q.title === t.title));
  if (!col) return '<span class="muted">no run finished</span>';
  const v = (GT.raw.visibility || []).find((x) => x.item === col.key), on = !!(v && v.visible);
  return `<button class="btn sm ${on ? "gr" : "sec"}" data-tvis="${esc(col.key)}" data-label="${esc("Result · " + col.title)}" data-on="${on ? 1 : 0}">${on ? "Shown ✓" : "Hidden"}</button>`;
};
$("tplList").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-tvis]"); if (!b) return;
  e.stopPropagation();
  try { await rpc("t_grade_visibility", { p_class: classId, p_item: b.dataset.tvis, p_visible: b.dataset.on !== "1", p_minutes: b.dataset.on === "1" ? null : durMinutes(), p_label: b.dataset.label });
    toast(b.dataset.on === "1" ? "Hidden from the students." : "Shown to the students (Progress tab).", "ok"); await loadGrades(); renderTplList(); }
  catch (err) { toast(err.message, "error"); }
}, true);
window.onTplList = function () {
  const folders = [...new Set(tplList.map((t) => t.folder))].sort();
  const cur = $("tplFolderFilter").value;
  $("qFolders").innerHTML = `<button class="${cur === "" ? "on" : ""}" data-qf="">All the quizzes <span>${tplList.length}</span></button>` +
    folders.map((f) => `<button class="${cur === f && cur !== "" ? "on" : ""}" data-qf="${esc(f)}">${esc(f || "(no folder)")} <span>${tplList.filter((t) => t.folder === f).length}</span></button>`).join("");
  if (typeof GT !== "undefined" && (!GT.raw || GT.cid !== classId) && classId && !SH.tplGradeAsked) { SH.tplGradeAsked = true; loadGrades().then(() => { SH.tplGradeAsked = false; renderTplList(); }); }
};
$("qFolders").addEventListener("click", (e) => {
  const b = e.target.closest("[data-qf]"); if (!b) return;
  const sel = $("tplFolderFilter");
  if (![...sel.options].some((o) => o.value === b.dataset.qf)) sel.insertAdjacentHTML("beforeend", `<option value="${esc(b.dataset.qf)}">${esc(b.dataset.qf)}</option>`);
  sel.value = b.dataset.qf; renderTplList();
});
$("qFolderNew").onclick = () => {
  const f = prompt("Name of the new folder (e.g. S05 or TP3). It appears when a quiz is saved in it:", ""); if (!f) return;
  $("tplNewBtn").click(); setTimeout(() => { $("quizFolder").value = f.trim(); }, 300);
};

// ------------------------------------------------------------------ Messages › Announcements (by group, read by how many)
let an2Pick = new Set(["class"]);
function an2Targets() {
  const groups = grpList(SH.students);
  const items = [["class", classNames[classId] || "This class"]].concat(groups.map(([k, l]) => ["g:" + k.toUpperCase(), l]), [["all", "All my classes"]]);
  $("an2Targets").innerHTML = items.map(([k, l]) => `<button class="pill ${an2Pick.has(k) ? "on" : ""}" data-an2="${esc(k)}">${esc(l)}</button>`).join("");
}
$("an2Targets").addEventListener("click", (e) => {
  const b = e.target.closest("[data-an2]"); if (!b) return;
  const k = b.dataset.an2;
  if (k === "class" || k === "all") an2Pick = new Set([k]);
  else { an2Pick.delete("class"); an2Pick.delete("all"); if (an2Pick.has(k)) an2Pick.delete(k); else an2Pick.add(k); if (!an2Pick.size) an2Pick.add("class"); }
  an2Targets();
});
async function loadAnnounce() {
  if (!classId) return;
  if (!$("an2Until").value) $("an2Until").value = TTV.addDays(new Date().toISOString().slice(0, 10), 7);
  if (!SH.students.length) await shLoadStudents();
  an2Targets();
  let list = [];
  try { list = await rpc("t_announcements", { p_class: classId }); } catch (e) { $("an2List").innerHTML = `<p class="muted">${esc(e.message)}</p>`; return; }
  $("an2List").innerHTML = list.length ? list.map((a) => `<div class="ann ${a.active ? "" : "off"}"><strong>${esc(a.body)}</strong>
      <span class="small-t">${(a.class_ids || []).length ? esc(classNames[classId] || "") : "all my classes"} · ${(a.groups || []).length ? esc(a.groups.map((g) => g.replace(/^TD:/, "TD ").replace(/^TP:/, "TP ")).join(", ")) : "everybody"} ·
        ${a.active ? "until " + fmtWhen(a.until) : "ended"} · read by ${a.read} / ${a.target}${a.notify ? "" : " · not notified"}${a.public ? " · public page" : ""}</span>
      ${a.active ? `<span><button class="btn sec sm" data-an2end="${a.id}">End now</button></span>` : ""}</div>`).join("") : `<p class="muted">No announcement.</p>`;
  $("an2List").querySelectorAll("[data-an2end]").forEach((b) => b.onclick = async () => {
    try { await rpc("t_announce_end", { p_id: Number(b.dataset.an2end) }); toast("Announcement ended.", "ok"); loadAnnounce(); } catch (e) { toast(e.message, "error"); }
  });
}
$("an2Save").onclick = async () => {
  const body = $("an2Body").value.trim(); if (!body) { toast("Write the announcement first.", "error"); return; }
  const until = $("an2Until").value; if (!until) { toast("Choose the last day.", "error"); return; }
  const groups = [...an2Pick].filter((k) => k.startsWith("g:")).map((k) => k.slice(2));
  try {
    await rpc("t_announce_save2", { p_id: null, p_body: body, p_classes: an2Pick.has("all") ? [] : [classId], p_groups: groups,
      p_until: new Date(until + "T23:59:00").toISOString(), p_public: $("an2Public").checked, p_notify: $("an2Notify").checked });
    toast("Announcement published.", "ok"); $("an2Body").value = ""; loadAnnounce();
  } catch (e) { toast(e.message, "error"); }
};

// ------------------------------------------------------------------ Agenda: my week, all my classes
const DAY_NAMES = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"];
async function loadAgenda() {
  if (typeof ttMine === "undefined" || !ttMine || !ttMine.links || !ttMine.links.length) { try { ttMine = await rpc("t_tt_mine"); } catch (e) { ttMine = { links: [], timetables: [] }; } }
  const today = TT.now().date;
  const di = TTV.todayIndex(today);   // 0 = Saturday … 5 = Thursday (6 = Friday)
  const start = TTV.addDays(today, -(di === 6 ? -1 : di) + 7 * SH.agendaWeek);
  const days = DAY_NAMES.map((n, i) => ({ name: n, iso: TTV.addDays(start, i), items: [] }));
  const colors = {}; let k = 0;
  (ttMine.links || []).forEach((l) => {
    const tt = (ttMine.timetables || []).find((t) => t.id === l.tt); if (!tt) return;
    if (colors[l.module] == null) colors[l.module] = k++ % 4;
    days.forEach((d) => TT.occurrencesOn(tt, d.iso, TT.forModule(l.module)).forEach((o) => d.items.push(Object.assign(o, { c: colors[l.module] }))));
  });
  let office = [];
  try { const ms = await rpc("t_myspace"); office = ms.upcoming || []; } catch (e) { /* an assistant has no office hours */ }
  office.forEach((o) => { const d = days.find((x) => x.iso === (o.day || o.date)); if (d) d.items.push({ office: true, starts: o.start, ends: o.end, room: o.place, status: o.cancelled ? "cancelled" : "normal", reason: o.reason }); });
  days.forEach((d) => d.items.sort((a, b) => String(a.starts).localeCompare(String(b.starts))));
  $("agWeek").textContent = `${TT.shortDay(days[0].iso)} → ${TT.shortDay(days[5].iso)}`;
  $("agGrid").innerHTML = days.map((d) => `<div class="day ${d.iso === today ? "today" : ""} ${d.items.length ? "" : "empty"}"><strong style="font-size:14px">${d.name} <span class="muted">${esc(TT.shortDay(d.iso))}</span></strong>
    ${d.items.map((o) => o.office ? `<span class="it off ${o.status === "cancelled" ? "cancel" : ""}">${esc(TTV.hm(o.starts))} · Office hours${o.room ? " · " + esc(o.room) : ""}</span>`
      : `<span class="it c${o.c} ${o.status === "cancelled" || o.status === "moved" ? "cancel" : ""}">${esc(TTV.hm(o.starts))}–${esc(TTV.hm(o.ends))} · <strong>${esc(o.module)}</strong> · ${esc(TTV.kindLabel(o))}${o.room ? " · " + esc(o.room) : ""}${o.status !== "normal" ? " · " + esc(TT.STATUS[o.status] || o.status) : ""}</span>`).join("")}</div>`).join("");
  $("agLegend").textContent = (ttMine.links || []).length ? "One colour per module · dashed: office hours. The timetables of the sections are in My class › Timetable."
    : "No timetable linked to your classes yet: My class › Timetable.";
  $("agOffice").innerHTML = office.length ? office.slice(0, 6).map((o) => `${esc(TT.shortDay(o.day || o.date))} ${esc(o.start || "")}–${esc(o.end || "")}${o.place ? " · " + esc(o.place) : ""}${o.cancelled ? " (cancelled)" : ""}`).join(" · ") : "No office hours in the next two weeks.";
}
$("agPrev").onclick = () => { SH.agendaWeek--; loadAgenda(); };
$("agNext").onclick = () => { SH.agendaWeek++; loadAgenda(); };
$("agOfficeEdit").onclick = () => showTab("myspace");

// ------------------------------------------------------------------ the phone: « More »
function shMore() {
  const items = [["Marks, calculation, visibility", () => { showTab("results"); showRt("marks"); }, true], ["Quizzes", () => showTab("quizzes")],
    ["Question bank", () => showTab("questions")], ["Documents (course, TD, TP)", () => showTab("space")], ["Demos", () => showTab("demos")],
    ["Exercises", () => showTab("exercises")], ["Bonus claims", () => showTab("bonus")],
    ["Announcements", () => showTab("announce")],
    ["Sessions of the class", () => showTab("sessions")], ["Timetable", () => showTab("timetable")], ["My classes and assistants", () => showTab("classes")],
    ["Supervision", () => showTab("supervision"), false, "supervisionTab"], ["Office hours, proposals", () => showTab("myspace"), false, "mySpaceTab"],
    ["Notifications on this phone", () => showTab("notifset")], ["Log out", () => $("logoutBtn").click()]];
  const ok = items.filter((x) => !x[3] || !$(x[3]).classList.contains("hidden"));
  $("moreList").innerHTML = ok.map(([l, , hl], i) => `<button class="btn ${hl ? "hl" : ""}" data-more="${i}">${esc(l)}</button>`).join("");
  $("moreList").querySelectorAll("[data-more]").forEach((b) => b.onclick = () => ok[Number(b.dataset.more)][1]());
}
// the « More » button of the bottom bar opens the list (not the last tab of « Me »)
document.querySelector("#bottomBar [data-more]").onclick = () => showTab("more");

// ------------------------------------------------------------------ what happens when a tab opens, or the class changes
document.addEventListener("cp-tab", (e) => {
  const t = e.detail;
  $("drawer").classList.add("hidden");
  if (t === "announce") loadAnnounce();
  if (t === "agenda") loadAgenda();
  if (t === "notifset") shNotifState();
  if (t === "more") shMore();
  if (t === "students") { $("stuManage").classList.add("hidden"); $("stuCard").classList.remove("hidden"); }
  if (t === "results") { const v = shStore("cp_rt"); document.querySelectorAll("[data-rtgo]").forEach((b) => b.classList.toggle("active", b.dataset.rtgo === (v || "marks"))); }
  shHeader();
});
let shLastClass = null;
setInterval(() => {   // the class changed (select at the top): what this file keeps is reloaded
  if (classId === shLastClass) return;
  shLastClass = classId; SH.grading = null; SH.students = []; SH.stuSel.clear(); SH.liveScope = "session";
  shHeader(); shLoadStudents().then(() => { if (activeTab === "students") shStudents(); if (activeTab === "announce") loadAnnounce(); });
  if (activeTab === "agenda") loadAgenda();
}, 700);
window.addEventListener("resize", () => { if (activeTab === "students") shStudents(); });
setTimeout(shNotifState, 1500);
setTimeout(shHeader, 1200);
