(window.CP_FILES = window.CP_FILES || {})["nav.js"] = "33.4"; // file version, checked by common.js
// v33.2: navigation of the teacher console.
// - one panel open at a time (menu, To do, bell, requests, student, dialog); Escape closes it;
// - on a phone what opens takes the whole screen, with « ‹ Back » on top; the Back button of the phone goes back one step;
// - the title « Space › page » on top of every page; the position in a list is kept when coming back to it;
// - the left column folds on a computer (icons + counters, the name on hover), the choice is kept in the browser;
// - long pages are cut in sub-tabs; the session expired: log in again without leaving the page.

const NAV = { stack: [], skipPop: 0, restoring: false, scroll: {}, phone: () => window.matchMedia("(max-width: 760px)").matches };
const navStore = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { /* private window */ } return null; };

// ------------------------------------------------------------------ the panels (overlays)
// An overlay closes the other overlays when it opens. The editors are page content: an overlay never closes them.
const NAV_PANELS = [
  { sel: "#avatarMenu", title: "My account" }, { sel: "#todoPanel", title: "To do" }, { sel: "#notifPanel", title: "Notifications" },
  { sel: "#reqPanel", title: "Requests" }, { sel: "#topSearchList", title: "Search", light: true },
  { sel: "#drawer", title: "Student" }, { sel: "#dlgNew", title: "Session" }, { sel: "#dlgMore", title: "Session: settings" },
  { sel: "#dlgQuiz", title: "Quiz of this session" }, { sel: "#boardBox", title: "Stations" }, { sel: "#profileBox", title: "Student" },
  { sel: "#dlgCompare", title: "Compare two students" }, { sel: "#dlgRelogin", title: "Log in again", keep: true },
  { sel: "#mailRead", title: "Message", open: (el) => el.classList.contains("reading"), close: (el) => { el.classList.remove("reading"); if (typeof mailOpen !== "undefined" && mailOpen) { mailOpen = null; renderMailList(); } }, phoneOnly: true },
  { sel: "#composeWrap", title: "Write", editor: true, phoneOnly: true },
  { sel: "#questionEditor", title: "Question", editor: true, phoneOnly: true },
];
const panelOpen = (p, el) => (p.open ? p.open(el) : !el.classList.contains("hidden"));
const panelClose = (p, el) => { if (p.close) p.close(el); else el.classList.add("hidden"); if (p.sel === "#drawer" && typeof SH !== "undefined") SH.drawer = null; };
function panelTitle(p, el) {
  const h = el.querySelector("h2, .card-head strong, strong");
  const t = p.sel === "#drawer" || p.sel === "#mailRead" ? (h ? h.textContent.trim() : p.title) : p.title;
  return t.length > 40 ? t.slice(0, 38) + "…" : t;
}
function navTopPanel() { return NAV.stack.length ? NAV.stack[NAV.stack.length - 1] : null; }
function navSync(p, el, opened) {
  const i = NAV.stack.findIndex((x) => x.p === p);
  if (opened) {
    if (p.phoneOnly && !NAV.phone()) return;
    if (!p.editor) NAV_PANELS.forEach((q) => {   // one overlay at a time
      if (q === p || q.editor || q.keep) return;
      const o = document.querySelector(q.sel);
      if (o && panelOpen(q, o)) panelClose(q, o);
    });
    if (i < 0) {
      NAV.stack.push({ p, el });
      if (!p.light) { try { history.pushState({ cp: "panel", sel: p.sel, tab: typeof activeTab !== "undefined" ? activeTab : "" }, ""); } catch (e) { /* file:// */ } }
    }
  } else if (i >= 0) {
    NAV.stack.splice(i, 1);
    // closed by a button of the page: its step in the history goes too (the Back button would do nothing otherwise)
    const st = history.state;
    if (!p.light && st && st.cp === "panel" && st.sel === p.sel && !NAV.popping) { NAV.skipPop++; history.back(); }
  }
  navBackBar();
}
function navBackBar() {
  const top = navTopPanel(), bar = $("navBackBar");
  const show = !!top && NAV.phone() && !top.p.light;
  bar.classList.toggle("hidden", !show);
  document.body.classList.toggle("nav-full", show);
  if (show) $("navBackTitle").textContent = panelTitle(top.p, top.el);
}
const navObserver = new MutationObserver((muts) => {
  muts.forEach((m) => {
    const p = NAV_PANELS.find((x) => m.target.matches && m.target.matches(x.sel));
    if (!p) return;
    const open = panelOpen(p, m.target), was = NAV.stack.some((x) => x.p === p);
    if (open !== was) navSync(p, m.target, open);
  });
});
function navWatch() {
  NAV_PANELS.forEach((p) => { const el = document.querySelector(p.sel); if (el) navObserver.observe(el, { attributes: true, attributeFilter: ["class"] }); });
}
function navCloseTop() {
  const top = navTopPanel(); if (!top) return false;
  panelClose(top.p, top.el);
  return true;
}
$("navBack").onclick = () => navCloseTop();
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (document.querySelector("body > .modal:not([id]), #lockPanel:not(.hidden)")) return;   // a confirmation handles its own Escape
  if (navCloseTop()) e.preventDefault();
});

// ------------------------------------------------------------------ the history (the Back button of the phone)
const navShowTab = showTab;
showTab = function (tab) {   // eslint-disable-line no-global-assign
  const m = document.querySelector("main");
  if (typeof activeTab !== "undefined" && activeTab && m) {
    const sec = $("tab-" + activeTab);
    NAV.scroll[activeTab] = { main: m.scrollTop, lists: sec ? [...sec.querySelectorAll(".scroll, .table-scroll, #stuTable, #attendanceTable, #mailList")].map((x) => x.scrollTop) : [] };
  }
  navShowTab(tab);
};
document.addEventListener("cp-tab", (e) => {
  const tab = e.detail;
  navTitle();
  if (!NAV.restoring) {
    const st = history.state;
    if (!st || st.cp !== "tab" || st.tab !== tab) { try { history.pushState({ cp: "tab", tab }, ""); } catch (err) { /* file:// */ } }
  }
  const keep = NAV.scroll[tab];
  if (keep) {
    const put = () => {
      const m = document.querySelector("main"), sec = $("tab-" + tab);
      if (m) m.scrollTop = keep.main;
      if (sec) [...sec.querySelectorAll(".scroll, .table-scroll, #stuTable, #attendanceTable, #mailList")].forEach((x, i) => { if (keep.lists[i]) x.scrollTop = keep.lists[i]; });
    };
    setTimeout(put, 60); setTimeout(put, 700); setTimeout(put, 1600);
  }
});
window.addEventListener("popstate", (e) => {
  if (NAV.skipPop) { NAV.skipPop--; return; }
  NAV.popping = true;
  try {
    if (navCloseTop()) return;   // an overlay is open: Back closes it
    const st = e.state;
    if (st && st.tab && st.tab !== activeTab) { NAV.restoring = true; showTab(st.tab); NAV.restoring = false; }
  } finally { NAV.popping = false; }
});

// ------------------------------------------------------------------ the title « Space › page »
const SPACE_LABEL = { live: "Live", class: "My class", msg: "Messages", content: "Course", agenda: "Agenda", me: "Me" };
const TAB_LABEL = { live: "Session", students: "Students", sessions: "Sessions", timetable: "Timetable", results: "Results", messages: "Inbox", announce: "Announcements",
  quizzes: "Quizzes", questions: "Question bank", space: "Documents", demos: "Demos", agenda: "My week", classes: "Classes and assistants", myspace: "Office hours, proposals",
  supervision: "Supervision", notifset: "Notifications", more: "More" };
const RT_LABEL = { marks: "Marks", formula: "Final mark calculation", vis: "What the students see", quizzes: "Each quiz" };
function navTitle() {
  if (typeof activeTab === "undefined") return;
  const sp = SPACE_LABEL[spaceOfTab(activeTab)] || "", pg = TAB_LABEL[activeTab] || activeTab;
  let sub = "";
  if (activeTab === "results") { const b = document.querySelector("#rtBar .tabbtn.on"); if (b) sub = RT_LABEL[b.dataset.rt] || b.textContent; }
  else { const st = document.querySelector(`#tab-${activeTab} .subtabs button.on`); if (st) sub = st.textContent; }
  $("crumbSpace").textContent = sp;
  $("crumbPage").textContent = sp === pg ? "" : pg;
  $("crumbSub").textContent = sub;
  $("crumbSep1").classList.toggle("hidden", sp === pg);
  $("crumbSep2").classList.toggle("hidden", !sub);
  document.title = "ClassPulse · " + [sp, sp === pg ? "" : pg, sub].filter(Boolean).join(" › ");
}
document.addEventListener("click", (e) => { if (e.target.closest("#rtBar .tabbtn, .subtabs button")) setTimeout(navTitle, 30); });
if (typeof showRt === "function") { const navShowRt = showRt; showRt = function (n) { navShowRt(n); navTitle(); }; }   // eslint-disable-line no-global-assign

// ------------------------------------------------------------------ the left column folds (computer)
function navMini(on) {
  document.body.classList.toggle("nav-mini", on);
  navStore("cp_nav_mini", on ? "1" : "0");
  $("navCollapse").textContent = on ? "»" : "« Fold";
  $("navCollapse").title = on ? "Show the names of the spaces" : "Fold the column (icons only)";
  document.querySelectorAll("nav#spaces button[data-space]").forEach((b) => {
    b.title = on ? (SPACE_LABEL[b.dataset.space] || "") + (b.querySelector(".ncount:not(.hidden), .badge:not(.hidden)") ? " (" + (b.querySelector(".ncount:not(.hidden), .badge:not(.hidden)").textContent.trim()) + ")" : "") : "";
  });
}
$("navCollapse").onclick = () => navMini(!document.body.classList.contains("nav-mini"));
navMini(navStore("cp_nav_mini") === "1");
setInterval(() => { if (document.body.classList.contains("nav-mini")) navMini(true); }, 5000);   // counters in the names shown on hover

// ------------------------------------------------------------------ sub-tabs instead of a long page
// groups: [label, [selectors of the cards]]. The cards not listed stay visible (help lines…).
function navSubtabs(tab, groups) {
  const sec = $("tab-" + tab); if (!sec || sec.querySelector(".subtabs")) return;
  const els = groups.map(([, sels]) => sels.map((s) => (typeof s === "string" ? sec.querySelector(s) : s)).filter(Boolean));
  const bar = document.createElement("div");
  bar.className = "subtabs"; bar.setAttribute("role", "tablist");
  bar.innerHTML = groups.map(([l], i) => `<button type="button" data-sub="${i}">${esc(l)}</button>`).join("");
  sec.insertBefore(bar, sec.firstElementChild);
  const show = (i) => {
    els.forEach((list, j) => list.forEach((el) => el.classList.toggle("sub-off", i !== j)));
    bar.querySelectorAll("button").forEach((b) => b.classList.toggle("on", Number(b.dataset.sub) === i));
    navStore("cp_sub_" + tab, String(i));
    navTitle();
  };
  bar.onclick = (e) => { const b = e.target.closest("[data-sub]"); if (b) show(Number(b.dataset.sub)); };
  const keep = Number(navStore("cp_sub_" + tab) || 0);
  show(keep < groups.length ? keep : 0);
}
function cardWith(tab, text) { return [...document.querySelectorAll(`#tab-${tab} > .card, #tab-${tab} > div > .card`)].find((c) => { const h = c.querySelector("h2"); return h && h.textContent.includes(text); }); }
function navBuildSubtabs() {
  // v33.3: these pages are the tabs of the « Course » space (Visible documents, Who reads what, My library, Resources and links)
  navSubtabs("space", [["Visible documents", [cardWith("space", "Student space"), cardWith("space", "Course content"), cardWith("space", "What the lab assistants")]], ["Who reads what", [cardWith("space", "Who reads what")]],
    ["My library", [cardWith("space", "My documents")]], ["Resources and links", [cardWith("space", "My resources"), ($("resourceSearch") || {}).closest ? $("resourceSearch").closest(".card") : null]]]);
  navSubtabs("classes", [["My classes", ["#joinCard", "#newClassCard", "#backupCard", cardWith("classes", "My classes") || "#tab-classes > .card:nth-of-type(3)"]], ["Assistants", [cardWith("classes", "Assistants of this class")]]]);
  navSubtabs("myspace", [["Office hours", [cardWith("myspace", "Office hours")]], ["Proposals", [cardWith("myspace", "Proposals")]]]);
}

// ------------------------------------------------------------------ the session expired: log in again here
window.onSessionExpired = function () {
  if (!$("appView") || $("appView").classList.contains("hidden")) return;
  const d = $("dlgRelogin");
  if (!d.classList.contains("hidden")) return;
  $("reloginEmail").value = ($("whoAmI").textContent || "").trim();
  $("reloginPassword").value = "";
  d.classList.remove("hidden");
  setTimeout(() => $("reloginPassword").focus(), 50);
};
$("reloginBtn").onclick = async () => {
  const email = $("reloginEmail").value.trim(), password = $("reloginPassword").value;
  if (!email || !password) { toast("Type your e-mail and your password.", "error"); return; }
  $("reloginBtn").disabled = true;
  try {
    const r = await db.auth.signInWithPassword({ email, password });
    if (r.error) { toast(r.error.message === "Invalid login credentials" ? "Wrong e-mail or password." : r.error.message, "error"); return; }
    $("dlgRelogin").classList.add("hidden");
    toast("Logged in again. You can go on.", "ok");
    if (typeof activeTab !== "undefined") { NAV.restoring = true; showTab(activeTab); NAV.restoring = false; }
  } finally { $("reloginBtn").disabled = false; }
};
$("reloginPassword").onkeydown = (e) => { if (e.key === "Enter") $("reloginBtn").click(); };
$("reloginOut").onclick = () => { $("dlgRelogin").classList.add("hidden"); $("logoutBtn").click(); };

// ------------------------------------------------------------------ start
navWatch();
navBuildSubtabs();
try { history.replaceState({ cp: "tab", tab: typeof activeTab !== "undefined" ? activeTab : "live" }, ""); } catch (e) { /* file:// */ }
setTimeout(navTitle, 300);
window.addEventListener("resize", navBackBar);
// a page that was loading when the session expired: the « log in again » window is enough, no error on top of it
window.addEventListener("unhandledrejection", (e) => { if (e.reason && e.reason.code === "SESSION_EXPIRED") e.preventDefault(); });
