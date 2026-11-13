(window.CP_FILES = window.CP_FILES || {})["student_v333.js"] = "33.4.1"; // file version, checked by common.js
// v33.3 (students): the exercises to answer (in « To do » and on the session page), the bonuses the teacher shows,
// « Claim a bonus » for a session where the student checked in (during the session and up to 48 h after).
// The student never sees the ranking of an exercise nor whether his answer was right: only « Sent ✓ hh:mm:ss ».

const SV3 = { drafts: {}, choice: {}, claimN: {}, busy: false };
const sv3time = (t) => (t ? new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "");
const sv3day = (d) => (d ? new Date(String(d).length === 10 ? d + "T12:00:00" : d).toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short" }) : "");
const sv3kind = (k) => ({ course: "Course", td: "TD", tp: "TP" }[k] || "");
const sv3num = (x) => (x == null ? "—" : String(Math.round(Number(x) * 100) / 100));

// ------------------------------------------------------------------ exercises
function sv3ExerciseHtml(e, token) {
  const key = token.slice(0, 8) + ":" + e.id;
  const head = `<div class="ex-head"><strong>✏️ ${esc(e.title)}</strong><span class="muted" style="font-size:12px">${e.session_title ? esc(e.session_title) : ""}${e.closes_at && e.open ? " · until " + sv3time(e.closes_at).slice(0, 5) : ""}</span></div>` +
    (e.body ? `<div class="ex-body">${esc(e.body)}</div>` : "");
  if (e.mine) {
    const v = e.atype === "number" ? sv3num(e.mine.number) : e.atype === "choice" ? (e.options || [])[e.mine.choice] || "" : e.mine.text || "";
    return `<div class="ex-card" data-ex="${e.id}">${head}<div class="ex-sent">Sent ✓ ${sv3time(e.mine.at)}</div><div class="muted" style="font-size:13px">Your answer: ${esc(v)}</div></div>`;
  }
  if (!e.open) return "";
  let input;
  if (e.atype === "choice") input = `<div class="ex-opts">${(e.options || []).map((o, i) => `<label><input type="radio" name="ex_${key}" value="${i}" ${SV3.choice[key] === i ? "checked" : ""}> ${esc(o)}</label>`).join("")}</div>
      <button class="ex-send" data-exsend="${e.id}" data-tok="${esc(token)}" data-key="${esc(key)}">Send my answer</button>`;
  else input = `<div class="ex-row"><input class="ex-in" data-key="${esc(key)}" ${e.atype === "number" ? 'inputmode="decimal" placeholder="Your number"' : 'placeholder="Your answer" maxlength="2000"'} value="${esc(SV3.drafts[key] || "")}">
      <button class="ex-send" data-exsend="${e.id}" data-tok="${esc(token)}" data-key="${esc(key)}">Send</button></div>`;
  return `<div class="ex-card" data-ex="${e.id}">${head}${input}<div class="muted" style="font-size:12px;margin-top:4px">One answer only; the order of arrival counts.</div></div>`;
}
async function sv3Send(btn, after) {
  const key = btn.dataset.key, id = btn.dataset.exsend, token = btn.dataset.tok;
  const card = btn.closest(".ex-card"), inp = card.querySelector(".ex-in"), radio = card.querySelector("input[type=radio]:checked");
  const args = { p_device: token, p_id: id, p_text: null, p_number: null, p_choice: null };
  if (radio) args.p_choice = Number(radio.value);
  else if (inp) {
    const raw = inp.value.trim();
    if (!raw) { toast("Type your answer first.", "error"); return; }
    if (inp.getAttribute("inputmode") === "decimal") {
      const n = Number(raw.replace(/\s/g, "").replace(",", "."));
      if (isNaN(n)) { toast("Type a number (e.g. 3.3).", "error"); return; }
      args.p_number = n;
    } else args.p_text = raw;
  } else { toast("Choose an answer first.", "error"); return; }
  btn.disabled = true;
  try {
    const r = await rpc("s_exercise_answer", args);
    delete SV3.drafts[key];
    toast("Sent ✓ " + sv3time(r.at), "ok");
  } catch (e) {
    toast(e.code === "EXERCISE_CLOSED" ? "Too late: the exercise is closed." : e.code === "ALREADY_ANSWERED" ? "You already answered." : e.message, "error");
  }
  btn.disabled = false;
  if (after) after();
}
document.addEventListener("input", (e) => { const i = e.target.closest(".ex-in"); if (i) SV3.drafts[i.dataset.key] = i.value; });
document.addEventListener("change", (e) => { const r = e.target.closest(".ex-card input[type=radio]"); if (r) SV3.choice[r.name.slice(3)] = Number(r.value); });

// « To do » of the home page: the exercises open for him, a line when a bonus can still be claimed
async function sv3Today(courses, go) {
  const box = document.getElementById("todoList"); if (!box) return;
  const items = [];
  let claimable = 0;
  for (const c of courses || []) {
    try { (await rpc("s_exercises", { p_device: c.token })).forEach((e) => items.push(sv3ExerciseHtml(e, c.token))); } catch (e) { /* older database */ }
    try { claimable += ((await rpc("s_bonus", { p_device: c.token })).claimable || []).length; } catch (e) { /* older database */ }
  }
  box.querySelectorAll(".ex-card, .sv3-claim").forEach((x) => x.remove());
  const html = items.filter(Boolean).join("") + (claimable ? `<button class="s-feed sv3-claim"><span class="chip ok">Bonus</span><span class="grow"><strong>You may claim a bonus</strong>
      <span class="muted" style="display:block;font-size:13px">${claimable} session(s) · in Progress</span></span></button>` : "");
  if (!html) return;
  if (box.classList.contains("muted")) { box.innerHTML = ""; box.classList.remove("muted"); }
  box.insertAdjacentHTML("afterbegin", html);
  box.querySelectorAll("[data-exsend]").forEach((b) => b.onclick = () => sv3Send(b, () => sv3Today(courses, go)));
  const cl = box.querySelector(".sv3-claim"); if (cl && go && go.progress) cl.onclick = () => go.progress();
}

// the session page (student.html): the exercises of this session, under what the teacher shows
let sv3LiveKey = "", sv3LiveAt = 0;
async function sv3Live(token, version, inQuiz, exOpen) {
  let box = document.getElementById("exLive");
  if (!box) { box = document.createElement("div"); box.id = "exLive"; box.className = "ex-live"; const v = document.getElementById("viewLive"); if (!v) return; v.after(box); }
  box.classList.toggle("hidden", !!inQuiz);
  if (inQuiz || !token) return;
  // v33.4.1: no exercise open for him → no request at all (on 11/11 every change of the session made 80 phones ask)
  const answered = box.querySelector(".ex-sent");
  if (exOpen === false && !answered) { if (box.innerHTML) { box.innerHTML = ""; box.dataset.html = ""; } return; }
  const typing = document.activeElement && document.activeElement.classList.contains("ex-in");
  if (typing || (version === sv3LiveKey && Date.now() - sv3LiveAt < 15000)) return;
  sv3LiveKey = version; sv3LiveAt = Date.now();
  let list = []; try { list = await rpc("s_exercises", { p_device: token }); } catch (e) { return; }
  const html = list.map((e) => sv3ExerciseHtml(e, token)).join("");
  if (box.dataset.html === html) return;
  box.dataset.html = html; box.innerHTML = html;
  box.querySelectorAll("[data-exsend]").forEach((b) => b.onclick = () => sv3Send(b, () => { sv3LiveKey = ""; sv3Live(token, version, false, true); }));
}

// ------------------------------------------------------------------ bonuses (Progress)
function sv3BonusHtml(b, token) {
  let shown = "";
  if (b.shown) {
    shown = `<div class="bonus-total">+${sv3num(b.total)}</div><span class="muted" style="font-size:12px">point(s) of bonus in this course</span>`;
    if (b.detail === "session" && b.by_session) shown += b.by_session.map((x) => `<div class="bonus-line"><span>${esc(x.unit || sv3kind(x.kind))} · ${esc(x.title)} <span class="muted">${sv3day(x.date)}</span></span><strong>+${sv3num(x.points)}</strong></div>`).join("");
    else if (b.by_category) shown += b.by_category.map((x) => `<div class="bonus-line"><span>${esc(x.label)}</span><strong>+${sv3num(x.points)}</strong></div>`).join("");
  } else shown = `<span class="muted">Your bonuses are not shown by the teacher yet.</span>`;
  const st = { pending: ["waiting", "none"], granted: ["granted", "ok"], refused: ["refused", "abs"] };
  const claims = (b.claims || []).length ? `<div style="margin-top:8px"><strong style="font-size:14px">My claims</strong>${b.claims.map((k) => `<div class="bonus-line claim-state"><span>${esc(k.title)} <span class="muted">${sv3day(k.date)} · ${k.n} bonus${k.n > 1 ? "es" : ""}</span>${k.note ? `<span class="muted" style="display:block">« ${esc(k.note)} »</span>` : ""}</span>
      <span><span class="chip ${st[k.status][1]}">${st[k.status][0]}${k.status === "granted" ? " +" + sv3num(k.points) : ""}</span></span></div>`).join("")}</div>` : "";
  const can = b.claimable || [];
  const key = token.slice(0, 8), n = SV3.claimN[key] || 1;
  const form = can.length ? `<div class="claim-form" data-claimtok="${esc(token)}"><strong>Claim a bonus</strong>
      <select class="cl-ses" aria-label="Session">${can.map((x) => `<option value="${x.session_id}">${esc(x.unit || sv3kind(x.kind))} · ${esc(x.title)} · ${sv3day(x.date)}</option>`).join("")}</select>
      <div class="seg" role="group" aria-label="How many">${[1, 2, 3].map((i) => `<button type="button" data-cln="${i}" class="${i === n ? "on" : ""}">${i} bonus${i > 1 ? "es" : ""}</button>`).join("")}</div>
      <input class="cl-note" maxlength="140" placeholder="A short word: why? (e.g. answered at the board)">
      <button class="cl-send">Send the claim</button>
      <span class="muted" style="font-size:12px">One claim per session, during the session and up to 48 h after. One bonus = ${sv3num(b.value)} point.</span></div>` : "";
  return `<section class="card s-card bonus-box"><h2>My bonus</h2>${shown}${claims}${form}</section>`;
}
async function sv3Progress(courses) {
  for (const c of courses || []) {
    const slot = document.querySelector(`.v3-bonus[data-cls="${c.class_id}"]`); if (!slot) continue;
    let b; try { b = await rpc("s_bonus", { p_device: c.token }); } catch (e) { continue; }
    slot.innerHTML = sv3BonusHtml(b, c.token);
    const f = slot.querySelector(".claim-form"); if (!f) continue;
    const key = c.token.slice(0, 8);
    f.querySelectorAll("[data-cln]").forEach((x) => x.onclick = () => { SV3.claimN[key] = Number(x.dataset.cln); f.querySelectorAll("[data-cln]").forEach((y) => y.classList.toggle("on", y === x)); });
    f.querySelector(".cl-send").onclick = async (ev) => {
      ev.target.disabled = true;
      try {
        await rpc("s_bonus_claim", { p_device: c.token, p_session: f.querySelector(".cl-ses").value, p_n: SV3.claimN[key] || 1, p_note: f.querySelector(".cl-note").value });
        toast("Claim sent: the teacher answers it.", "ok"); SV3.claimN[key] = 1;
        sv3Progress([c]);
      } catch (e) { toast(e.code === "CLAIM_TOO_LATE" ? "Too late: 48 h after the session." : e.code === "ALREADY_CLAIMED" ? "Already claimed for this session." : e.message, "error"); ev.target.disabled = false; }
    };
  }
}
window.stuV333 = { today: sv3Today, progress: sv3Progress, live: sv3Live };
