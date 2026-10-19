// ClassPulse v32.1: floating check-in QR code. A small window that stays ON TOP of every other window (PowerPoint in
// presenter mode, a PDF, a video...), that the teacher moves and resizes where it does not hide the slides.
// It uses the "Document Picture-in-Picture" window of Chrome and Edge (computer). It is opened from the console, which must
// stay open (in the background); closing the projector window does not close it.
(window.CP_FILES = window.CP_FILES || {})["floatqr.js"] = "32.1"; // file version, checked by common.js

const FQ = { win: null, last: "", session: null };

function floatQrSupported() { return "documentPictureInPicture" in window; }

async function floatQrOpen() {
  if (!sessionId || !live || !live.session) { toast("Choose or create the session first.", "error"); return; }
  if (FQ.win && !FQ.win.closed) { FQ.win.focus(); return; }
  if (!floatQrSupported()) {
    toast("This browser cannot keep a window above the slides: open the console in Chrome or Edge (computer).", "error");
    return;
  }
  try { FQ.win = await documentPictureInPicture.requestWindow({ width: 300, height: 380 }); }
  catch (e) { toast("The floating window was refused by the browser: " + e.message, "error"); return; }
  FQ.session = sessionId; FQ.last = "";
  const d = FQ.win.document;
  d.title = "ClassPulse check-in";
  const st = d.createElement("style");
  st.textContent = `html, body { margin: 0; height: 100%; background: #fff; color: #0B2545; font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    #fq { height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 1.5vh; padding: 2vh 2vw; box-sizing: border-box; text-align: center; }
    #fq .t { font-weight: 700; font-size: clamp(12px, 6.5vw, 40px); line-height: 1.1; }
    #fq .q { flex: 1 1 auto; min-height: 0; display: flex; align-items: center; justify-content: center; width: 100%; }
    #fq .q svg { width: auto; height: 100%; max-width: 96vw; max-height: 100%; }
    #fq .c { font-weight: 800; letter-spacing: .12em; font-size: clamp(18px, 15vw, 120px); line-height: 1; color: #E8741E; font-variant-numeric: tabular-nums; }
    #fq .s { font-size: clamp(10px, 4.2vw, 26px); color: #5A6B7D; }
    #fq .s b { color: #0B2545; letter-spacing: .08em; }
    #fq.closed .c { color: #0B2545; }`;
  d.head.appendChild(st);
  d.body.innerHTML = `<div id="fq"><div class="s">Loading…</div></div>`;
  FQ.win.addEventListener("pagehide", () => { FQ.win = null; $("floatQrBtn").classList.remove("on"); });
  $("floatQrBtn").classList.add("on");
  // A code that changes every 15 s is too short for a slow network: 60 s (the previous code is still accepted: up to 2 min).
  if ((live.session.att_window_s || 15) < 60 && $("optWindow")) {
    $("optWindow").value = "60";
    try { await saveSessionOptions(); toast("Floating QR: the attendance code now changes every 60 s (still accepted for 2 min), so slow phones have time.", "ok"); } catch (e) { /* kept as it was */ }
  }
  floatQrTick();
}

// The code is asked again just after it changes. The timer runs in the floating window (visible), so the browser does not
// slow it down while the console is hidden behind the slides.
async function floatQrTick() {
  const w = FQ.win;
  if (!w || w.closed) return;
  if (FQ.session !== sessionId) { w.close(); return; }   // the teacher chose another session
  let a = null;
  try { a = await rpc("t_attendance_code", { p_session: sessionId }); } catch (e) { a = null; }
  if (!FQ.win || FQ.win.closed) return;
  const box = FQ.win.document.getElementById("fq");
  if (a) {
    const code = a.session_code, open = a.open && !(live && live.session && live.session.ended_at);
    const key = open ? "o" + a.code : "c" + code;
    if (key !== FQ.last) {
      FQ.last = key;
      const url = siteUrl("student.html") + "?s=" + code + (open ? "&a=" + a.code : "");
      const qr = qrcode(0, "M"); qr.addData(url); qr.make();
      box.className = open ? "" : "closed";
      box.innerHTML = open
        ? `<div class="t">Scan to check in</div><div class="q">${qr.createSvgTag({ cellSize: 6, margin: 1 })}</div><div class="c">${esc(a.code)}</div>
           <div class="s">session <b>${esc(code)}</b> · code changes every ${a.window_s >= 3600 ? "day" : a.window_s + " s"}</div>`
        : `<div class="t">Scan to join</div><div class="q">${qr.createSvgTag({ cellSize: 6, margin: 1 })}</div><div class="c">${esc(code)}</div>
           <div class="s">session code · attendance not open yet</div>`;
    }
  } else if (!FQ.last) box.innerHTML = `<div class="s">No network: trying again…</div>`;
  const next = a && a.open ? Math.min(20000, Math.max(800, (a.next_change_ms || 5000) + 300)) : 5000;
  FQ.win.setTimeout(floatQrTick, next);
}

$("floatQrBtn").onclick = floatQrOpen;
if (!floatQrSupported()) $("floatQrBtn").title = "Needs Chrome or Edge on a computer";
