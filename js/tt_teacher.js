// ClassPulse v32: the timetable in the teacher console (tab 🗓 Timetable, the « start this session » bar of Live).
(window.CP_FILES = window.CP_FILES || {})["tt_teacher.js"] = "32.1"; // file version, checked by common.js

let ttList = [], ttCur = null, ttMine = { links: [], timetables: [] };
const ttState = { sel: "", view: "", week: null, day: null, weekAuto: null };
const MINE = "__mine";

// ------------------------------------------------------------------ loading
async function ttInit() {
  try { ttMine = await rpc("t_tt_mine"); } catch (e) { ttMine = { links: [], timetables: [] }; }
  ttNowBar();
}
async function loadTimetableTab() {
  try { [ttList, ttMine] = await Promise.all([rpc("t_tt_list"), rpc("t_tt_mine")]); } catch (e) { toast(e.message, "error"); return; }
  const opts = [];
  if (ttMine.links.length) opts.push(`<option value="${MINE}">⭐ My week (my modules, all my sections)</option>`);
  ttList.forEach((t) => opts.push(`<option value="${t.id}">${esc(t.title)}${t.mine ? "" : " (assistant)"} · ${t.slots} slots</option>`));
  $("ttSelect").innerHTML = opts.join("") || `<option value="">— no timetable yet: import one —</option>`;
  if (!ttState.sel || ![...$("ttSelect").options].some((o) => o.value === ttState.sel)) ttState.sel = $("ttSelect").options[0] ? $("ttSelect").value : "";
  $("ttSelect").value = ttState.sel;
  await ttOpen(ttState.sel, true);
  ttRenderLinks();
  ttNowBar();
}
$("ttSelect").onchange = () => ttOpen($("ttSelect").value, true);

async function ttOpen(sel, resetView) {
  ttState.sel = sel;
  if (resetView) { ttState.view = ""; ttState.day = null; ttState.weekAuto = null; }
  if (!sel) { ttCur = null; $("ttGrid").innerHTML = `<p class="muted">No timetable yet. « ⬆ Import » reads the Excel template of DeptDesk (or a file exported by DeptDesk); « ＋ New » starts an empty one.</p>`;
    $("ttViewSel").innerHTML = ""; $("ttUpcoming").innerHTML = ""; $("ttChanges").innerHTML = ""; $("ttSettingsCard").classList.add("hidden"); $("ttWeekNote").textContent = ""; return; }
  if (sel === MINE) ttCur = null;
  else { try { ttCur = await rpc("t_tt_get", { p_id: sel }); } catch (e) { toast(e.message, "error"); return; } }
  ttFillViews();
  ttDraw();
  ttRenderSettings();
}

// ------------------------------------------------------------------ what is shown
// The timetable(s) behind the current choice, each with the filter of the view.
function ttSources() {
  if (ttState.sel === MINE) {
    return ttMine.links.map((l) => ({ tt: ttMine.timetables.find((t) => t.id === l.tt), filter: TT.forModule(l.module), link: l })).filter((x) => x.tt);
  }
  if (!ttCur) return [];
  const v = ttState.view;
  let f = null;
  if (v.startsWith("module:")) f = TT.forModule(v.slice(7));
  else if (v.startsWith("teacher:")) f = (s) => s.teacher === v.slice(8);
  else if (v.startsWith("room:")) f = (s) => s.room === v.slice(5);
  else if (v) f = (s) => !s.target || s.target === v || v.split("+").includes(s.target);
  return [{ tt: ttCur, filter: f }];
}
function ttMode() {
  if (ttState.sel === MINE) return "other";
  const v = ttState.view;
  return v.startsWith("module:") || v.startsWith("teacher:") || v.startsWith("room:") ? "other" : v ? "group" : "section";
}
function ttViewSlots() {
  const out = [];
  ttSources().forEach(({ tt, filter }) => (tt.slots || []).filter((s) => !filter || filter(s))
    .forEach((s) => out.push(Object.assign({}, s, { section: tt.section || tt.level_short || tt.title }))));
  return out;
}
function ttFillViews() {
  const sel = $("ttViewSel");
  if (ttState.sel === MINE || !ttCur) { sel.innerHTML = `<option value="">My modules</option>`; sel.disabled = true; return; }
  sel.disabled = false;
  const slots = ttCur.slots || [], uniq = (a) => [...new Set(a.filter(Boolean))].sort((x, y) => x.localeCompare(y, undefined, { numeric: true }));
  const groups = (re) => uniq(slots.map((s) => s.target).concat(ttCur.td_groups || [], ttCur.tp_groups || []).filter((t) => re.test(t)));
  const mods = uniq(slots.map((s) => s.module));
  const opts = [["", "Whole section: everything"]]
    .concat(groups(/^G\d+$/).map((g) => [g, "TD group " + g]), groups(/^SG\d+$/).map((g) => [g, "TP sub-group " + g]),
      mods.map((m) => ["module:" + m, "Module: " + m + ((slots.find((s) => s.module === m) || {}).module_name ? " — " + slots.find((s) => s.module === m).module_name : "")]),
      uniq(slots.map((s) => s.teacher)).map((t) => ["teacher:" + t, "Teacher: " + t]), uniq(slots.map((s) => s.room)).map((r) => ["room:" + r, "Room: " + r]));
  sel.innerHTML = opts.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  sel.value = ttState.view;
}
$("ttViewSel").onchange = () => { ttState.view = $("ttViewSel").value; ttState.day = null; ttDraw(); };
$("ttStudents").onchange = () => ttDraw();

function ttDraw() {
  const now = TT.now(), src = ttSources();
  if (!src.length) { $("ttGrid").innerHTML = `<p class="muted">Nothing to show: link a class to a timetable (« My classes and their timetable »).</p>`; ttUpcoming(); return; }
  // the week shown first: from the first timetable that knows its weeks
  if (!ttState.weekAuto) {
    const wc = src.map((x) => TT.weekChoice(x.tt, now.date)).find((w) => w.parity && !w.unknown) || src.map((x) => TT.weekChoice(x.tt, now.date)).find((w) => w.parity) || {};
    ttState.weekAuto = wc; ttState.week = wc.parity || null;
  }
  const wa = ttState.weekAuto;
  $("ttWeekNote").textContent = wa.unknown ? "The semester dates are not set: weeks A and B cannot be told apart (Settings below)."
    : wa.parity ? `Week ${wa.parity} = ${wa.label}${wa.no ? " (teaching week " + wa.no + ")" : ""}.` : "";
  const canEdit = !!(ttCur && ttCur.mine && ttState.sel !== MINE && !$("ttStudents").checked);
  TTV.render($("ttGrid"), { slots: ttViewSlots(), week: ttState.week, day: ttState.day, mode: ttMode(), students: $("ttStudents").checked,
    phone: window.matchMedia("(max-width: 640px)").matches, today: now.date, nowMin: now.min, showSection: ttState.sel === MINE,
    weekLabel: ttState.week === wa.parity && !wa.unknown ? wa.label : "", canEdit,
    onEdit: (s) => ttSlotDialog(s), onAdd: (d) => ttSlotDialog({ day: d }),
    onRoom: (s) => ttSlotInfo(s),
    onChange: (c) => { ttState.week = c.week; ttState.day = c.day; ttDraw(); } });
  ttUpcoming();
}

function ttUpcoming() {
  const now = TT.now(), src = ttSources();
  const occ = [];
  src.forEach(({ tt, filter }) => TT.upcoming(tt, filter, now.date, 14).forEach((o) => occ.push(Object.assign(o, { section: tt.section || tt.level_short }))));
  occ.sort((a, b) => (a.date + a.starts).localeCompare(b.date + b.starts));
  $("ttUpcoming").innerHTML = occ.length ? occ.slice(0, 60).map((o) => TT.occHtml(o, true)).join("") : `<p class="muted">No session in the next 14 days.</p>`;
  const mine = ttCur && ttCur.mine && ttState.sel !== MINE;
  const ex = ttCur && ttState.sel !== MINE ? (ttCur.exceptions || []).slice().sort((a, b) => b.day.localeCompare(a.day)) : [];
  $("ttChanges").innerHTML = ttState.sel === MINE ? `<p class="muted">Choose one timetable to see and change its list of changes.</p>`
    : ex.length ? ex.map((e) => {
      const s = (ttCur.slots || []).find((x) => x.id === e.slot) || e;
      const what = `${esc(s.module)} · ${esc(TTV.kindLabel(Object.assign({}, s, { target: s.target || e.target })))} ${esc(TTV.hm(e.starts || s.starts))}`;
      const extra = e.action === "moved" ? ` → ${esc(TT.shortDay(e.to_day || e.day))} ${esc(TTV.hm(e.to_start))}${e.to_room ? ", " + esc(e.to_room) : ""}` : e.action === "added" ? `–${esc(TTV.hm(e.ends))}${e.room ? ", " + esc(e.room) : ""}` : "";
      return `<div class="tt-occ ${e.action}"><span class="d">${esc(TT.shortDay(e.day))}</span><span class="w">${what}${extra}</span>
        <span class="badge ${e.action === "cancelled" ? "no" : "orange"}">${esc(e.action === "added" ? "extra" : e.action)}</span>${e.reason ? `<span class="muted">${esc(e.reason)}</span>` : ""}
        ${mine ? `<button class="small red" data-ttexdel="${e.id}" title="Remove this change">✕</button>` : ""}</div>`; }).join("")
    : `<p class="muted">No change recorded.</p>`;
  $("ttChanges").querySelectorAll("[data-ttexdel]").forEach((b) => b.onclick = async () => {
    if (!confirm("Remove this change? (A message already sent stays sent.)")) return;
    try { await rpc("t_tt_exception_delete", { p_id: Number(b.dataset.ttexdel) }); await ttReload(); } catch (e) { toast(e.message, "error"); }
  });
  $("ttChangeBtn").classList.toggle("hidden", !mine);
}
async function ttReload() {
  if (ttState.sel && ttState.sel !== MINE) { try { ttCur = await rpc("t_tt_get", { p_id: ttState.sel }); } catch (e) { toast(e.message, "error"); } }
  try { ttMine = await rpc("t_tt_mine"); } catch (e) { /* keep */ }
  ttFillViews(); ttDraw(); ttRenderSettings(); ttNowBar();
}

// ------------------------------------------------------------------ one slot
function ttSlotInfo(s) {
  TTV.ask({ title: `${s.module} · ${TTV.kindLabel(s)}`, ok: false, cancel: "Close",
    html: `<p>${esc(s.module_name || "")}</p><p>${esc(TT_DAYS[s.day])} ${esc(TTV.hm(s.starts))}–${esc(TTV.hm(s.ends))}${s.parity !== "all" ? " · week " + esc(s.parity) : ""}<br>
      ${esc(s.room || "room?")}${s.teacher && !$("ttStudents").checked ? " · " + esc(s.teacher) : ""}${s.section && ttState.sel === MINE ? "<br>Section: " + esc(s.section) : ""}</p>${s.note ? `<p class="muted">${esc(s.note)}</p>` : ""}` });
}
function ttGroupOptions(sel) {
  const t = ttCur || {}, slots = t.slots || [];
  const all = [...new Set((t.td_groups || []).concat(t.tp_groups || [], slots.map((s) => s.target)).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return `<option value="">Whole section</option>` + all.map((g) => `<option ${g === sel ? "selected" : ""}>${esc(g)}</option>`).join("");
}
function ttModuleList() {
  const m = {};
  ((ttCur || {}).slots || []).forEach((s) => { if (!m[s.module]) m[s.module] = s; });
  return m;
}
async function ttSlotDialog(s) {
  const isNew = !s.id, mods = ttModuleList();
  let box;
  const html = `<label>Module (short code)<input id="sdModule" list="sdMods" value="${esc(s.module || "")}" maxlength="40"></label>
    <datalist id="sdMods">${Object.keys(mods).map((m) => `<option value="${esc(m)}">`).join("")}</datalist>
    <label>Module name<input id="sdName" value="${esc(s.module_name || "")}" maxlength="200"></label>
    <div class="row"><label>Type <select id="sdKind">${["course", "td", "tp"].map((k) => `<option value="${k}" ${s.kind === k ? "selected" : ""}>${TT.KIND[k]}</option>`).join("")}</select></label>
      <label>Group <select id="sdGroup">${ttGroupOptions(s.target || "")}</select></label>
      <label>Weeks <select id="sdWeeks">${[["all", "every week"], ["A", "week A"], ["B", "week B"]].map(([v, l]) => `<option value="${v}" ${(s.parity || "all") === v ? "selected" : ""}>${l}</option>`).join("")}</select></label></div>
    <div class="row"><label>Day <select id="sdDay">${TT_DAYS.slice(0, 6).map((d, i) => `<option value="${i}" ${s.day === i ? "selected" : ""}>${d}</option>`).join("")}</select></label>
      <label>From <input type="time" id="sdStart" value="${esc(s.starts || "08:00")}"></label><label>to <input type="time" id="sdEnd" value="${esc(s.ends || "09:30")}"></label></div>
    <div class="row"><label>Room <input id="sdRoom" value="${esc(s.room || "")}" maxlength="60"></label><label>Teacher <input id="sdTeacher" value="${esc(s.teacher || "")}" maxlength="120"></label></div>
    <label>Note <input id="sdNote" value="${esc(s.note || "")}" maxlength="300"></label>
    ${isNew ? "" : `<p style="margin-top:12px"><button class="small red" id="sdDelete">Delete this slot</button></p>`}`;
  const ok = await TTV.ask({ title: isNew ? "New slot" : "Slot", html, ok: "Save", onOpen: (b) => {
    box = b;
    box.querySelector("#sdModule").onchange = () => { const m = mods[box.querySelector("#sdModule").value.trim()]; if (m && !box.querySelector("#sdName").value) box.querySelector("#sdName").value = m.module_name || ""; };
    const del = box.querySelector("#sdDelete");
    if (del) del.onclick = async () => {
      if (!confirm("Delete this slot? (Its changes are deleted too.)")) return;
      try { await rpc("t_tt_slot_delete", { p_id: s.id }); box.close(false); toast("Slot deleted.", "ok"); await ttReload(); } catch (e) { toast(e.message, "error"); }
    };
  } });
  if (!ok) return;
  const v = (id) => box.querySelector(id).value;
  const data = { module: v("#sdModule").trim(), module_name: v("#sdName"), kind: v("#sdKind"), target: v("#sdGroup"), parity: v("#sdWeeks"), day: Number(v("#sdDay")),
    starts: v("#sdStart"), ends: v("#sdEnd"), room: v("#sdRoom"), teacher: v("#sdTeacher"), note: v("#sdNote"), color: s.color || (mods[v("#sdModule").trim()] || {}).color || "" };
  try { await rpc("t_tt_slot_save", { p_tt: ttCur.id, p_id: s.id || null, p_data: data }); toast("Slot saved.", "ok"); await ttReload(); }
  catch (e) { toast(e.message, "error"); }
}

// ------------------------------------------------------------------ a change on a date
$("ttChangeBtn").onclick = async () => {
  if (!ttCur) return;
  const now = TT.now();
  let box;
  const html = `<div class="row"><label>What <select id="cxAction"><option value="cancelled">Cancel a session</option><option value="moved">Move a session</option><option value="added">Add an extra session</option></select></label>
      <label>Date <input type="date" id="cxDate" value="${now.date}"></label></div>
    <div id="cxSlotBox"><label>Session <select id="cxSlot"></select></label></div>
    <div id="cxMoveBox" class="hidden"><div class="row"><label>New date <input type="date" id="cxToDay"></label><label>from <input type="time" id="cxToStart"></label>
      <label>to <input type="time" id="cxToEnd"></label><label>Room <input id="cxToRoom" maxlength="60"></label></div></div>
    <div id="cxAddBox" class="hidden"><div class="row"><label>Module <input id="cxModule" list="cxMods" maxlength="40"></label>
      <label>Type <select id="cxKind"><option value="course">Course</option><option value="td">TD</option><option value="tp">TP</option></select></label>
      <label>Group <select id="cxGroup">${ttGroupOptions("")}</select></label></div>
      <div class="row"><label>from <input type="time" id="cxStart" value="08:00"></label><label>to <input type="time" id="cxEnd" value="09:30"></label><label>Room <input id="cxRoom" maxlength="60"></label></div>
      <datalist id="cxMods">${Object.keys(ttModuleList()).map((m) => `<option value="${esc(m)}">`).join("")}</datalist></div>
    <label>Reason (optional, shown to the students) <input id="cxReason" maxlength="300"></label>
    <label class="tick"><input type="checkbox" id="cxNotify" checked style="width:auto"> send a message to the students of my classes concerned</label>`;
  const fillSlots = () => {
    const d = box.querySelector("#cxDate").value;
    if (!d) return;
    const occ = TT.occurrencesOn(ttCur, d, null).filter((o) => o.id && o.status === "normal");
    box.querySelector("#cxSlot").innerHTML = occ.length ? occ.map((o) => `<option value="${o.id}">${esc(TTV.hm(o.starts))}–${esc(TTV.hm(o.ends))} · ${esc(o.module)} · ${esc(TTV.kindLabel(o))}${o.room ? " · " + esc(o.room) : ""}</option>`).join("")
      : `<option value="">— no session on ${esc(TT.shortDay(d))} —</option>`;
  };
  const showParts = () => {
    const a = box.querySelector("#cxAction").value;
    box.querySelector("#cxSlotBox").classList.toggle("hidden", a === "added");
    box.querySelector("#cxMoveBox").classList.toggle("hidden", a !== "moved");
    box.querySelector("#cxAddBox").classList.toggle("hidden", a !== "added");
  };
  const ok = await TTV.ask({ title: "Cancel, move or add a session", html, ok: "Save", onOpen: (b) => {
    box = b; fillSlots(); showParts();
    box.querySelector("#cxDate").onchange = fillSlots;
    box.querySelector("#cxAction").onchange = showParts;
    box.querySelector("#cxSlot").onchange = () => {
      const s = (ttCur.slots || []).find((x) => String(x.id) === box.querySelector("#cxSlot").value);
      if (s) { box.querySelector("#cxToStart").value = s.starts; box.querySelector("#cxToEnd").value = s.ends; box.querySelector("#cxToRoom").value = s.room; }
    };
    box.querySelector("#cxSlot").onchange();
  }, validate: (b) => {
    const a = b.querySelector("#cxAction").value;
    if (a !== "added" && !b.querySelector("#cxSlot").value) { toast("No session of the timetable on that date.", "error"); return false; }
    return true;
  } });
  if (!ok) return;
  const v = (id) => box.querySelector(id).value;
  const a = v("#cxAction");
  const data = { action: a, date: v("#cxDate"), reason: v("#cxReason") };
  if (a !== "added") data.slot = Number(v("#cxSlot"));
  if (a === "moved") Object.assign(data, { to_day: v("#cxToDay") || v("#cxDate"), to_start: v("#cxToStart"), to_end: v("#cxToEnd"), to_room: v("#cxToRoom") });
  if (a === "added") Object.assign(data, { module: v("#cxModule").trim(), kind: v("#cxKind"), target: v("#cxGroup"), starts: v("#cxStart"), ends: v("#cxEnd"), room: v("#cxRoom") });
  try {
    const r = await rpc("t_tt_exception_save", { p_tt: ttCur.id, p_data: data, p_notify: box.querySelector("#cxNotify").checked });
    toast(r.classes_notified ? `Saved; message sent (${r.classes_notified} class(es)).` : "Saved.", "ok");
    await ttReload();
  } catch (e) { toast(e.message, "error"); }
};

// ------------------------------------------------------------------ settings
function ttRenderSettings() {
  const show = !!(ttCur && ttCur.mine && ttState.sel !== MINE);
  $("ttSettingsCard").classList.toggle("hidden", !show);
  if (!show) return;
  const t = ttCur;
  $("tsTitle").value = t.title || ""; $("tsLevel").value = t.level_short || ""; $("tsYear").value = t.year || ""; $("tsPeriod").value = t.period || ""; $("tsSection").value = t.section || "";
  $("tsTd").value = (t.td_groups || []).length; $("tsTp").value = (t.tp_groups || []).length;
  $("tsStarts").value = t.sem_starts || ""; $("tsEnds").value = t.sem_ends || ""; $("tsWeekA").value = t.week_a_start || "";
  $("tsKinds").value = Object.entries(t.week_kinds || {}).map(([d, k]) => `${d} ${k}`).join("\n");
  $("tsShowTeachers").checked = t.show_teachers !== false;
  const w = t.weeks || [], teach = w.filter((x) => x.kind === "teaching").length;
  $("tsWeeksInfo").textContent = w.length ? `${w.length} weeks: ${teach} of classes, ${w.length - teach} without (holiday or exams).${t.source === "deptdesk" ? " Weeks given by DeptDesk: saving here computes them again from the dates." : ""}`
    : "Set the dates of the semester to know the weeks A and B and the holidays.";
}
$("tsSaveBtn").onclick = async () => {
  const kinds = {}, bad = [];
  $("tsKinds").value.split("\n").map((l) => l.trim()).filter(Boolean).forEach((l) => {
    const m = l.match(/(\d{4}-\d{2}-\d{2})\s*(holiday|holidays|vacances|exams?|examens?)?/i);
    if (!m) { bad.push(l); return; }
    kinds[TT.saturdayOf(m[1])] = /^exam/i.test(m[2] || "") ? "exams" : "holiday";
  });
  if (bad.length) { toast("Not understood: " + bad.join(", ") + " (write: 2026-12-19 holiday)", "error"); return; }
  const n = (id, p) => Array.from({ length: Math.max(0, Math.min(20, Number($(id).value) || 0)) }, (_, i) => p + (i + 1));
  const meta = { title: $("tsTitle").value, level_short: $("tsLevel").value, year: $("tsYear").value, period: $("tsPeriod").value, section: $("tsSection").value,
    td_groups: n("tsTd", "G"), tp_groups: n("tsTp", "SG"), sem_starts: $("tsStarts").value, sem_ends: $("tsEnds").value,
    week_a_start: $("tsWeekA").value, week_kinds: kinds, show_teachers: $("tsShowTeachers").checked };
  try { await rpc("t_tt_save_meta", { p_id: ttCur.id, p_meta: meta }); toast("Saved.", "ok"); ttState.weekAuto = null; await loadTimetableTab(); }
  catch (e) { toast(e.message, "error"); }
};
$("tsDeleteBtn").onclick = async () => {
  if (!ttCur) return;
  if (!confirm(`Delete the timetable « ${ttCur.title} »?\nIts slots and changes are erased; the classes linked to it are unlinked. Sessions and attendance are kept.`)) return;
  try { await rpc("t_tt_delete", { p_id: ttCur.id }); ttState.sel = ""; toast("Timetable deleted.", "ok"); await loadTimetableTab(); } catch (e) { toast(e.message, "error"); }
};
$("ttNewBtn").onclick = async () => {
  const title = prompt("Title of the new timetable (e.g. M2 RT · S1 2026-2027):", "");
  if (!title) return;
  try { ttState.sel = await rpc("t_tt_create", { p_meta: { title } }); toast("Created: add the slots (＋ on each day), then the settings below.", "ok"); await loadTimetableTab(); }
  catch (e) { toast(e.message, "error"); }
};

// ------------------------------------------------------------------ my classes <-> timetables
function ttRenderLinks() {
  const mine = Object.values(classInfo || {}).filter((c) => !c.archived && (c.role || "teacher") !== "assistant");
  const owned = ttList.filter((t) => t.mine);
  if (!mine.length) { $("ttLinks").innerHTML = `<p class="muted">No class yet.</p>`; return; }
  const linkOf = (cid) => ttMine.links.find((l) => l.class_id === cid) || {};
  $("ttLinks").innerHTML = `<table><tr><th>Class</th><th>Timetable</th><th>My module there</th><th>Late after</th><th></th></tr>` + mine.map((c) => {
    const l = linkOf(c.id);
    return `<tr data-cl="${c.id}"><td>${esc(c.name)} ${esc(c.year)}</td>
      <td><select class="lkTt" style="width:auto;max-width:260px"><option value="">— none —</option>${owned.map((t) => `<option value="${t.id}" ${t.id === l.tt ? "selected" : ""}>${esc(t.title)}</option>`).join("")}</select></td>
      <td><select class="lkMod" style="width:auto"></select></td>
      <td><input type="number" class="lkLate" min="0" max="120" value="${l.late_after_min != null ? l.late_after_min : 10}" style="width:70px"> min</td>
      <td><button class="small lkSave">Save</button></td></tr>`;
  }).join("") + `</table>`;
  $("ttLinks").querySelectorAll("tr[data-cl]").forEach((tr) => {
    const l = linkOf(tr.dataset.cl);
    const fillMods = () => {
      const t = ttList.find((x) => x.id === tr.querySelector(".lkTt").value);
      tr.querySelector(".lkMod").innerHTML = t ? (t.modules || []).map((m) => `<option ${m === l.module ? "selected" : ""}>${esc(m)}</option>`).join("") : "";
    };
    fillMods();
    tr.querySelector(".lkTt").onchange = fillMods;
    tr.querySelector(".lkSave").onclick = async () => {
      const tt = tr.querySelector(".lkTt").value || null;
      if (tt && !tr.querySelector(".lkMod").value) { toast("This timetable has no module yet.", "error"); return; }
      try {
        await rpc("t_tt_link_class", { p_class: tr.dataset.cl, p_tt: tt, p_module: tr.querySelector(".lkMod").value, p_late: Number(tr.querySelector(".lkLate").value) });
        toast(tt ? "Linked: the students of this class see the timetable." : "Unlinked.", "ok"); await loadTimetableTab();
      } catch (e) { toast(e.message, "error"); }
    };
  });
}

// ------------------------------------------------------------------ import
$("ttImportBtn").onclick = () => {
  const input = document.createElement("input");
  input.type = "file"; input.accept = ".xlsx,.xls,.ods,.json";
  input.onchange = () => input.files[0] && ttImportFile(input.files[0]);
  input.click();
};
async function ttImportFile(file) {
  let parsed;   // { kind, meta, slots, exceptions, problems, sections? }
  try {
    if (/\.json$/i.test(file.name)) {
      const x = JSON.parse(await file.text());
      const problems = TT.validateExchange(x);
      if (problems.length && (!x || x.format !== "timetable-exchange")) { toast("This file is not a timetable exported by DeptDesk.", "error"); return; }
      parsed = { kind: "deptdesk", x, problems, sections: (x.sections || []).map((s) => s.code) };
      Object.assign(parsed, TT.fromExchange(x, parsed.sections[0]));
    } else {
      const book = await readWorkbookGrid(file);
      const r = TT.fromWorkbook(book);
      if (!r.slots.length) { toast(r.problems[0] || "No slot found in this file.", "error"); return; }
      const base = file.name.replace(/\.[^.]+$/, "").replace(/^Timetable_/i, "").replace(/_/g, " ");
      parsed = { kind: "excel", problems: r.problems, slots: r.slots, exceptions: [],
        meta: { title: base, td_groups: r.td_groups, tp_groups: r.tp_groups, source: "excel", source_key: file.name } };
    }
  } catch (e) { toast("File not readable: " + e.message, "error"); return; }
  const owned = ttList.filter((t) => t.mine);
  const guess = owned.find((t) => t.title === parsed.meta.title);
  let box;
  const summary = () => {
    const mods = [...new Set(parsed.slots.map((s) => s.module))];
    return `<p><strong>${parsed.slots.length} slots</strong>, ${mods.length} modules: ${esc(mods.join(", "))}.<br>
      Groups: ${esc((parsed.meta.td_groups || []).join(" ") || "—")} · ${esc((parsed.meta.tp_groups || []).join(" ") || "—")}${parsed.exceptions.length ? `<br>${parsed.exceptions.length} change(s) of dates` : ""}
      ${parsed.kind === "deptdesk" && parsed.meta.weeks.length ? `<br>Semester and weeks A/B given by DeptDesk (${parsed.meta.weeks.length} weeks).` : ""}</p>
      ${parsed.problems.length ? `<div class="file-comment"><strong>${parsed.problems.length} line(s) to check:</strong><br>${parsed.problems.slice(0, 12).map(esc).join("<br>")}</div>` : ""}`;
  };
  const html = `${parsed.kind === "deptdesk" && parsed.sections.length > 1 ? `<label>Section <select id="imSec">${parsed.sections.map((c) => `<option>${esc(c)}</option>`).join("")}</select></label>` : ""}
    <div id="imSummary">${summary()}</div>
    <label>Import into <select id="imTarget"><option value="">a new timetable</option>${owned.map((t) => `<option value="${t.id}" ${guess && guess.id === t.id ? "selected" : ""}>replace « ${esc(t.title)} »</option>`).join("")}</select></label>
    <label id="imTitleBox">Title <input id="imTitle" value="${esc(parsed.meta.title)}" maxlength="200"></label>
    <p class="muted">Replacing keeps the slots that come back unchanged (and the sessions started from them); the others are replaced. The changes you typed here are kept.</p>`;
  const ok = await TTV.ask({ title: `Import « ${file.name} »`, html, ok: "Import", wide: true, onOpen: (b) => {
    box = b;
    const sec = box.querySelector("#imSec");
    if (sec) sec.onchange = () => { Object.assign(parsed, TT.fromExchange(parsed.x, sec.value)); box.querySelector("#imSummary").innerHTML = summary(); box.querySelector("#imTitle").value = parsed.meta.title; };
    const tg = box.querySelector("#imTarget");
    tg.onchange = () => box.querySelector("#imTitleBox").classList.toggle("hidden", !!tg.value);
    tg.onchange();
  } });
  if (!ok) return;
  const target = box.querySelector("#imTarget").value || null;
  const meta = Object.assign({}, parsed.meta);
  if (!target) meta.title = box.querySelector("#imTitle").value.trim() || meta.title;
  else delete meta.title;
  try {
    const r = await rpc("t_tt_import", { p_id: target, p_meta: meta, p_slots: parsed.slots, p_exceptions: parsed.exceptions });
    toast(`Imported: ${r.inserted} new, ${r.updated} kept, ${r.deleted} removed.`, "ok");
    ttState.sel = r.id; ttState.weekAuto = null;
    await loadTimetableTab();
    if (!ttMine.links.some((l) => l.tt === r.id)) toast("Now link your class to its module (« My classes and their timetable »).", "ok");
  } catch (e) { toast(e.message, "error"); }
}

// ------------------------------------------------------------------ exports
function ttTitleNow() {
  if (ttState.sel === MINE) return "My week";
  const v = $("ttViewSel").selectedOptions[0];
  return `${ttCur ? ttCur.title : ""}${v && v.value ? " - " + v.textContent : ""}`;
}
$("ttExportXls").onclick = () => { const s = ttViewSlots(); if (!s.length) return; TT.exportGrid(ttTitleNow(), s, $("ttStudents").checked, ttMode() === "section"); };
$("ttExportTpl").onclick = () => { if (ttCur) TT.exportTemplate(ttCur.title, ttCur.slots || []); };
$("ttExportIcs").onclick = () => {
  let n = 0;
  ttSources().forEach(({ tt, filter }) => { n += TT.ics(tt, filter, `${ttTitleNow()}${ttState.sel === MINE ? " " + (tt.section || tt.level_short || tt.title) : ""}`); });
  toast(n ? `${n} session(s) in the calendar file: open it with your phone or import it in Google Calendar.` : "No session to export (set the semester dates?).", n ? "ok" : "error");
};
$("ttPrint").onclick = () => { document.body.classList.add("tt-printing"); setTimeout(() => { window.print(); document.body.classList.remove("tt-printing"); }, 50); };

// ------------------------------------------------------------------ Live: the session of the timetable, now
function ttNowBar() {
  const bar = $("ttNowBar");
  if (!bar) return;
  const l = ttMine.links.find((x) => x.class_id === classId), tt = l && ttMine.timetables.find((t) => t.id === l.tt);
  if (!l || !tt) { bar.classList.add("hidden"); return; }
  const now = TT.now();
  const occ = TT.occurrencesOn(tt, now.date, TT.forModule(l.module))
    .filter((o) => o.id && (o.status === "normal" || o.status === "moved_in") && now.min >= TTV.min(o.starts) - 30 && now.min <= TTV.min(o.ends));
  const off = TT.occurrencesOn(tt, now.date, TT.forModule(l.module)).filter((o) => o.status === "cancelled" && now.min >= TTV.min(o.starts) - 30 && now.min <= TTV.min(o.ends));
  if (!occ.length && !off.length) { bar.classList.add("hidden"); return; }
  bar.innerHTML = occ.map((o) => `<span>🗓 Now in your timetable: <strong>${esc(TT.label(o))}</strong> · ${esc(TTV.hm(o.starts))}–${esc(TTV.hm(o.ends))}${o.room ? " · " + esc(o.room) : ""}</span>
      <button class="small green" data-ttstart="${o.id}">▶ Start this session</button>`).join("<br>")
    + off.map((o) => `<span class="muted">${esc(TT.label(o))} ${esc(TTV.hm(o.starts))} is cancelled today.</span>`).join("<br>");
  bar.classList.remove("hidden");
  bar.querySelectorAll("[data-ttstart]").forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try {
      const r = await rpc("t_tt_start_session", { p_class: classId, p_slot: Number(b.dataset.ttstart), p_date: now.date });
      await loadSessions();
      $("sessionSelect").value = r.id;
      await selectSession(r.id);
      toast(r.existing ? "Session of the timetable opened." : `Session created (code ${r.code}): students arriving more than ${l.late_after_min} min after the start are marked late.`, "ok");
    } catch (e) { toast(e.message, "error"); }
    b.disabled = false;
  });
}
setInterval(() => { if (document.visibilityState === "visible") ttNowBar(); }, 60000);
