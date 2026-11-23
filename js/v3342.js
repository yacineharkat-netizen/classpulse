(window.CP_FILES = window.CP_FILES || {})["v3342.js"] = "33.4.4"; // file version, checked by common.js
// v33.4.3 (teacher console):
// - the requests window: one list, grouped by type (bonus, device, another group, class document, others), one color
//   per type, the date and time of each request, the newest first, and a counter per type on the orange band;
// - quiz launch: who sees the run (this pass / everyone checked in) and « trial run »; « keep open » of a running self-paced quiz;
// - « Demo open to any device ».

const V42 = { types: {
  bonus: { label: "Bonus claims", css: "t-bonus" },
  device: { label: "Devices", css: "t-device" },
  guest: { label: "Another group", css: "t-guest" },
  doc: { label: "Class documents", css: "t-doc" },
  other: { label: "Others", css: "t-other" } } };
const v42When = (t) => (t ? new Date(t).toLocaleString([], { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

// ------------------------------------------------------------------ the requests window
function v42Items() {
  const L = live || {}, items = [];
  const liveDev = new Set((L.device_requests || []).map((d) => Number(d.id)));
  const card = (type, at, name, sid, what, buttons, extra) => ({ type, at: at ? new Date(at).getTime() : 0, html:
    `<div class="req ${V42.types[type].css}"><div>${sid ? `<button class="lnk" data-profile="${sid}">${esc(name)}</button>` : `<strong>${esc(name)}</strong>`}
      <span class="what">· ${what}</span> <span class="req-at">${esc(v42When(at))}</span>${extra || ""}</div>${buttons}</div>` });
  const yesNo = (attrs, ok, no) => `<div class="row"><button class="btn gr sm" ${attrs} data-ok="1">${ok}</button><button class="btn sec sm" ${attrs} data-ok="0">${no || "Refuse"}</button></div>`;
  (L.guest_requests || []).forEach((g) => items.push(card("guest", g.at, g.name, g.student_id, `another group (${esc(g.group || "-")}) wants to join`, yesNo(`data-guest="${g.student_id}"`, "Let in"))));
  (L.device_requests || []).forEach((d) => items.push(card("device", d.at, d.name, d.student_id,
    d.kind === "session" ? `this ${esc(d.device_kind || "device")}, for this session only` : `new ${esc(d.device_kind || "device")} to allow as his class device`, yesNo(`data-devreq="${d.id}"`, "Allow"))));
  (SH.reqDev || []).filter((d) => !liveDev.has(Number(d.id))).forEach((d) => items.push(card("device", d.at, d.name, null,
    `${d.kind === "session" ? "this " + esc(d.device_kind || "device") + " for one session" + (d.session ? " (" + esc(d.session) + ")" : "") : "a new " + esc(d.device_kind || "device") + " as his class device"}`,
    yesNo(`data-devreq="${d.id}"`, "Allow"))));
  (L.device_alerts || []).forEach((a) => items.push(card("device", a.at, a.name, a.student_id,
    `tried to check in with the phone of ${esc(a.other || "another student")}: <strong>refused</strong>`,
    `<div class="row"><button class="btn sec sm" data-dalert="${a.id}">Seen</button></div>`)));
  (L.station_requests || []).forEach((r) => items.push(card("other", r.at, r.name, r.student_id,
    `${esc(r.quiz)} · station ${r.from == null ? "-" : r.from} → <strong>${r.to}</strong> (station change)`, yesNo(`data-streq="${r.id}"`, "Accept"))));
  (SH.reqAtt || []).forEach((a) => items.push(card("other", a.at, `${a.last_name} ${a.first_name}`, null,
    `${esc(a.matricule)} · not in the official list · ${a.class_id ? "in a session" : "from the home page"}`, yesNo(`data-rqatt="${a.id}"`, "+ Add to the list", "Dismiss"))));
  const claims = typeof v3PendingClaims === "function" ? v3PendingClaims() : [];
  claims.forEach((k) => items.push(card("bonus", k.at, k.name, k.student_id,
    `claims ${k.n} bonus${k.n > 1 ? "es" : ""} (${v3fmt(k.proposed)} pt) · ${esc(k.unit || v3kind(k.kind))} · ${esc(k.title)} · ${v3day(k.date)}`,
    `<div class="row"><button class="btn gr sm" data-claim="${k.id}" data-act="grant">Grant +${v3fmt(k.proposed)}</button><button class="btn sec sm" data-claim="${k.id}" data-act="adjust">Adjust…</button>
       <button class="btn sec sm" data-claim="${k.id}" data-act="refuse">Refuse</button></div>`, k.note ? `<div class="claim-note">« ${esc(k.note)} »</div>` : "")));
  return items;
}
function v42Counts(items) {
  const c = { bonus: 0, device: 0, guest: 0, doc: 0, other: 0 };
  items.forEach((i) => { c[i.type]++; });
  return c;
}
function v42Requests() {
  let box = $("reqUnified");
  if (!box) {
    box = document.createElement("div"); box.id = "reqUnified"; box.className = "req-list";
    $("reqScroll").insertBefore(box, $("reqScroll").firstChild);
    ["liveRequests", "reqBonus", "reqDevOut", "reqAttempts"].forEach((id) => { $(id).classList.add("hidden"); });
  }
  const items = v42Items(), counts = v42Counts(items);
  const total = (live && live.bonus_claims_total) || 0, shown = ((live && live.bonus_claims) || []).length;
  let html = "";
  Object.keys(V42.types).forEach((t) => {
    const list = items.filter((i) => i.type === t).sort((a, b) => b.at - a.at);
    if (!list.length) return;
    const all = t === "device" && list.some((i) => /data-devreq/.test(i.html)) && list.filter((i) => /data-devreq/.test(i.html)).length > 1
      ? `<button class="btn gr sm" data-devall="1">Accept all (${list.filter((i) => /data-devreq/.test(i.html)).length})</button>` : "";
    html += `<div class="req-title ${V42.types[t].css}"><span class="dot"></span> ${V42.types[t].label} <span class="req-n">${list.length}</span><span class="grow"></span>${all}</div>` +
      list.map((i) => i.html).join("") + (t === "bonus" && total > shown ? `<p class="muted small-t">${total - shown} older claim(s) not shown: see Class › Bonus.</p>` : "");
  });
  if (box.dataset.html !== html) {
    box.dataset.html = html; box.innerHTML = html;
    box.querySelectorAll("[data-streq]").forEach((b) => b.onclick = () =>
      act("t_station_decide", { p_id: Number(b.dataset.streq), p_accept: b.dataset.ok === "1" }, b.dataset.ok === "1" ? "Station changed: his numeric answers are marked again with the new station." : "Refused."));
    box.querySelectorAll("[data-guest]").forEach((b) => b.onclick = async () => {
      await act("t_handle_guest", { p_session: sessionId, p_student: b.dataset.guest, p_accept: b.dataset.ok === "1" }, b.dataset.ok === "1" ? "Student let in: marked present as a guest." : "Refused.");
      refreshAttendance();
    });
    box.querySelectorAll("[data-devreq]").forEach((b) => b.onclick = async () => {
      await act("t_handle_device_request", { p_id: Number(b.dataset.devreq), p_accept: b.dataset.ok === "1" }, b.dataset.ok === "1" ? "Device accepted: remembered for the next sessions." : "Refused.");
      if (typeof shReqLoad === "function") shReqLoad();
    });
    box.querySelectorAll("[data-dalert]").forEach((b) => b.onclick = () => act("t_device_alert_dismiss", { p_session: sessionId, p_id: Number(b.dataset.dalert) }, "Noted."));
    box.querySelectorAll("[data-devall]").forEach((b) => b.onclick = async () => {
      try { const n = await rpc("t_device_accept_all", { p_class: classId, p_session: sessionId || null }); toast(`${n} device(s) accepted.`, "ok"); refreshLive(); if (typeof shReqLoad === "function") shReqLoad(); }
      catch (e) { toast(e.message, "error"); }
    });
  }
  $("reqNone").classList.toggle("hidden", items.length > 0 || !$("silentBox").classList.contains("hidden"));
  return counts;
}
renderLiveRequests = function () { v42Requests(); };   // eslint-disable-line no-global-assign
v3RenderClaims = function () {   // eslint-disable-line no-global-assign
  const n = v3PendingClaims().length;
  $("bonusBadge").textContent = n; $("bonusBadge").classList.toggle("hidden", !n);
  v42Requests();
};
shReqExtra = function () { v42Requests(); };   // eslint-disable-line no-global-assign
$("liveRequests").classList.add("hidden");

// the orange band: how many of each type
const v42PrevTodo = shTodo;
shTodo = function () {   // eslint-disable-line no-global-assign
  v42PrevTodo();
  const counts = v42Counts(v42Items().filter((i) => !/data-dalert/.test(i.html)));
  const parts = Object.keys(V42.types).filter((t) => counts[t]).map((t) => `<span class="req-chip ${V42.types[t].css}">${counts[t]} ${V42.types[t].label.toLowerCase()}</span>`);
  if (parts.length) $("reqBannerText").innerHTML = $("reqBannerText").textContent + " " + parts.join(" ");
  if (!$("reqPanel").classList.contains("hidden")) v42Requests();
};
window.onBadges = shTodo;

// ------------------------------------------------------------------ Live: launch options, keep open, demo switch
const v42PrevLive = window.onLiveRefresh;
window.onLiveRefresh = function () { if (v42PrevLive) v42PrevLive(); v42Live(); };
function v42Live() {
  const s = live && live.session;
  $("launchAudience").classList.toggle("hidden", !(s && (s.kind === "td" || s.kind === "tp")));
  if (document.activeElement !== $("demoAnyDevice")) $("demoAnyDevice").checked = !!(s && s.demo_any_device);
  $("demoAnyDevice").disabled = !s;
  v42KeepRow();
}
$("demoAnyDevice").onchange = (e) => {
  if (!sessionId) return;
  act("t_demo_any_device", { p_session: sessionId, p_on: e.target.checked }, e.target.checked ? "Demo open to any device." : "Demo for the students checked in only.");
};
// a running self-paced quiz: « Keep open after the session »
function v42KeepRow() {
  let row = $("quizKeepNowRow");
  if (!row) {
    row = document.createElement("label"); row.id = "quizKeepNowRow"; row.className = "tick hidden"; row.style.margin = "6px 0 0";
    row.innerHTML = `<input type="checkbox" id="quizKeepNow"> Keep this quiz open after the session (the students can finish it later; « End the session » does not close it)`;
    $("quizRenameBtn").parentElement.insertAdjacentElement("afterend", row);
    $("quizKeepNow").onchange = async (e) => {
      const q = (typeof quizList !== "undefined" ? quizList : []).find((x) => x.id === $("quizSelect").value); if (!q) return;
      try { await rpc("t_quiz_set", { p_quiz: q.id, p_data: { keep_open: e.target.checked } }); q.keep_open = e.target.checked; toast(e.target.checked ? "Kept open after the session." : "Closed with the session.", "ok"); }
      catch (err) { toast(err.message, "error"); e.target.checked = !e.target.checked; }
    };
    $("quizSelect").addEventListener("change", v42KeepRow);
  }
  const q = (typeof quizList !== "undefined" ? quizList : []).find((x) => x.id === $("quizSelect").value);
  const show = !!(q && q.pace === "self" && q.status !== "finished");
  row.classList.toggle("hidden", !show);
  if (show && document.activeElement !== $("quizKeepNow")) $("quizKeepNow").checked = !!q.keep_open;
}
