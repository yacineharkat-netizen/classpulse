(window.CP_FILES = window.CP_FILES || {})["v3341.js"] = "33.4.1"; // file version, checked by common.js
// v33.4.1 (teacher console): the tolerance of the screen lock of the running quiz (at once / 15 / 30 / 60 s away),
// « Unlock all » for the students locked in it.

const v41PrevLive = window.onLiveRefresh;
window.onLiveRefresh = function () { if (v41PrevLive) v41PrevLive(); v41Live(); };
function v41Live() {
  const q = live && live.quiz;
  const show = !!(sessionId && q && q.lock_screen && q.phase !== "finished");
  $("lqLockRow").classList.toggle("hidden", !show);
  if (!show) return;
  if (document.activeElement !== $("lqGrace")) $("lqGrace").value = String(q.lock_grace_s == null ? 15 : q.lock_grace_s);
  const n = (q.locked || []).length;
  $("lqUnlockAll").classList.toggle("hidden", !n);
  $("lqUnlockAll").textContent = `Unlock all (${n})`;
}
$("lqGrace").onchange = async () => {
  const q = live && live.quiz; if (!q) return;
  try {
    await rpc("t_quiz_lock_grace", { p_quiz: q.id, p_seconds: Number($("lqGrace").value) });
    toast(Number($("lqGrace").value) ? `A student away less than ${$("lqGrace").value} s is only warned (locked at the 3rd time).` : "A student who leaves the test is locked at once.", "ok");
  } catch (e) { toast(e.message, "error"); }
  refreshLive();
};
$("lqUnlockAll").onclick = async () => {
  const q = live && live.quiz; if (!q) return;
  try { const n = await rpc("t_unlock_all", { p_quiz: q.id }); toast(`${n} student(s) unlocked.`, "ok"); } catch (e) { toast(e.message, "error"); }
  refreshLive();
};
