(window.CP_FILES = window.CP_FILES || {})["v333.js"] = "33.3"; // file version, checked by common.js
// v33.3 (teacher console):
// - lab sessions by sub-group: how the sub-groups pass (session dialog), the pass of each quiz, « Next sub-group »,
//   the prepared quiz of the sub-group before proposed again;
// - bonus claims of the students: in the window of the requests and in My class › Bonus (value of one bonus, Grant / Adjust / Refuse);
// - exercises: published from Live or from Course › Exercises, the answers in order of arrival, the first N, « Notify the winners »;
// - the Content space becomes « Course », its pages as tabs (Visible documents, My library, Who reads what, Resources, Quizzes, Bank, Demos, Exercises).

const V3 = { bonus: { value: 0.25, detail: "total", pending: 0, claims: [] }, filter: "pending", exList: [], exEditing: null, exOpen: null, exData: null, exTicks: null, exTimer: null, exFrom: "live" };
const v3fmt = (x) => (x == null || x === "" || isNaN(Number(x)) ? "—" : String(Math.round(Number(x) * 100) / 100));
const v3time = (t) => (t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");
const v3day = (d) => (d ? new Date(d + (String(d).length === 10 ? "T12:00:00" : "")).toLocaleDateString([], { day: "2-digit", month: "short" }) : "");
const v3kind = (k) => ({ course: "Course", td: "TD", tp: "TP" }[k] || k || "");
const v3grp = (kind, g) => (g ? (kind === "td" ? "TD " : "TP ") + g : "whole class");

// ------------------------------------------------------------------ spaces and tabs
SPACE_TABS.class.push("bonus");
SPACE_TABS.content.push("exercises");
Object.assign(SPACE_LABEL, { content: "Course" });
Object.assign(TAB_LABEL, { space: "Documents", exercises: "Exercises", bonus: "Bonus" });
// Course: the pages of Documents are tabs of the space (the inner sub-tabs are not shown any more)
function v3CourseSub() { const b = document.querySelector("#tab-space .subtabs button.on"); return b ? b.dataset.sub : "0"; }
function v3MarkCourseTabs() {
  if (activeTab !== "space") return;
  const sub = v3CourseSub();
  document.querySelectorAll(".course-tabs button[data-tab='space']").forEach((b) => b.classList.toggle("active", b.dataset.sub === sub));
}
document.querySelectorAll(".course-tabs button[data-sub]").forEach((b) => {
  b.onclick = () => {
    showTab("space");
    const inner = document.querySelector(`#tab-space .subtabs button[data-sub="${b.dataset.sub}"]`);
    if (inner) inner.click();
    setTimeout(v3MarkCourseTabs, 0); setTimeout(navTitle, 40);
  };
});
document.addEventListener("cp-tab", (e) => {
  const tab = e.detail;
  if (tab === "space") setTimeout(v3MarkCourseTabs, 0);
  if (tab === "bonus") v3LoadBonus();
  if (tab === "exercises") v3LoadExercises();
});

// ------------------------------------------------------------------ 1. the session dialog: how the sub-groups pass
const V3_PASS_HELP = {
  "": "",
  subgroup: "Choose the sub-group of this session. At the end, « Next sub-group » in Live ends it and starts the same session for the next one (new code, its own attendance and quiz).",
  day: "One session for the whole day: open the attendance for each sub-group in turn. A quiz is seen and answered only by the sub-group checking in when it was launched.",
};
function v3PassUi() {
  const k = $("newSessionKind").value;
  $("newPassWrap").classList.toggle("hidden", k === "course");
  if (k === "course") $("newSessionPass").value = "";
  $("newPassHelp").textContent = V3_PASS_HELP[$("newSessionPass").value] || "";
}
$("newSessionKind").addEventListener("change", v3PassUi);
$("newSessionPass").addEventListener("change", () => {
  const m = $("newSessionPass").value, g = $("newSessionGroup");
  if (m === "subgroup" && !g.value && g.options.length > 1) g.selectedIndex = 1;
  if (m === "day") g.value = "";
  v3PassUi();
});
const v3OpenSessionDialog = openSessionDialog;
openSessionDialog = async function (s) {   // eslint-disable-line no-global-assign
  await v3OpenSessionDialog(s);
  $("newSessionPass").value = s ? s.pass_mode || "" : "";
  v3PassUi();
};
const v3Create = $("createSessionBtn").onclick;
$("createSessionBtn").onclick = async () => {
  const mode = $("newSessionPass").value, before = sessionId;
  if (mode === "subgroup" && !$("newSessionGroup").value) { toast("Choose the sub-group of this session.", "error"); return; }
  await v3Create();
  if (mode && sessionId && sessionId !== before) {
    try { await rpc("t_set_pass_mode", { p_session: sessionId, p_mode: mode }); await loadSessions(); } catch (e) { toast(e.message, "error"); }
  }
  $("newSessionPass").value = ""; v3PassUi();
};
const v3Save = $("saveSessionBtn").onclick;
$("saveSessionBtn").onclick = async () => {
  const s = sessionEditing, mode = $("newSessionPass").value;
  if (s && mode === "subgroup" && !$("newSessionGroup").value) { toast("Choose the sub-group of this session.", "error"); return; }
  if (s && (s.pass_mode || "") !== mode) { try { await rpc("t_set_pass_mode", { p_session: s.id, p_mode: mode }); } catch (e) { toast(e.message, "error"); return; } }
  await v3Save();
};

// ------------------------------------------------------------------ Live: pass line, Next sub-group, proposed quiz, exercises, claims
const v3PrevLive = window.onLiveRefresh;
window.onLiveRefresh = function () { if (v3PrevLive) v3PrevLive(); v3Live(); };
function v3Live() {
  const L = live, has = !!(sessionId && L && L.session);
  $("lvNextSg").classList.toggle("hidden", !(has && L.session.pass_mode === "subgroup" && !L.session.ended_at));
  $("lvPassLine").classList.toggle("hidden", !(has && L.session.pass_mode));
  v3RenderClaims();
  if (!has) { $("lqSuggest").classList.add("hidden"); $("lvExList").classList.add("hidden"); return; }
  const s = L.session;
  if (s.pass_mode === "subgroup") {
    $("lvPassLine").innerHTML = `<span class="chip info">One session per sub-group</span> this one: <strong>${esc(v3grp(s.kind, s.group))}</strong>` +
      (s.next_group ? ` · next: <strong>${esc(s.next_group)}</strong>` : " · last sub-group");
  } else if (s.pass_mode === "day") {
    const run = L.run && s.attendance_open ? L.run.group : null;
    $("lvPassLine").innerHTML = `<span class="chip info">One session for the day</span> ` + (run ? `pass now: <strong>${esc(v3grp(s.kind, run))}</strong>` : "open the attendance for the next sub-group") +
      ` · <span class="muted">each quiz only for its pass</span>`;
  }
  // the pass of the quiz on top of the quiz card
  if (L.quiz && L.quiz.run_group) $("lqChip").textContent = ($("lqChip").textContent ? $("lqChip").textContent + " · " : "") + "pass " + L.quiz.run_group;
  // the prepared quiz of the sub-group before
  const noQuiz = ![...$("quizSelect").options].some((o) => o.value);
  const tpl = s.suggest_template && typeof tplList !== "undefined" ? tplList.find((t) => t.id === s.suggest_template) : null;
  $("lqSuggest").classList.toggle("hidden", !(tpl && noQuiz && !s.ended_at));
  if (tpl && noQuiz) {
    const key = s.id + tpl.id;
    if ($("lqSuggest").dataset.key !== key) {
      $("lqSuggest").dataset.key = key;
      $("lqSuggest").innerHTML = `<span>Proposed (run by the sub-group before): <strong>${esc(tpl.title)}</strong></span>
        <span class="row" style="gap:6px"><button class="btn gr sm" id="lqSugRun">Run it</button><button class="btn sec sm" id="lqSugOther">Another quiz</button></span>`;
      $("lqSugRun").onclick = () => { $("tplSelect").value = tpl.id; $("launchBtn").click(); };
      $("lqSugOther").onclick = () => { openDlg("dlgQuiz"); setTimeout(() => $("tplSelect").focus(), 50); };
    }
  }
  // the exercises of this session
  const ex = L.exercises || [];
  $("lvExList").classList.toggle("hidden", !ex.length);
  const html = ex.map((e) => `<div class="lv-ex-row"><span class="grow"><strong>${esc(e.title)}</strong> <span class="chip ${e.open ? "ok" : "none"}">${e.open ? "open" : e.opened_at ? "closed" : "not open"}</span>
      <span class="muted small-t">${e.answers} answer(s) · ${e.right} right${e.unmarked && e.atype === "text" ? ` · ${e.unmarked} to mark` : ""}${e.winners ? ` · ${e.winners} winner(s)` : ""}</span></span>
      <button class="btn sec sm" data-exans="${e.id}">Answers</button></div>`).join("");
  if ($("lvExList").dataset.html !== html) { $("lvExList").dataset.html = html; $("lvExList").innerHTML = `<div class="small-t muted" style="margin:6px 0 2px">Exercises of this session</div>` + html; }
}
$("lvExList").addEventListener("click", (e) => { const b = e.target.closest("[data-exans]"); if (b) v3OpenAnswers(b.dataset.exans); });
$("lqExBtn").onclick = () => { if (!sessionId) { toast("Choose or create a session first.", "error"); return; } v3OpenExercise(null, "live"); };

// « Next sub-group »
$("lvNextSg").onclick = () => {
  const s = live && live.session; if (!s) return;
  const groups = (s.kind === "td" ? classGroups.td : classGroups.tp).filter((g) => g !== s.group);
  if (!groups.length) { toast("No other sub-group in this class (My class › Students: the TP sub-groups).", "error"); return; }
  $("nsGroup").innerHTML = groups.map((g) => `<option ${g === s.next_group ? "selected" : ""}>${esc(g)}</option>`).join("");
  const cur = allSessions.find((x) => x.id === s.id) || {};
  const dur = cur.time && cur.end_time ? ` The next time slot starts at ${cur.end_time}.` : "";
  $("nsText").innerHTML = `Ends « ${esc(s.title)} · ${esc(v3grp(s.kind, s.group))} » (its attendance and its quiz) and creates the same session for the next sub-group: same title, unit, remark and documents, a new code.${dur}` +
    (live.quiz || [...$("quizSelect").options].some((o) => o.value) ? " The same prepared quiz will be proposed; you can choose another one." : "");
  openDlg("dlgNextSg");
};
$("nsGo").onclick = async () => {
  $("nsGo").disabled = true;
  try {
    const r = await rpc("t_next_subgroup", { p_session: sessionId, p_group: $("nsGroup").value, p_open: $("nsOpen").checked });
    $("dlgNextSg").classList.add("hidden");
    sessionId = r.id; try { localStorage.setItem("cp_session", r.id); } catch (e) { /* private window */ }
    await loadSessions();
    toast(`Session of ${r.group} started · code ${r.code}${r.start ? " · " + r.start + (r.end ? "–" + r.end : "") : ""}.`, "ok");
  } catch (e) { toast(e.code === "NO_NEXT_GROUP" ? "This was the last sub-group." : e.message, "error"); }
  $("nsGo").disabled = false;
};

// ------------------------------------------------------------------ 2. bonus claims
const v3PrevReqCount = shReqCount;
shReqCount = function () { return v3PrevReqCount() + v3PendingClaims().length; };   // eslint-disable-line no-global-assign
function v3PendingClaims() { return live && live.bonus_claims ? live.bonus_claims : V3.bonus.claims.filter((k) => k.status === "pending"); }
function v3ClaimHtml(k, inPanel) {
  const what = `${k.n} bonus${k.n > 1 ? "es" : ""} (${v3fmt(k.proposed)} pt) · ${esc(k.unit || v3kind(k.kind))} · ${esc(k.title)} · ${v3day(k.date)}`;
  const acts = k.status === "pending" || !inPanel ? `<div class="row"><button class="btn gr sm" data-claim="${k.id}" data-act="grant">Grant +${v3fmt(k.proposed)}</button>
      <button class="btn sec sm" data-claim="${k.id}" data-act="adjust">Adjust…</button><button class="btn sec sm" data-claim="${k.id}" data-act="refuse">Refuse</button></div>` : "";
  return `<div class="req claim ${k.status}"><div><button class="lnk" data-profile="${k.student_id}">${esc(k.name)}</button> <span class="what">· claims ${what}</span>
      ${k.note ? `<div class="claim-note">« ${esc(k.note)} »</div>` : ""}
      ${k.status !== "pending" ? `<div class="small-t"><span class="chip ${k.status === "granted" ? "ok" : "abs"}">${k.status === "granted" ? "granted +" + v3fmt(k.points) : "refused"}</span> <span class="muted">${esc(k.decided_by || "")}</span></div>` : ""}</div>${acts}</div>`;
}
function v3RenderClaims() {
  const list = v3PendingClaims(), html = list.length ? `<div class="small-t muted" style="margin:2px 0 6px">Bonus claims</div>` + list.map((k) => v3ClaimHtml(k, true)).join("") : "";
  if ($("reqBonus").dataset.html !== html) { $("reqBonus").dataset.html = html; $("reqBonus").innerHTML = html; }
  const n = list.length;
  $("bonusBadge").textContent = n; $("bonusBadge").classList.toggle("hidden", !n);
}
async function v3Decide(id, act) {
  const k = V3.bonus.claims.concat((live && live.bonus_claims) || []).find((x) => String(x.id) === String(id));
  let pts = null;
  if (act === "adjust") {
    const v = prompt(`Points given to ${k ? k.name : "this student"} (asked: ${k ? v3fmt(k.proposed) : "?"}):`, k ? v3fmt(k.points || k.proposed) : "");
    if (v === null) return;
    pts = Number(String(v).replace(",", "."));
    if (!(pts > 0)) { toast("Type a number of points above 0.", "error"); return; }
  }
  try {
    await rpc("t_bonus_decide", { p_id: Number(id), p_action: act, p_points: pts });
    toast(act === "refuse" ? "Claim refused." : "Bonus given: the student sees it in his Progress.", "ok");
  } catch (e) { toast(e.message, "error"); }
  if (sessionId) refreshLive();
  v3LoadBonus();
}
document.addEventListener("click", (e) => { const b = e.target.closest("[data-claim]"); if (b) v3Decide(b.dataset.claim, b.dataset.act); });

async function v3LoadBonus() {
  if (!classId) return;
  const cid = classId;
  let r; try { r = await rpc("t_bonus_claims", { p_class: cid, p_status: null }); } catch (e) { return; }
  if (cid !== classId) return;
  V3.bonus = { value: r.value, detail: r.detail, pending: r.pending, claims: r.claims || [] };
  if (document.activeElement !== $("bonusValue")) $("bonusValue").value = v3fmt(r.value);
  if (document.activeElement !== $("bonusDetail")) $("bonusDetail").value = r.detail;
  $("bonusPending").textContent = r.pending;
  const list = V3.bonus.claims.filter((k) => !V3.filter || k.status === V3.filter);
  $("bonusList").innerHTML = list.length ? `<div class="req-list">${list.map((k) => v3ClaimHtml(k, false)).join("")}</div>`
    : `<p class="muted">${V3.filter === "pending" ? "No claim waiting." : "No claim."}</p>`;
  $("bonusVisNote").innerHTML = `What the students see is opened in <button class="lnk" id="bonusToVis">Results › What the students see</button> (line « Bonus »).`;
  $("bonusToVis").onclick = () => { showTab("results"); if (typeof showRt === "function") setTimeout(() => showRt("vis"), 300); };
  v3RenderClaims();
  if (typeof renderVis === "function" && $("gVisRows") && typeof GT !== "undefined" && GT.b) renderVis();
}
$("bonusFilters").addEventListener("click", (e) => {
  const b = e.target.closest("[data-bf]"); if (!b) return;
  V3.filter = b.dataset.bf;
  $("bonusFilters").querySelectorAll("[data-bf]").forEach((x) => x.classList.toggle("on", x === b));
  v3LoadBonus();
});
$("bonusSaveBtn").onclick = async () => {
  try {
    const v = Number(String($("bonusValue").value).replace(",", "."));
    await rpc("t_bonus_settings", { p_class: classId, p_value: v > 0 ? v : null, p_detail: $("bonusDetail").value });
    toast("Saved.", "ok"); v3LoadBonus();
  } catch (e) { toast(e.code === "BAD_POINTS" ? "The value of one bonus is between 0.05 and 5 points." : e.message, "error"); }
};
// the line « Bonus » of « What the students see » chooses the detail too
window.v3BonusDetail = async (d) => {
  try { await rpc("t_bonus_settings", { p_class: classId, p_value: null, p_detail: d }); V3.bonus.detail = d; toast("The students see: " + ({ total: "the total", category: "the total by category", session: "the detail of each session" }[d]) + ".", "ok"); }
  catch (e) { toast(e.message, "error"); }
};
// the claims also arrive when no session is open (every 30 s), the class changes
setInterval(() => { if (classId && document.visibilityState === "visible") v3LoadBonus(); }, 30000);
$("classSelect").addEventListener("change", () => setTimeout(v3LoadBonus, 600));
setTimeout(v3LoadBonus, 2500);

// ------------------------------------------------------------------ 3. exercises
function v3GroupOptions(cur) {
  const td = classGroups.td.map((g) => ["TD:" + g, "TD " + g]), tp = classGroups.tp.map((g) => ["TP:" + g, "TP " + g]);
  return `<option value="">Whole class</option>` + td.concat(tp).map(([v, l]) => `<option value="${esc(v)}" ${v === cur ? "selected" : ""}>${esc(l)}</option>`).join("");
}
function v3ExUi() {
  const t = $("exType").value, m = $("exMode").value;
  document.querySelectorAll("#dlgExercise .ex-num").forEach((x) => x.classList.toggle("hidden", t !== "number"));
  document.querySelectorAll("#dlgExercise .ex-choice").forEach((x) => x.classList.toggle("hidden", t !== "choice"));
  document.querySelectorAll("#dlgExercise .ex-after").forEach((x) => x.classList.toggle("hidden", m !== "after"));
  $("exCloseAt").classList.toggle("hidden", $("exClose").value !== "at");
  $("exNote").textContent = m === "session" ? (sessionId && live && live.session ? "Session: " + live.session.title + " · only the students checked in answer." : "Choose a session in Live first, or open it after the session.")
    : "No check-in needed: the students of the class (or of the group) answer from their phone, in « To do ».";
}
["exType", "exMode", "exClose"].forEach((id) => $(id).addEventListener("change", v3ExUi));
function v3OpenExercise(e, from) {
  V3.exEditing = e || null; V3.exFrom = from;
  $("exDlgTitle").textContent = e ? "Edit the exercise" : "New exercise";
  $("exTitle").value = e ? e.title : ""; $("exBody").value = e ? e.body : "";
  $("exType").value = e ? e.atype : "number";
  $("exNum").value = e && e.answer_num != null ? e.answer_num : ""; $("exTol").value = e ? v3fmt(e.tolerance) : "0"; $("exTolKind").value = e ? e.tol_kind : "abs";
  $("exOptions").value = e && e.atype === "choice" ? (e.options || []).map((o, i) => (i === e.answer_choice ? "*" : "") + o).join("\n") : "";
  $("exMode").value = e ? e.open_mode : (from === "live" ? "session" : "after");
  $("exGroup").innerHTML = v3GroupOptions(e ? e.group : "");
  $("exClose").value = ""; $("exCloseAt").value = "";
  if (e && e.closes_at) { $("exClose").value = "at"; const d = new Date(e.closes_at); $("exCloseAt").value = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
  $("exN").value = e ? e.winners_n : 3; $("exWin").value = e ? e.winners_mode : "precheck"; $("exBonus").value = e ? String(e.bonus_n) : "1";
  $("exPublish").textContent = e && e.opened_at ? "Save" : "Publish now";
  $("exSave").classList.toggle("hidden", !!(e && e.opened_at));
  v3ExUi();
  openDlg("dlgExercise");
  setTimeout(() => $("exTitle").focus(), 60);
}
function v3ExData(open) {
  const t = $("exType").value, d = { title: $("exTitle").value.trim(), body: $("exBody").value, atype: t, open_mode: $("exMode").value,
    winners_n: Number($("exN").value) || 0, winners_mode: $("exWin").value, bonus_n: Number($("exBonus").value), open };
  if (t === "number") { d.answer_num = Number(String($("exNum").value).replace(",", ".").replace(/\s/g, "")); d.tolerance = Number(String($("exTol").value).replace(",", ".")) || 0; d.tol_kind = $("exTolKind").value;
    if ($("exNum").value.trim() === "" || isNaN(d.answer_num)) throw new Error("Type the expected value."); }
  if (t === "choice") {
    const lines = $("exOptions").value.split("\n").map((x) => x.trim()).filter(Boolean);
    d.options = lines.map((x) => x.replace(/^\*\s*/, "")); d.answer_choice = lines.findIndex((x) => x.startsWith("*"));
    if (d.options.length < 2 || d.answer_choice < 0) throw new Error("Two options at least, the right one starting with *.");
  }
  if (d.open_mode === "after") d.group = $("exGroup").value;
  const keepSession = V3.exEditing && V3.exEditing.session_id;
  d.session_id = keepSession || (sessionId && (V3.exFrom === "live" || d.open_mode === "session") ? sessionId : null);
  if (d.open_mode === "session" && !d.session_id) throw new Error("Choose a session in Live first (or « Open also after »).");
  const c = $("exClose").value;
  if (c === "at") { if ($("exCloseAt").value) d.closes_at = new Date($("exCloseAt").value).toISOString(); }
  else if (c) d.closes_at = new Date(Date.now() + Number(c) * 60000).toISOString();
  return d;
}
async function v3SaveExercise(open) {
  let d; try { d = v3ExData(open); } catch (e) { toast(e.message, "error"); return; }
  if (!d.title) { toast("Give the exercise a title (e.g. Exercise 2).", "error"); return; }
  try {
    const e = await rpc("t_exercise_save", { p_class: classId, p_id: V3.exEditing ? V3.exEditing.id : null, p_data: d });
    $("dlgExercise").classList.add("hidden");
    toast(open && !(V3.exEditing && V3.exEditing.opened_at) ? "Exercise open: the students answer from their phone." : "Exercise saved.", "ok");
    if (sessionId) refreshLive();
    if (activeTab === "exercises") v3LoadExercises();
    if (V3.exOpen === e.id) v3LoadAnswers();
  } catch (e) { toast(e.message, "error"); }
}
$("exPublish").onclick = () => v3SaveExercise(true);
$("exSave").onclick = () => v3SaveExercise(false);
$("exNewBtn").onclick = () => v3OpenExercise(null, "course");

async function v3LoadExercises() {
  if (!classId) return;
  try { V3.exList = await rpc("t_exercises", { p_class: classId }); } catch (e) { V3.exList = []; }
  const tl = { number: "number", choice: "choice", text: "text" };
  $("exList").innerHTML = V3.exList.length ? `<table class="v-table"><thead><tr><th>Exercise</th><th>Answer</th><th>Who</th><th>State</th><th>Answers</th><th>Winners</th><th></th></tr></thead><tbody>` +
    V3.exList.map((e) => `<tr><td><strong>${esc(e.title)}</strong>${e.session_title ? `<span class="muted small-t" style="display:block">${esc(e.session_title)} · ${v3day(e.session_date)}</span>` : ""}</td>
      <td>${tl[e.atype]}</td><td>${e.open_mode === "session" ? "checked-in students" : esc(e.group ? e.group.replace(":", " ") : "whole class") + " · after"}</td>
      <td><span class="chip ${e.open ? "ok" : "none"}">${e.open ? "open" : e.opened_at ? "closed" : "not open"}</span>${e.closes_at && e.open ? `<span class="muted small-t"> until ${v3time(e.closes_at).slice(0, 5)}</span>` : ""}</td>
      <td>${e.answers} · ${e.right} right${e.unmarked && e.atype === "text" ? ` · <strong>${e.unmarked} to mark</strong>` : ""}</td><td>${e.winners}/${e.winners_n} · +${e.bonus_n}${e.notified_at ? " · told" : ""}</td>
      <td style="white-space:nowrap"><button class="small green" data-exans="${e.id}">Answers</button> <button class="small secondary" data-exedit="${e.id}">Edit</button> <button class="small red" data-exdel="${e.id}">Delete</button></td></tr>`).join("") + `</tbody></table>`
    : `<p class="muted">No exercise yet. In Live, « ＋ Exercise » under the quiz; or « ＋ New exercise » here.</p>`;
  if (window.matchMedia("(max-width: 760px)").matches && V3.exList.length) {
    $("exList").innerHTML = `<div class="ses-cards">` + V3.exList.map((e) => `<div class="ses-card"><div class="l1"><strong>${esc(e.title)}</strong><span class="chip ${e.open ? "ok" : "none"}">${e.open ? "open" : e.opened_at ? "closed" : "not open"}</span></div>
      <span class="small-t">${e.answers} answer(s) · ${e.right} right · ${e.winners}/${e.winners_n} winner(s)</span>
      <div class="acts"><button class="small green" data-exans="${e.id}">Answers</button><button class="small secondary" data-exedit="${e.id}">Edit</button><button class="small red" data-exdel="${e.id}">Delete</button></div></div>`).join("") + `</div>`;
  }
}
$("exList").addEventListener("click", async (ev) => {
  const a = ev.target.closest("[data-exans]"), ed = ev.target.closest("[data-exedit]"), del = ev.target.closest("[data-exdel]");
  if (a) v3OpenAnswers(a.dataset.exans);
  if (ed) v3OpenExercise(V3.exList.find((x) => x.id === ed.dataset.exedit), "course");
  if (del) {
    const e = V3.exList.find((x) => x.id === del.dataset.exdel);
    if (!confirm(`Delete the exercise « ${e.title} » and its ${e.answers} answer(s)?`)) return;
    try { await rpc("t_exercise_state", { p_id: e.id, p_action: "delete" }); toast("Exercise deleted.", "ok"); v3LoadExercises(); }
    catch (err) { toast(err.code === "HAS_WINNERS" ? "Some students won a bonus with it: take the winners off first (Answers)." : err.message, "error"); }
  }
});

// the answers of one exercise, in their order of arrival
async function v3OpenAnswers(id) {
  V3.exOpen = id; V3.exTicks = null;
  openDlg("dlgExAnswers");
  await v3LoadAnswers();
  clearInterval(V3.exTimer);
  V3.exTimer = setInterval(() => { if ($("dlgExAnswers").classList.contains("hidden")) { clearInterval(V3.exTimer); V3.exOpen = null; return; } v3LoadAnswers(true); }, 3000);
}
async function v3LoadAnswers(quiet) {
  if (!V3.exOpen) return;
  let r; try { r = await rpc("t_exercise_answers", { p_id: V3.exOpen }); } catch (e) { if (!quiet) toast(e.message, "error"); return; }
  V3.exData = r;
  const e = r.exercise, ans = r.answers || [];
  if (!V3.exTicks) {   // what is ticked when the window opens
    const winners = ans.filter((a) => a.winner).map((a) => a.student_id);
    V3.exTicks = new Set(winners.length || e.winners_mode !== "precheck" ? winners : r.first_right);
  }
  $("eaTitle").textContent = e.title;
  $("eaState").textContent = e.open ? "open" : e.opened_at ? "closed" : "not open";
  $("eaState").className = "chip " + (e.open ? "ok" : "none");
  $("eaOpen").classList.toggle("hidden", e.open); $("eaClose").classList.toggle("hidden", !e.open);
  const expected = e.atype === "number" ? `expected ${v3fmt(e.answer_num)}${Number(e.tolerance) ? " ± " + v3fmt(e.tolerance) + (e.tol_kind === "pct" ? " %" : "") : ""}`
    : e.atype === "choice" ? `right option: ${esc((e.options || [])[e.answer_choice] || "")}` : "free text: mark each answer";
  const right = ans.filter((a) => a.ok).length;
  $("eaInfo").innerHTML = `${ans.length} answer(s) · <strong>${right} right</strong> · ${expected} · the first <strong>${e.winners_n}</strong> win +${e.bonus_n} bonus` +
    ` · winners: ${{ precheck: "pre-ticked, then validated", manual: "ticked by you", auto: "automatic" }[e.winners_mode]}` +
    ` · ticked: <strong id="eaTicked">${V3.exTicks.size}</strong> / ${e.winners_n}${e.notified_at ? " · winners told " + v3time(e.notified_at).slice(0, 5) : ""}`;
  const html = ans.length ? `<table class="v-table ea-table"><thead><tr><th>#</th><th>Time</th><th>Student</th><th>Group</th><th>Answer</th><th>Right?</th><th>Winner</th></tr></thead><tbody>` +
    ans.map((a) => `<tr class="${a.ok ? "ok" : a.ok === false ? "ko" : ""}"><td>${a.rank}</td><td class="mono">${v3time(a.at)}</td>
      <td><button class="lnk" data-profile="${a.student_id}">${esc(a.name)}</button></td><td>${esc([a.td_group, a.tp_group].filter(Boolean).join(" · "))}</td>
      <td>${esc(e.atype === "number" ? v3fmt(a.number) : e.atype === "choice" ? a.choice_text || "" : a.text || "")}</td>
      <td style="white-space:nowrap"><button class="btn sm ${a.ok ? "gr" : "sec"}" data-eaok="${a.student_id}" data-v="1" title="Right">✓</button><button class="btn sm ${a.ok === false ? "red" : "sec"}" data-eaok="${a.student_id}" data-v="0" title="Wrong">✗</button></td>
      <td><input type="checkbox" data-eawin="${a.student_id}" ${V3.exTicks.has(a.student_id) ? "checked" : ""} aria-label="Winner: ${esc(a.name)}">${a.winner ? ' <span class="chip ok">+' + e.bonus_n + "</span>" : ""}</td></tr>`).join("") + `</tbody></table>`
    : `<p class="muted">No answer yet${e.open ? ": they arrive here as they come." : "."}</p>`;
  if ($("eaTable").dataset.html !== html) { $("eaTable").dataset.html = html; $("eaTable").innerHTML = html; }
}
$("eaTable").addEventListener("change", (ev) => {
  const c = ev.target.closest("[data-eawin]"); if (!c) return;
  if (c.checked) V3.exTicks.add(c.dataset.eawin); else V3.exTicks.delete(c.dataset.eawin);
  if ($("eaTicked")) $("eaTicked").textContent = V3.exTicks.size;
  $("eaTable").dataset.html = "";
});
$("eaTable").addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-eaok]"); if (!b) return;
  try { await rpc("t_exercise_mark", { p_id: V3.exOpen, p_student: b.dataset.eaok, p_ok: b.dataset.v === "1" }); } catch (e) { toast(e.message, "error"); }
  v3LoadAnswers(true);
});
$("eaWinners").onclick = async () => {
  try {
    const r = await rpc("t_exercise_winners", { p_id: V3.exOpen, p_students: [...V3.exTicks] });
    toast(`${r.winners} winner(s): their bonus is added. « Notify the winners » sends them a message.`, "ok");
    V3.exTicks = null; v3LoadAnswers(); if (sessionId) refreshLive();
  } catch (e) { toast(e.message, "error"); }
};
$("eaNotify").onclick = async () => {
  try { const r = await rpc("t_exercise_notify", { p_id: V3.exOpen, p_body: null }); toast(`Message sent to ${r.recipients} winner(s).`, "ok"); v3LoadAnswers(true); }
  catch (e) { toast(e.code === "NO_WINNER" ? "Validate the winners first." : e.message, "error"); }
};
$("eaOpen").onclick = async () => { try { await rpc("t_exercise_state", { p_id: V3.exOpen, p_action: "open" }); v3LoadAnswers(); if (sessionId) refreshLive(); } catch (e) { toast(e.message, "error"); } };
$("eaClose").onclick = async () => { try { await rpc("t_exercise_state", { p_id: V3.exOpen, p_action: "close" }); toast("Exercise closed: no more answers.", "ok"); v3LoadAnswers(); if (sessionId) refreshLive(); } catch (e) { toast(e.message, "error"); } };
$("eaEdit").onclick = () => { const e = V3.exData && V3.exData.exercise; if (e) v3OpenExercise(e, e.session_id ? "live" : "course"); };

// the new windows follow the rules of the others (one at a time, Escape, full screen on a phone)
[{ sel: "#dlgNextSg", title: "Next sub-group" }, { sel: "#dlgExercise", title: "Exercise" }, { sel: "#dlgExAnswers", title: "Answers" }].forEach((p) => {
  NAV_PANELS.push(p); const el = document.querySelector(p.sel); if (el) navObserver.observe(el, { attributes: true, attributeFilter: ["class"] });
});
// on a phone the row of tabs scrolls: the tab shown is brought into view
document.addEventListener("cp-tab", () => setTimeout(() => {
  document.querySelectorAll(".tabbar button.active").forEach((b) => { if (b.offsetParent) b.scrollIntoView({ block: "nearest", inline: "nearest" }); });
}, 60));
