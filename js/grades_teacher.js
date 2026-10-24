(window.CP_FILES = window.CP_FILES || {})["grades_teacher.js"] = "33"; // file version, checked by common.js
// v33: Results space of the teacher: « Each quiz » (as before), « Marks » (every column, typed in the app or imported),
// « Final mark » (the formula of the class) and « What students see » (opened and closed at any time, for a time).
const GT = { raw: null, b: null, cid: null, entry: null, edit: null, saveTimer: null, busy: false };
const RT_PAGES = ["quizzes", "marks", "formula", "vis"];
const PART_OPTIONS = [["quiz", "Quizzes"], ["tp", "TP"], ["td", "TD"], ["exam", "Exam"], ["project", "Project"]];
const VIS_DURS = [["", "until I hide it"], ["10", "10 min"], ["60", "1 h"], ["1440", "24 h"]];
function gStore(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } return null; }
function rtCurrent() { const v = gStore("cp_rt"); return RT_PAGES.includes(v) ? v : "quizzes"; }

function showRt(name) {
  if ((name === "formula" || name === "vis") && !can("grading")) name = "marks";
  gStore("cp_rt", name);
  document.querySelectorAll("#rtBar [data-rt]").forEach((b) => b.classList.toggle("on", b.dataset.rt === name));
  RT_PAGES.forEach((p) => $("rt-" + p).classList.toggle("hidden", p !== name));
  if (name !== "quizzes" && (!GT.raw || GT.cid !== classId)) loadGrades();
  else renderGrades();
}
document.querySelectorAll("#rtBar [data-rt]").forEach((b) => { b.onclick = () => showRt(b.dataset.rt); });
// called when the Results tab is shown, or when the class changes while it is shown
function gradesOnShow() {
  GT.entry = null; GT.edit = null;
  const page = rtCurrent();
  document.querySelectorAll("#rtBar [data-rt]").forEach((b) => b.classList.toggle("on", b.dataset.rt === page));
  RT_PAGES.forEach((p) => $("rt-" + p).classList.toggle("hidden", p !== page));
  loadGrades();
}

async function loadGrades() {
  if (!classId) return;
  const cid = classId;
  try { GT.raw = await rpc("t_grading", { p_class: cid }); } catch (e) { $("gTable").textContent = e.message; GT.raw = null; renderPubBar(); return; }
  if (cid !== classId) return;
  GT.cid = cid;
  rebuildGrades();
}
function rebuildGrades() { GT.b = GRADE.build(GT.raw); renderGrades(); }
function renderGrades() {
  if (!GT.raw || !GT.b) { renderPubBar(); return; }
  renderPubBar();
  const page = rtCurrent();
  if (page === "marks") renderMarks();
  if (page === "formula") renderFormula();
  if (page === "vis") renderVis();
}

// ---------------------------------------------------------------- publication of the final marks
function visOf(item) { return (GT.raw && GT.raw.visibility || []).find((v) => v.item === item) || { visible: false }; }
function hm(t) { return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
function finalsChanged() {
  if (!GT.raw || !GT.b) return false;
  const pub = {}; (GT.raw.finals || []).forEach((f) => { pub[f.student_id] = f.final == null ? null : Number(f.final); });
  if (!(GT.raw.finals || []).length) return false;
  return GT.b.rows.some((r) => (pub[r.st.id] === undefined ? null : pub[r.st.id]) !== r.final);
}
function renderPubBar() {
  const v = visOf("final"), changed = v.visible && finalsChanged();
  const pubAt = (GT.raw && GT.raw.finals || [])[0] && GT.raw.finals[0].published_at;
  $("gPubBadge").className = "badge " + (v.visible ? (changed ? "orange" : "ok") : "closed");
  $("gPubBadge").textContent = !GT.raw ? "" : v.visible ? `Final marks shown${pubAt ? " since " + fmtWhen(pubAt) : ""}${v.until ? " · hidden again at " + hm(v.until) : ""}${changed ? " · changes not published" : ""}`
    : "Final marks hidden from the students";
  $("gPubToggle").textContent = v.visible ? "Take the publication back" : `Publish the final marks (${durLabel()})`;
  $("gPubToggle").className = "small " + (v.visible ? "red" : "green");
  $("gPubUpdate").classList.toggle("hidden", !changed);
  [$("gPubToggle"), $("gPubUpdate")].forEach((b) => { b.disabled = !GT.raw; });
}
function durMinutes() { const v = gStore("cp_vis_dur") || ""; return v ? Number(v) : null; }
function durLabel() { const m = durMinutes(); if (!m) return "until I hide it"; const k = VIS_DURS.find((d) => d[0] === String(m)); return k ? k[1] : m + " min"; }
async function publishFinals(show) {
  if (!GT.b) return;
  if (GT.b.wSum !== 100) { toast(`The weights make ${GT.b.wSum} %: they must make 100 % (Final mark page).`, "error"); showRt("formula"); return; }
  const rows = GT.b.rows.map((r) => ({ student_id: r.st.id, final: r.final, detail: r.detail }));
  try {
    await rpc("t_grade_publish", { p_class: classId, p_rows: rows, p_show: show, p_minutes: durMinutes() });
    toast(`Final marks published for ${rows.length} student(s)${durMinutes() ? ", for " + durLabel() : ""}.`, "ok");
  } catch (e) { toast(e.message, "error"); }
  loadGrades();
}
$("gPubToggle").onclick = async () => {
  if (visOf("final").visible) {
    try { await rpc("t_grade_visibility", { p_class: classId, p_item: "final", p_visible: false, p_minutes: null, p_label: "Final mark" }); toast("Final marks hidden from the students.", "ok"); }
    catch (e) { toast(e.message, "error"); }
    loadGrades();
  } else publishFinals(true);
};
$("gPubUpdate").onclick = () => publishFinals(true);
// a line shown for a time hides itself: refresh when the time is over
setInterval(() => {
  if (!GT.raw || activeTab !== "results") return;
  if ((GT.raw.visibility || []).some((v) => v.until && new Date(v.until) <= new Date())) loadGrades();
}, 20000);

// ---------------------------------------------------------------- marks table
function cellText(x) { return x.st === "abs" ? "abs (0)" : x.st === "exc" ? "exc" : x.v == null ? "—" : GRADE.fmt(x.v); }
function renderMarks() {
  const b = GT.b, lim = Number($("gRows").value) || 0;
  const rows = lim ? b.rows.slice(0, lim) : b.rows;
  const edit = GT.raw.can_edit;
  $("gTable").classList.remove("muted");
  if (!b.cols.length && !b.rows.length) { $("gTable").innerHTML = `<p class="muted">No student and no evaluation yet.</p>`; return; }
  $("gTable").innerHTML = `<table class="g-table"><thead><tr><th class="g-name">Student</th>` +
    b.cols.map((c, j) => `<th class="${c.counts ? "" : "g-off"} ${GT.entry === j ? "g-entrycol" : ""}">
      <button class="linklike g-head" data-gcol="${j}" title="${edit ? "Type the marks of this column" : ""}">${esc(c.title)}</button>
      <div class="g-sub">/${GRADE.fmt(c.scale)} · ${c.counts ? "→ " + esc(GRADE.PART_LABEL[c.part]) : "does not count"}</div></th>`).join("") +
    `<th class="g-final">Final</th></tr></thead><tbody>` +
    rows.map((r) => `<tr><td class="g-name"><button class="linklike" data-profile="${r.st.id}">${esc(r.st.last_name)} ${esc(r.st.first_name)}</button>
        <div class="muted" style="font-size:11px">${esc(r.st.matricule)}${r.st.td_group ? " · " + esc(r.st.td_group) : ""}${r.st.tp_group ? " · " + esc(r.st.tp_group) : ""}</div></td>` +
      r.cells.map((x, j) => GT.entry === j
        ? `<td class="g-entrycol"><input class="g-in" data-gstu="${r.st.id}" value="${x.st === "abs" ? "abs" : x.st === "exc" ? "exc" : x.v == null ? "" : GRADE.fmt(x.v)}" inputmode="decimal" aria-label="Mark"></td>`
        : `<td class="${b.cols[j].counts ? "" : "g-off"} g-c-${x.st}"><button class="linklike g-cell" data-gcell="${j}" data-gstu="${r.st.id}">${cellText(x)}</button>${x.corrected || x.forced ? '<span class="g-mod" title="corrected">•</span>' : ""}</td>`).join("") +
      `<td class="g-final"><strong>${GRADE.fmt(r.final)}</strong></td></tr>`).join("") + `</tbody></table>`;
  $("gTableInfo").textContent = `${rows.length} / ${b.rows.length} student(s) · ${b.cols.length} column(s)` + (b.stats ? ` · mean ${b.stats.mean} · ${b.stats.pass}/${b.stats.count} at 10 or more` : "");
  renderEntryBar(); renderEditBar();
  const first = $("gTable").querySelector(".g-in");
  if (first && GT.focusEntry) { first.focus(); first.select(); GT.focusEntry = false; }
}
$("gRows").onchange = () => renderMarks();
$("gTable").addEventListener("click", (e) => {
  const h = e.target.closest("[data-gcol]");
  if (h) {
    if (!GT.raw.can_edit) { toast("You may not change the marks of this class.", "error"); return; }
    GT.entry = Number(h.dataset.gcol); GT.edit = null; GT.focusEntry = true; renderMarks(); return;
  }
  const c = e.target.closest("[data-gcell]");
  if (c && GT.raw.can_edit) { GT.edit = { j: Number(c.dataset.gcell), sid: c.dataset.gstu }; GT.entry = null; renderMarks(); }
});
$("gTable").addEventListener("keydown", (e) => {
  const inp = e.target.closest(".g-in");
  if (!inp || e.key !== "Enter") return;
  e.preventDefault();
  const all = [...$("gTable").querySelectorAll(".g-in")], i = all.indexOf(inp);
  if (all[i + 1]) { all[i + 1].focus(); all[i + 1].select(); }
});
function renderEntryBar() {
  const bar = $("gEntryBar");
  if (GT.entry == null || !GT.b.cols[GT.entry]) { bar.classList.add("hidden"); return; }
  const c = GT.b.cols[GT.entry];
  bar.classList.remove("hidden");
  bar.innerHTML = `<strong>Typing the column: ${esc(c.title)} (/${GRADE.fmt(c.scale)})</strong>
    <span class="muted" style="font-size:13px">Tab or Enter = next student · « abs » = absent (0) · « exc » = excused · empty = not typed${c.type === "quiz" ? " (the computed mark stays)" : ""}</span>
    <span style="flex:1"></span>${c.type === "item" ? `<button class="small secondary" id="gEntryImport">Import this column (Excel)</button>
    <button class="small secondary" id="gItemEdit">Rename…</button><button class="small red" id="gItemDel">Delete the column</button>` : ""}
    <button class="small green" id="gEntrySave">Save the column</button><button class="small secondary" id="gEntryCancel">Cancel</button>`;
  $("gEntryCancel").onclick = () => { GT.entry = null; renderMarks(); };
  $("gEntrySave").onclick = () => saveEntry(c);
  if (c.type === "item") {
    $("gEntryImport").onclick = () => { GT.importOnly = c.item.id; $("gImportFile").value = ""; $("gImportFile").click(); };
    $("gItemEdit").onclick = () => itemDialog(c.item);
    $("gItemDel").onclick = async () => {
      if (!confirm(`Delete the column « ${c.title} » and all its marks?`)) return;
      try { await rpc("t_grade_item_delete", { p_id: c.item.id }); toast("Column deleted.", "ok"); GT.entry = null; loadGrades(); } catch (e) { toast(e.message, "error"); }
    };
  }
}
function parseMark(t) {
  const v = String(t == null ? "" : t).trim().toLowerCase();
  if (v === "") return { st: "empty" };
  if (["abs", "a", "absent"].includes(v)) return { st: "abs" };
  if (["exc", "e", "excused", "excusé", "exc."].includes(v)) return { st: "exc" };
  const n = Number(v.replace(",", "."));
  return isNaN(n) ? { st: "bad" } : { st: "mark", v: n };
}
// one cell → the server. Returns true when something changed.
async function saveCell(c, st, before, p, reason) {
  if (c.type === "item") {
    const rows = [{ student_id: st.id, status: p.st === "empty" || p.st === "clear" ? "clear" : p.st, mark: p.st === "mark" ? p.v : null }];
    if (p.st === "empty" && before.st === "none") return false;
    return Number(await rpc("t_grade_marks_save", { p_item: c.item.id, p_rows: rows, p_reason: reason || null })) > 0;
  }
  if (p.st === "abs" || p.st === "exc") {
    if (before.forced && before.st === p.st) return false;
    await rpc("t_grade_status_set", { p_class: classId, p_key: c.key, p_student: st.id, p_status: p.st, p_reason: reason || null }); return true;
  }
  if (p.st === "clear" || p.st === "empty") {
    let did = false;
    if (before.forced) { await rpc("t_grade_status_set", { p_class: classId, p_key: c.key, p_student: st.id, p_status: null, p_reason: reason || null }); did = true; }
    if (p.st === "clear" && before.corrected && before.quiz) { await rpc("t_set_mark", { p_quiz: before.quiz.id, p_student: st.id, p_mark: null, p_reason: null }); did = true; }
    return did;
  }
  if (!before.quiz) throw new Error("No quiz run for this student in this column.");
  const scale = Number(before.quiz.total_points || 20);
  if (before.st === "mark" && GRADE.r2(before.v) === GRADE.r2(p.v) && !before.forced) return false;
  if (before.forced) await rpc("t_grade_status_set", { p_class: classId, p_key: c.key, p_student: st.id, p_status: null, p_reason: reason || null });
  await rpc("t_set_mark", { p_quiz: before.quiz.id, p_student: st.id, p_mark: GRADE.r2(p.v * scale / c.scale), p_reason: reason || "typed in Marks" });
  return true;
}
async function saveEntry(c) {
  const j = GT.entry, inputs = [...$("gTable").querySelectorAll(".g-in")];
  const todo = [], bad = [];
  inputs.forEach((inp) => {
    const r = GT.b.rows.find((x) => x.st.id === inp.dataset.gstu); if (!r) return;
    const before = r.cells[j], p = parseMark(inp.value);
    const was = before.st === "abs" ? "abs" : before.st === "exc" ? "exc" : before.v == null ? "" : GRADE.fmt(before.v);
    if (String(inp.value).trim().toLowerCase() === was) return;
    if (p.st === "bad" || (p.st === "mark" && (p.v < 0 || p.v > c.scale))) { bad.push(r.st.last_name + " " + r.st.first_name + " (" + inp.value + ")"); inp.classList.add("g-bad"); return; }
    todo.push({ r, before, p });
  });
  if (bad.length) { toast(`Not saved: ${bad.length} mark(s) not valid (0 to ${GRADE.fmt(c.scale)}, abs or exc): ${bad.slice(0, 3).join(", ")}…`, "error"); return; }
  if (!todo.length) { toast("Nothing changed.", "ok"); GT.entry = null; renderMarks(); return; }
  $("gEntrySave").disabled = true;
  let n = 0;
  try {
    if (c.type === "item") {
      const rows = todo.filter((t) => !(t.p.st === "empty" && t.before.st === "none"))
        .map((t) => ({ student_id: t.r.st.id, status: t.p.st === "empty" ? "clear" : t.p.st, mark: t.p.st === "mark" ? t.p.v : null }));
      n = rows.length ? Number(await rpc("t_grade_marks_save", { p_item: c.item.id, p_rows: rows, p_reason: null })) : 0;
    } else {
      for (const t of todo) { if (await saveCell(c, t.r.st, t.before, t.p, "typed in Marks")) n++; }
    }
    toast(`${c.title}: ${n} mark(s) saved.`, "ok");
    GT.entry = null;
  } catch (e) { toast(e.message, "error"); }
  loadGrades();
}
function renderEditBar() {
  const bar = $("gEditBar"), e = GT.edit;
  if (!e) { bar.classList.add("hidden"); return; }
  const r = GT.b.rows.find((x) => x.st.id === e.sid), c = GT.b.cols[e.j];
  if (!r || !c) { bar.classList.add("hidden"); return; }
  const x = r.cells[e.j];
  const hist = (GT.raw.mark_log || []).filter((l) => l.student_id === r.st.id && l.key === c.key).slice(0, 3)
    .map((l) => `${fmtWhen(l.at)}: ${esc(l.old || "—")} → ${esc(l.new || "—")}${l.reason ? " (" + esc(l.reason) + ")" : ""}`).join(" · ");
  bar.classList.remove("hidden");
  bar.innerHTML = `<strong>${esc(r.st.last_name)} ${esc(r.st.first_name)} — ${esc(c.title)}</strong>
    <label style="margin:0">Mark <input id="gEditVal" value="${x.st === "mark" ? GRADE.fmt(x.v) : ""}" inputmode="decimal" style="width:80px"></label> <span>/ ${GRADE.fmt(c.scale)}</span>
    <label style="margin:0">Reason <input id="gEditReason" placeholder="e.g. claim accepted, medical certificate" style="width:240px"></label>
    <button class="small orange" id="gEditSave">Save</button><button class="small secondary" id="gEditAbs">Absent (0)</button>
    <button class="small secondary" id="gEditExc">Excused</button><button class="small secondary" id="gEditClear">${c.type === "item" ? "Clear" : "Back to the computed mark"}</button>
    <button class="small secondary" id="gEditCancel">Cancel</button>
    ${hist ? `<div class="muted" style="font-size:12px;width:100%">History: ${hist}</div>` : ""}`;
  const go = async (p) => {
    try { const ok = await saveCell(c, r.st, x, p, $("gEditReason").value.trim()); toast(ok ? "Saved (kept in the history)." : "Nothing changed.", "ok"); GT.edit = null; loadGrades(); }
    catch (err) { toast(err.message, "error"); }
  };
  $("gEditSave").onclick = () => { const p = parseMark($("gEditVal").value); if (p.st !== "mark" || p.v < 0 || p.v > c.scale) { toast(`A mark from 0 to ${GRADE.fmt(c.scale)}.`, "error"); return; } go(p); };
  $("gEditAbs").onclick = () => go({ st: "abs" });
  $("gEditExc").onclick = () => go({ st: "exc" });
  $("gEditClear").onclick = () => go({ st: "clear" });
  $("gEditCancel").onclick = () => { GT.edit = null; renderMarks(); };
  $("gEditVal").focus();
}

// ---- typed columns
function itemDialog(item) {
  const title = prompt("Name of the column (e.g. Final exam, Project, Oral):", item ? item.title : "Final exam");
  if (title === null || !title.trim()) return;
  const scale = prompt("Marked out of:", item ? String(item.scale) : "20");
  if (scale === null) return;
  const part = prompt("Goes into (exam, project, tp, td, quiz):", item ? item.component : (/proj/i.test(title) ? "project" : "exam"));
  if (part === null) return;
  const comp = String(part).trim().toLowerCase();
  if (!["exam", "project", "tp", "td", "quiz"].includes(comp)) { toast("Choose: exam, project, tp, td or quiz.", "error"); return; }
  rpc("t_grade_item_save", { p_class: classId, p_id: item ? item.id : null, p_title: title.trim(), p_component: comp, p_scale: Number(String(scale).replace(",", ".")) || 20, p_date: null })
    .then(async () => { toast(item ? "Column saved." : "Column added: click its title to type the marks.", "ok"); await loadGrades(); if (!item) { GT.entry = GT.b.cols.length - 1; GT.focusEntry = true; renderMarks(); } })
    .catch((e) => toast(e.message, "error"));
}
$("gAddItem").onclick = () => itemDialog(null);

// ---- Excel: models to fill, import, export everything
function sheetFor(cols, withValues) {
  const head = ["Matricule", "Last name", "First name", "TD group", "TP group", ...cols.map((c) => `${c.title} (/${GRADE.fmt(c.scale)})`)];
  const rows = [head];
  GT.b.rows.forEach((r) => rows.push([r.st.matricule, r.st.last_name, r.st.first_name, r.st.td_group || "", r.st.tp_group || "",
    ...cols.map((c) => { if (!withValues) return ""; const x = r.cells[GT.b.cols.indexOf(c)]; return x.st === "abs" ? "abs" : x.st === "exc" ? "exc" : x.v == null ? "" : GRADE.r2(x.v); })]));
  return rows;
}
function downloadSheet(rows, name, file) {
  const wb = XLSX.utils.book_new(), ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = rows[0].map((h, i) => ({ wch: i < 3 ? 16 : Math.max(10, String(h).length + 2) }));
  XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  XLSX.writeFile(wb, file);
}
const safeName = (t) => String(t).replace(/[^\w-]+/g, "_").slice(0, 40);
$("gTplBtn").onclick = () => {
  if (!GT.b) return;
  const items = GT.b.cols.filter((c) => c.type === "item");
  const m = $("gTplMenu");
  m.innerHTML = items.map((c, i) => `<button data-gtpl="item:${i}"><strong>${esc(c.title)}</strong><span>one column to fill (matricule, name, groups)</span></button>`).join("") +
    `<button data-gtpl="new"><strong>A new column…</strong><span>exam, project, oral: name it, then fill the file</span></button>
     <button data-gtpl="typed"><strong>All the typed columns</strong><span>one column per exam / project / oral (what is already typed is in it)</span></button>
     <button data-gtpl="all"><strong>All the marks (to read or to fill outside)</strong><span>every column; only the typed columns are read back on import</span></button>`;
  m.classList.toggle("hidden");
  m.querySelectorAll("[data-gtpl]").forEach((b) => b.onclick = () => {
    m.classList.add("hidden");
    const k = b.dataset.gtpl, cls = safeName(classNames[classId] || "class");
    if (k === "new") {
      const t = prompt("Name of the column (it is created when you import the file):", "Final exam"); if (!t) return;
      const sc = prompt("Marked out of:", "20") || "20";
      downloadSheet(sheetFor([{ title: t.trim(), scale: Number(sc.replace(",", ".")) || 20 }], false), t, `Model_${cls}_${safeName(t)}.xlsx`);
    } else if (k === "typed") downloadSheet(sheetFor(items, true), "Typed marks", `Model_${cls}_typed_marks.xlsx`);
    else if (k === "all") downloadSheet(sheetFor(GT.b.cols, true), "All marks", `Model_${cls}_all_marks.xlsx`);
    else { const c = items[Number(k.split(":")[1])]; downloadSheet(sheetFor([c], false), c.title, `Model_${cls}_${safeName(c.title)}.xlsx`); }
    toast("Model downloaded: fill it, then « Import a file ».", "ok");
  });
};
$("gImportBtn").onclick = () => { GT.importOnly = null; $("gImportFile").value = ""; $("gImportFile").click(); };
$("gImportFile").onchange = async () => {
  const f = $("gImportFile").files[0]; if (!f) return;
  let aoa;
  try { const wb = XLSX.read(await f.arrayBuffer(), { type: "array" }); aoa = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: "" }); }
  catch (e) { toast("This file cannot be read: " + e.message, "error"); return; }
  const hi = aoa.findIndex((row) => row.some((v) => /^matricule$/i.test(String(v).trim())));
  if (hi < 0) { toast("No « Matricule » column in the first sheet.", "error"); return; }
  const head = aoa[hi].map((v) => String(v).trim()), mi = head.findIndex((v) => /^matricule$/i.test(v));
  const fixed = /^(matricule|last name|first name|nom|prénom|prenom|td group|tp group|groupe td|groupe tp|e-?mail)$/i;
  const items = GT.b.cols.filter((c) => c.type === "item");
  const base = (t) => t.replace(/\s*\(\s*\/\s*[\d.,]+\s*\)\s*$/, "").trim().toLowerCase();
  const plan = [], skipped = [];
  head.forEach((h, i) => {
    if (i === mi || !h || fixed.test(h)) return;
    const it = items.find((c) => base(c.title) === base(h) || c.title.toLowerCase() === h.toLowerCase());
    if (GT.importOnly && (!it || it.item.id !== GT.importOnly)) return;
    if (it) { plan.push({ i, col: it, title: it.title }); return; }
    if (GT.b.cols.some((c) => c.type === "quiz" && base(c.title) === base(h))) { skipped.push(h + " (a quiz: corrected in the table, not by file)"); return; }
    const m = h.match(/\(\s*\/\s*([\d.,]+)\s*\)\s*$/);
    plan.push({ i, col: null, title: h.replace(/\s*\(\s*\/\s*[\d.,]+\s*\)\s*$/, "").trim(), scale: m ? Number(m[1].replace(",", ".")) : 20 });
  });
  if (!plan.length) { toast("No column to import in this file" + (skipped.length ? ": " + skipped.join(", ") : "."), "error"); return; }
  const byMat = {}; GT.b.rows.forEach((r) => { byMat[String(r.st.matricule).trim()] = r.st; });
  const unknown = [], bad = [];
  plan.forEach((p) => { p.rows = []; });
  aoa.slice(hi + 1).forEach((row) => {
    const mat = String(row[mi] || "").trim(); if (!mat) return;
    const st = byMat[mat]; if (!st) { unknown.push(mat); return; }
    plan.forEach((p) => {
      const v = parseMark(row[p.i]); const scale = p.col ? p.col.scale : p.scale;
      if (v.st === "empty") return;
      if (v.st === "bad" || (v.st === "mark" && (v.v < 0 || v.v > scale))) { bad.push(`${mat} ${p.title}: ${row[p.i]}`); return; }
      p.rows.push({ student_id: st.id, status: v.st, mark: v.st === "mark" ? v.v : null });
    });
  });
  const summary = plan.map((p) => `• ${p.title}${p.col ? "" : " (NEW column, /" + p.scale + ")"}: ${p.rows.length} mark(s)`).join("\n")
    + (unknown.length ? `\n\n${unknown.length} student number(s) not in the class (ignored): ${unknown.slice(0, 5).join(", ")}${unknown.length > 5 ? "…" : ""}` : "")
    + (bad.length ? `\n\n${bad.length} value(s) not valid (ignored): ${bad.slice(0, 4).join("; ")}${bad.length > 4 ? "…" : ""}` : "")
    + (skipped.length ? `\n\nNot imported: ${skipped.join(", ")}` : "");
  if (!confirm(`Import « ${f.name} »?\n\n${summary}\n\nThe marks already typed in these columns are replaced (the old values stay in the history).`)) return;
  try {
    let n = 0;
    for (const p of plan) {
      let id = p.col && p.col.item.id;
      if (!id) id = await rpc("t_grade_item_save", { p_class: classId, p_id: null, p_title: p.title, p_component: /proj/i.test(p.title) ? "project" : "exam", p_scale: p.scale, p_date: null });
      if (p.rows.length) n += Number(await rpc("t_grade_marks_save", { p_item: id, p_rows: p.rows, p_reason: "import " + f.name }));
    }
    toast(`Import done: ${n} mark(s) saved.`, "ok");
  } catch (e) { toast(e.message, "error"); }
  GT.importOnly = null; GT.entry = null;
  loadGrades();
};
$("gExportAll").onclick = async () => {
  try {
    const exp = await rpc("t_export", { p_class: classId });
    const extra = [];
    if (GT.b) {
      const items = GT.b.cols.filter((c) => c.type === "item");
      if (items.length) extra.push({ name: "Typed marks", rows: sheetFor(items, true) });
      const head = ["Matricule", "Last name", "First name", ...GT.b.active.map((p) => `${GRADE.PART_LABEL[p]} (${GT.b.S.weights[p]} %)`), "Final /20"];
      extra.push({ name: "Final mark", rows: [head, ...GT.b.rows.map((r) => [r.st.matricule, r.st.last_name, r.st.first_name,
        ...GT.b.active.map((p) => (r.parts[p].n == null ? "" : GRADE.r2(r.parts[p].n))), r.final == null ? "" : r.final])], formula: GT.b.formula });
    }
    downloadResults(exp, extra);
  } catch (e) { toast(e.message, "error"); }
};

// ---------------------------------------------------------------- the formula
function saveSettingsSoon() {
  rebuildGrades();
  clearTimeout(GT.saveTimer);
  GT.saveTimer = setTimeout(async () => {
    try { await rpc("t_grade_settings_save", { p_class: classId, p_settings: GT.raw.settings }); } catch (e) { toast(e.message, "error"); }
  }, 500);
}
function setS(fn) { const S = GRADE.settings(GT.raw.settings); fn(S); GT.raw.settings = S; saveSettingsSoon(); }
const chip = (on, label, attrs) => `<button class="g-chip ${on ? "on" : ""}" ${attrs}>${label}</button>`;
function renderFormula() {
  const b = GT.b, S = b.S, ro = !GT.raw.can_grade;
  $("gModels").innerHTML = Object.entries(GRADE.MODELS).map(([k, m]) => chip(S.model === k, m.label, `data-gmodel="${k}"`)).join("") + chip(S.model === "custom", "Custom", `data-gmodel="custom"`);
  $("gParts").innerHTML = GRADE.PARTS.concat(b.sep ? ["bonus"] : []).map((p) => {
    const on = p === "bonus" || !!S.on[p];
    const src = p === "bonus" ? `points × ${S.bonus_factor}, at most 20` : (b.cols.filter((c) => c.counts && c.part === p).map((c) => esc(c.title)).join(", ") || (p === "td" && !on ? "no TD in this class" : "no column yet"));
    return `<div class="g-part ${on ? "" : "off"}"><div class="row" style="gap:6px;align-items:center;flex-wrap:nowrap">
        <input type="checkbox" data-gon="${p}" ${on ? "checked" : ""} ${ro ? "disabled" : ""} style="width:18px;height:18px" aria-label="Use ${GRADE.PART_LABEL[p]}">
        <span style="flex:1"><strong>${GRADE.PART_LABEL[p]}</strong><div class="muted" style="font-size:12px">${src}</div></span>
        <button class="small secondary" data-gw="${p}" data-d="-5" ${ro ? "disabled" : ""}>−</button>
        <input class="g-w" data-gwin="${p}" value="${on ? S.weights[p] : ""}" ${on && !ro ? "" : "disabled"} inputmode="numeric" aria-label="Weight ${GRADE.PART_LABEL[p]}"> %
        <button class="small secondary" data-gw="${p}" data-d="5" ${ro ? "disabled" : ""}>+</button></div>
      ${on && ["quiz", "tp", "td"].includes(p) ? `<div class="row" style="gap:4px;align-items:center;margin:4px 0 0 26px"><span class="muted" style="font-size:12px">Keep:</span>
        ${[0, 3, 4].map((n) => chip(Number(S.best[p]) === n, n ? n + " best" : "all", `data-gbest="${p}" data-n="${n}"`)).join("")}
        <input class="g-w" data-gbestin="${p}" value="${[0, 3, 4].includes(Number(S.best[p])) ? "" : S.best[p]}" placeholder="N" inputmode="numeric" ${ro ? "disabled" : ""}></div>` : ""}</div>`;
  }).join("");
  $("gSum").className = "g-sum " + (b.wSum === 100 ? "ok" : "no");
  $("gSum").textContent = b.wSum === 100 ? "Total: 100 % ✓" : `Total: ${b.wSum} % — it must make 100 % to publish`;
  $("gSteps").innerHTML = [0.01, 0.25, 0.5].map((v) => chip(Number(S.step) === v, String(v), `data-gstep="${v}"`)).join("");
  $("gStepOther").value = [0.01, 0.25, 0.5].includes(Number(S.step)) ? "" : S.step;
  $("gStepOther").disabled = ro;
  // what counts
  $("gEvals").innerHTML = b.cols.length ? `<table class="g-evals"><tr><th>Counts</th><th>Evaluation</th><th>Goes into</th><th>Mean /20</th></tr>` + b.cols.map((c, j) => {
    const v = b.rows.map((r) => r.cells[j]).filter((x) => x.st === "mark" || x.st === "abs").map((x) => (x.v / c.scale) * 20);
    return `<tr class="${c.counts ? "" : "g-off"}"><td><input type="checkbox" data-gcount="${j}" ${c.counts ? "checked" : ""} ${ro ? "disabled" : ""} style="width:18px;height:18px" aria-label="Count ${esc(c.title)}"></td>
      <td><strong>${esc(c.title)}</strong> <span class="badge info">${esc(KIND_LABEL[c.kind] || (c.kind === "typed" ? "typed" : c.kind))}</span> <span class="muted" style="font-size:12px">${esc(c.date || "")} · /${GRADE.fmt(c.scale)}</span>
        ${c.counts ? "" : `<div class="muted" style="font-size:12px">does not count (still shown to the students if you open it)</div>`}</td>
      <td><select data-gpart="${j}" ${ro ? "disabled" : ""} style="width:auto">${PART_OPTIONS.map(([k, l]) => `<option value="${k}" ${c.part === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
      <td>${v.length ? GRADE.fmt(v.reduce((a, x) => a + x, 0) / v.length) : "—"}</td></tr>`;
  }).join("") + `</table>` : `<p class="muted">No finished quiz and no typed column yet.</p>`;
  const tot = (cat) => b.rows.reduce((a, r) => a + r.bonus[cat], 0), who = (cat) => b.rows.filter((r) => r.bonus[cat] > 0).length;
  $("gBonus").innerHTML = `<div class="row" style="gap:8px">${[["course", "Course bonus"], ["td", "TD bonus"], ["tp", "TP bonus"]].map(([k, l]) =>
      `<label class="g-bcat"><input type="checkbox" data-gbon="${k}" ${S.bonus_on[k] ? "checked" : ""} ${ro ? "disabled" : ""} style="width:18px;height:18px"><span><strong>${l}</strong>
        <span class="muted" style="font-size:12px;display:block">${tot(k) ? who(k) + " student(s) · " + GRADE.fmt(tot(k)) + " pts" : "no bonus given"}</span></span></label>`).join("")}</div>
    <div class="row" style="gap:6px;align-items:center;margin-top:6px"><span style="font-size:14px">How:</span>
      ${chip(!b.sep, "Added to its part (course → Quizzes, TP → TP, TD → TD)", `data-gbmode="add"`)}${chip(b.sep, "A part of its own", `data-gbmode="sep"`)}</div>
    ${b.sep ? `<p class="g-warn">Part « Bonus » added to the weights (1 point = ${S.bonus_factor} / 20, at most 20). A student without bonus has 0 on this part.</p>`
      : `<div class="row" style="gap:6px;align-items:center;margin-top:6px"><span style="font-size:14px">At most, per part:</span>
        ${[1, 2, 3].map((n) => chip(Number(S.bonus_cap) === n, "+" + n, `data-gcap="${n}"`)).join("")}
        <label style="margin:0;font-size:13px">other + <input id="gCapOther" value="${[1, 2, 3].includes(Number(S.bonus_cap)) ? "" : S.bonus_cap}" inputmode="decimal" placeholder="e.g. 1.5" style="width:70px" ${ro ? "disabled" : ""}></label>
        <span class="muted" style="font-size:12px">Never above 20.</span></div>`}`;
  // preview
  $("gFormulaText").textContent = b.formula;
  const keep = $("gPreviewStudent").value;
  $("gPreviewStudent").innerHTML = b.rows.map((r) => `<option value="${r.st.id}">${esc(r.st.last_name)} ${esc(r.st.first_name)}</option>`).join("");
  if (keep && b.rows.some((r) => r.st.id === keep)) $("gPreviewStudent").value = keep;
  renderPreview();
  $("rt-formula").querySelectorAll("button.g-chip").forEach((x) => { x.disabled = ro; });
}
function renderPreview() {
  const b = GT.b, r = b.rows.find((x) => x.st.id === $("gPreviewStudent").value) || b.rows[0];
  $("gPreview").innerHTML = r ? `<div class="g-prev">${r.detail.map((d) => `<div class="g-pl"><span><strong>${esc(d.label)}</strong> <span class="muted">${d.weight} %</span>
      <span class="muted" style="display:block;font-size:12px">${esc(d.notes || "")}</span></span><strong>${GRADE.fmt(d.mark)}</strong></div>`).join("")}
      <div class="g-pl g-pf"><strong>Final</strong><strong>${GRADE.fmt(r.final)}</strong></div></div>` : `<p class="muted">No student.</p>`;
  const s = b.stats;
  $("gStats").innerHTML = s ? [["Mean", s.mean], ["10 or more", s.pass + " / " + s.count], ["Min", s.min], ["Max", s.max]].map(([l, v]) => `<div><span class="muted">${l}</span><strong>${v}</strong></div>`).join("") : "";
}
$("gPreviewStudent").onchange = renderPreview;
$("rt-formula").addEventListener("click", (e) => {
  const t = e.target.closest("button"); if (!t || !GT.raw || !GT.raw.can_grade) return;
  if (t.dataset.gmodel) setS((S) => { S.model = t.dataset.gmodel; const m = GRADE.MODELS[S.model]; if (m) { Object.assign(S.weights, m.weights); Object.assign(S.on, m.on); } });
  else if (t.dataset.gw) setS((S) => { S.weights[t.dataset.gw] = Math.max(0, Math.min(100, Number(S.weights[t.dataset.gw] || 0) + Number(t.dataset.d))); S.model = "custom"; if (t.dataset.gw !== "bonus") S.on[t.dataset.gw] = true; });
  else if (t.dataset.gbest) setS((S) => { S.best[t.dataset.gbest] = Number(t.dataset.n); });
  else if (t.dataset.gstep) setS((S) => { S.step = Number(t.dataset.gstep); });
  else if (t.dataset.gbmode) setS((S) => { S.bonus_mode = t.dataset.gbmode; });
  else if (t.dataset.gcap) setS((S) => { S.bonus_cap = Number(t.dataset.gcap); });
});
$("rt-formula").addEventListener("change", async (e) => {
  const t = e.target; if (!GT.raw || !GT.raw.can_grade) return;
  const num = (v) => Number(String(v).replace(",", "."));
  if (t.dataset.gon) setS((S) => { if (t.dataset.gon === "bonus") S.bonus_mode = "add"; else { S.on[t.dataset.gon] = t.checked; S.model = "custom"; } });
  else if (t.dataset.gwin) { const v = num(t.value); if (isNaN(v) || v < 0 || v > 100) { toast("A weight from 0 to 100.", "error"); renderFormula(); return; } setS((S) => { S.weights[t.dataset.gwin] = v; S.model = "custom"; }); }
  else if (t.dataset.gbestin) { const v = parseInt(t.value, 10); setS((S) => { S.best[t.dataset.gbestin] = v > 0 ? v : 0; }); }
  else if (t.id === "gStepOther") { const v = num(t.value); if (v > 0 && v <= 5) setS((S) => { S.step = v; }); else if (t.value) toast("A rounding step between 0.01 and 5.", "error"); }
  else if (t.id === "gCapOther") { const v = num(t.value); if (v >= 0 && v <= 20) setS((S) => { S.bonus_cap = v; }); else if (t.value) toast("A cap from 0 to 20.", "error"); }
  else if (t.dataset.gbon) setS((S) => { S.bonus_on[t.dataset.gbon] = t.checked; });
  else if (t.dataset.gcount || t.dataset.gpart) {
    const c = GT.b.cols[Number(t.dataset.gcount || t.dataset.gpart)];
    const counts = t.dataset.gcount ? t.checked : c.counts, part = t.dataset.gpart ? t.value : c.part;
    try {
      await rpc("t_grade_eval_set", { p_class: classId, p_key: c.key, p_counts: counts, p_component: part });
      GT.raw.evals = (GT.raw.evals || []).filter((x) => x.key !== c.key).concat([{ key: c.key, counts, component: part }]);
      rebuildGrades();
    } catch (err) { toast(err.message, "error"); renderFormula(); }
  }
});

// ---------------------------------------------------------------- what the students see
function visItems() {
  return [{ item: "presence", label: "Attendance", sub: "his own sessions: rate and the status of each one" }]
    .concat(GT.b.cols.map((c) => ({ item: c.key, label: "Result · " + c.title, sub: (c.counts ? "counts in the final mark" : "does not count") + " · /" + GRADE.fmt(c.scale) })))
    .concat([{ item: "final", label: "Final mark", sub: GT.b.S.show_detail ? "with the detail of each part" : "the mark only", final: true }]);
}
function renderVis() {
  const ro = !GT.raw.can_grade;
  $("gVisRows").innerHTML = visItems().map((x) => {
    const v = visOf(x.item);
    return `<div class="g-vrow ${x.final ? "final" : ""}"><span style="flex:1"><strong>${esc(x.label)}</strong><span class="muted" style="display:block;font-size:12px">${esc(x.sub)}</span></span>
      <span class="badge ${v.visible ? "ok" : "closed"}">${v.visible ? "shown" + (v.until ? " until " + hm(v.until) : "") : "hidden"}</span>
      <button class="small ${v.visible ? "secondary" : "green"}" data-gvis="${esc(x.item)}" data-label="${esc(x.label)}" ${ro ? "disabled" : ""}>${v.visible ? "Hide" : x.final ? "Publish" : "Show"}</button></div>`;
  }).join("");
  const cur = gStore("cp_vis_dur") || "";
  $("gDurs").innerHTML = VIS_DURS.map(([k, l]) => chip(cur === k, l, `data-gdur="${k}"`)).join("") +
    `<label style="margin:0;font-size:13px">other <input id="gDurOther" value="${VIS_DURS.some((d) => d[0] === cur) ? "" : cur}" inputmode="numeric" placeholder="min" style="width:64px"></label> min`;
  $("gShowDetail").checked = !!GT.b.S.show_detail; $("gShowDetail").disabled = ro;
  const log = GT.raw.log || [];
  $("gLog").innerHTML = log.length ? log.slice(0, 15).map((l) => `<div>${fmtWhen(l.at)} · ${esc(l.what)}${l.by ? ` <span class="muted">(${esc(l.by)})</span>` : ""}</div>`).join("") : `<span class="muted">Nothing yet.</span>`;
}
$("rt-vis").addEventListener("click", async (e) => {
  const t = e.target.closest("button"); if (!t) return;
  if (t.dataset.gdur !== undefined) { gStore("cp_vis_dur", t.dataset.gdur); renderVis(); renderPubBar(); return; }
  if (t.dataset.gvis) {
    const item = t.dataset.gvis, v = visOf(item);
    if (item === "final") { if (v.visible) $("gPubToggle").click(); else publishFinals(true); return; }
    try { await rpc("t_grade_visibility", { p_class: classId, p_item: item, p_visible: !v.visible, p_minutes: v.visible ? null : durMinutes(), p_label: t.dataset.label });
      toast(t.dataset.label + (v.visible ? ": hidden." : ": shown to the students."), "ok"); }
    catch (err) { toast(err.message, "error"); }
    loadGrades();
  }
  if (t.id === "gVisAllOn" || t.id === "gVisAllOff") {
    const on = t.id === "gVisAllOn";
    const rows = visItems().filter((x) => !x.final || !on).map((x) => ({ item: x.item, visible: on }));
    try { await rpc("t_grade_visibility_many", { p_class: classId, p_rows: rows, p_minutes: on ? durMinutes() : null, p_label: on ? "all shown (except the final mark)" : "all hidden" }); toast(on ? "All shown (except the final mark)." : "All hidden.", "ok"); }
    catch (err) { toast(err.message, "error"); }
    loadGrades();
  }
});
$("rt-vis").addEventListener("change", (e) => {
  if (e.target.id === "gDurOther") { const v = parseInt(e.target.value, 10); if (v > 0) { gStore("cp_vis_dur", String(v)); renderVis(); renderPubBar(); } }
  if (e.target.id === "gShowDetail") setS((S) => { S.show_detail = e.target.checked; });
});
