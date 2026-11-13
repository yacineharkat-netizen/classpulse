(window.CP_FILES = window.CP_FILES || {})["v334.js"] = "33.4.1"; // file version, checked by common.js
// v33.4 (teacher console):
// - « Open the attendance » chooses how long: for the session (as before) or until a date (1 to 3 weeks, check-in from home:
//   fixed code, never closed by itself before that date);
// - the attendances left open for days are listed on top of Live, with « Close »;
// - « Download a backup » (Me › Classes): one file with everything of my classes.

const v4day = (t) => new Date(t).toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short" });

// ------------------------------------------------------------------ how long the attendance stays open
$("attUntil").onchange = () => {
  $("attUntilDate").classList.toggle("hidden", $("attUntil").value !== "date");
  if ($("attUntil").value === "date" && !$("attUntilDate").value) {
    const d = new Date(Date.now() + 14 * 86400000); $("attUntilDate").value = d.toISOString().slice(0, 10);
  }
};
function v4UntilChosen() {
  const v = $("attUntil").value;
  if (!v) return null;
  if (v === "date") {
    if (!$("attUntilDate").value) return null;
    return new Date($("attUntilDate").value + "T23:59:00");   // the end of that day
  }
  const d = new Date(Date.now() + Number(v) * 86400000); d.setHours(23, 59, 0, 0); return d;
}
$("lvAttToggle").onclick = async () => {
  const L = live; if (!L) return;
  if (L.session.attendance_open) { $("attOffBtn").click(); return; }
  const until = v4UntilChosen();
  if ($("attUntil").value && !until) { toast("Choose the last day.", "error"); return; }
  await $("attOnBtn").onclick();
  if (!until) return;
  try {
    await rpc("t_set_attendance_until", { p_session: sessionId, p_until: until.toISOString() });
    toast(`Attendance open until ${v4day(until)} with a fixed code: the students check in from home with the code.`, "ok");
    $("attUntil").value = ""; $("attUntilDate").classList.add("hidden");
  } catch (e) { toast(e.code === "BAD_DATE" ? "The last day is between today and 60 days from now." : e.message, "error"); }
  await refreshLive(); loadSessions();
};

// ------------------------------------------------------------------ Live: the note of the code, the attendances open for days
const v4PrevLive = window.onLiveRefresh;
window.onLiveRefresh = function () { if (v4PrevLive) v4PrevLive(); v4Live(); };
function v4Live() {
  const L = live, has = !!(sessionId && L && L.session);
  $("lvUntilBox").classList.toggle("hidden", !has || !!L.session.attendance_open);
  v4LongOpen();
}
function v4LongOpen() {
  const list = (typeof allSessions !== "undefined" ? allSessions : []).filter((x) => x.attendance_open && x.attendance_until);
  const bar = $("longOpenBar");
  bar.classList.toggle("hidden", !list.length);
  const html = list.length ? `<strong>${list.length} attendance${list.length > 1 ? "s" : ""} open for days</strong> ` + list.map((x) =>
    `<span class="lo-item">${esc(x.title)} <span class="muted">${esc(x.date)}</span> · until ${v4day(x.attendance_until)} · ${x.present} present
      <button class="btn sec sm" data-loopen="${x.id}">Open</button><button class="btn sec sm" data-loclose="${x.id}">Close</button></span>`).join("") : "";
  if (bar.dataset.html !== html) { bar.dataset.html = html; bar.innerHTML = html; }
}
$("longOpenBar").addEventListener("click", async (e) => {
  const o = e.target.closest("[data-loopen]"), c = e.target.closest("[data-loclose]");
  if (o) { $("sessionSelect").value = o.dataset.loopen; await selectSession(o.dataset.loopen); }
  if (c) {
    try { await rpc("t_set_attendance_open", { p_session: c.dataset.loclose, p_open: false }); toast("Attendance closed.", "ok"); }
    catch (err) { toast(err.message, "error"); }
    await loadSessions();
  }
});
const v4PrevRenderSessions = renderSessionsTable;
renderSessionsTable = function () { v4PrevRenderSessions(); v4LongOpen(); };   // eslint-disable-line no-global-assign

// ------------------------------------------------------------------ Download a backup
$("backupBtn").onclick = async () => {
  $("backupBtn").disabled = true; $("backupNote").textContent = "Preparing…";
  try {
    const data = await rpc("t_backup");
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "classpulse_backup_" + new Date().toISOString().slice(0, 10) + ".json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    $("backupNote").textContent = `${data.classes.length} class(es), ${data.students.length} students, ${data.answers.length} answers · ${Math.round(blob.size / 1024)} KB`;
  } catch (e) { $("backupNote").textContent = ""; toast(e.message, "error"); }
  $("backupBtn").disabled = false;
};
// the counts of the bar follow the check-ins from home (every minute while Live is shown)
setInterval(async () => {
  if (!classId || typeof activeTab === "undefined" || activeTab !== "live" || document.visibilityState !== "visible" || !allSessions.some((x) => x.attendance_until)) return;
  try { allSessions = await rpc("t_list_sessions", { p_class: classId }); v4LongOpen(); } catch (e) { /* next minute */ }
}, 60000);
