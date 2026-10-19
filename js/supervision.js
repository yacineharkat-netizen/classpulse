// ClassPulse v31: supervision space of the teacher (final-year projects, theses, mini-projects).
// A project is a small class of kind "project": its students are the team, an assistant of it is the co-supervisor.
(window.CP_FILES = window.CP_FILES || {})["supervision.js"] = "32"; // file version, checked by common.js

let projects = [], projId = null, proj = null, projIsTeacher = false, projTab = "thread", meetingEditing = null, meIsTeacher = false;

// ------------------------------------------------------------------ list of projects
async function loadProjects() {
  $("projCard").classList.add("hidden"); $("projListCard").classList.remove("hidden");
  try { projects = await rpc("t_projects"); } catch (e) { toast(e.message, "error"); return; }
  renderProjects();
}
function renderProjects() {
  const old = $("projShowOld").checked;
  const shown = projects.filter((p) => old || (!p.archived && ["in_progress", "submitted", null, undefined].includes(p.status)));
  const attention = projects.filter((p) => !p.archived && (p.silent || (p.next && p.next.late))).length;
  $("supBadge").textContent = attention ? String(attention) : ""; $("supBadge").classList.toggle("hidden", !attention);
  $("projList").innerHTML = shown.length ? `<table class="proj-table"><tr><th>Project</th><th>Team</th><th>Status</th><th>Next milestone</th><th>Last activity</th></tr>` +
    shown.map((p) => `<tr class="proj-row" data-proj="${p.id}">
      <td><strong>${esc(p.title)}</strong><div class="muted">${esc(PROJECT_TYPE[p.ptype] || "Project")}${p.level ? " · " + esc(p.level) : ""}${p.year ? " · " + esc(p.year) : ""}${p.mine ? "" : ' · <span class="badge info">co-supervisor</span>'}</div></td>
      <td>${p.team.length ? p.team.map(esc).join("<br>") : '<span class="muted">nobody yet</span>'}</td>
      <td><span class="badge ${p.status === "in_progress" ? "open" : "closed"}">${esc(PROJECT_STATUS[p.status] || "in progress")}</span>${p.archived ? ' <span class="badge closed">archived</span>' : ""}
        ${p.defense_date ? `<div class="muted">defense ${esc(dayText(p.defense_date))}</div>` : ""}</td>
      <td>${p.next ? `${esc(p.next.title)}${p.next.due ? `<div class="${p.next.late ? "late" : "muted"}">${p.next.late ? "⚠ late · " : ""}${esc(dayText(p.next.due))}</div>` : ""}` : '<span class="muted">—</span>'}</td>
      <td>${esc(agoText(p.last_activity))}${p.silent ? '<div class="late">⚠ silent for 15 days</div>' : ""}</td></tr>`).join("") + `</table>`
    : `<p class="muted">${projects.length ? "No project in progress (tick « finished ones too »)." : "No project yet. Create one: blank, or from one of your proposals (My space)."}</p>`;
  $("projList").querySelectorAll("[data-proj]").forEach((r) => r.onclick = () => openProject(r.dataset.proj));
}
$("projShowOld").onchange = renderProjects;

// ------------------------------------------------------------------ new project
$("projNewBtn").onclick = async () => {
  $("projForm").classList.toggle("hidden");
  if ($("projForm").classList.contains("hidden")) return;
  if (!$("projYear").value) { const y = new Date().getFullYear(), m = new Date().getMonth(); $("projYear").value = m >= 7 ? `${y}-${y + 1}` : `${y - 1}-${y}`; }
  try {
    const d = await rpc("t_myspace");
    $("projFromProp").innerHTML = `<option value="">— none: a new subject —</option>` +
      d.proposals.map((p) => `<option value="${p.id}">${esc(p.title)} (${esc(p.status)})</option>`).join("");
    window.cpProposals = d.proposals;
  } catch (e) { /* an assistant: no proposals */ }
  if (window.cpPendingProposal) { $("projFromProp").value = window.cpPendingProposal; window.cpPendingProposal = null; $("projFromProp").onchange(); }
};
$("projFromProp").onchange = () => {
  const p = (window.cpProposals || []).find((x) => x.id === $("projFromProp").value);
  if (!p) return;
  $("projTitle").value = p.title; $("projLevel").value = p.level || "";
  $("projType").value = { mini: "mini", master: "master", licence: "licence" }[p.kind] || "pfe";
};
$("projCancelBtn").onclick = () => $("projForm").classList.add("hidden");
$("projCreateBtn").onclick = async () => {
  try {
    const id = await rpc("t_project_create", { p_title: $("projTitle").value, p_year: $("projYear").value, p_ptype: $("projType").value,
      p_level: $("projLevel").value, p_proposal: $("projFromProp").value || null });
    toast("Project space created. Add the team (Team and settings).", "ok");
    $("projForm").classList.add("hidden"); $("projTitle").value = "";
    $("supervisionTab").classList.remove("hidden");
    await openProject(id, "settings");
  } catch (e) { toast(e.message, "error"); }
};
// From My space: « Start the project » on a proposal
function startProjectFromProposal(proposalId) {
  window.cpPendingProposal = proposalId;
  $("supervisionTab").classList.remove("hidden");
  document.querySelector("nav button[data-tab=supervision]").click();
  setTimeout(() => { if ($("projForm").classList.contains("hidden")) $("projNewBtn").click(); }, 300);
}

// ------------------------------------------------------------------ one project
async function openProject(id, tab) {
  projId = id;
  $("projListCard").classList.add("hidden"); $("projCard").classList.remove("hidden");
  if (tab) projTab = tab;
  await reloadProject();
}
async function reloadProject() {
  let r;
  try { r = await rpc("t_project_space", { p_class: projId }); } catch (e) { toast(e.message, "error"); return; }
  proj = r.project; projIsTeacher = r.is_teacher;
  $("projHead").textContent = proj.title;
  const next = proj.milestones.find((m) => !m.validated_at);
  $("projSummary").innerHTML = `${esc(PROJECT_TYPE[proj.ptype] || "Project")}${proj.level ? " · " + esc(proj.level) : ""} · ${esc(proj.year || "")}
    · <span class="badge ${proj.status === "in_progress" ? "open" : "closed"}">${esc(PROJECT_STATUS[proj.status] || "")}</span>
    · team: ${proj.team.length ? proj.team.map((s) => esc(s.name)).join(", ") : "nobody yet"}${proj.co_supervisor ? " · co-supervisor: " + esc(proj.co_supervisor) : ""}
    ${next ? `<br>Next: <strong>${esc(next.title)}</strong>${next.due ? ` <span class="${next.late ? "late" : ""}">(${esc(dayText(next.due))})</span>` : ""}` : ""}
    ${proj.defense_date ? ` · defense ${esc(dayText(proj.defense_date))}` : ""}`;
  $("projGit").classList.toggle("hidden", !proj.github);
  $("projGit").innerHTML = proj.github ? `🐙 <a href="${esc(proj.github)}" target="_blank" rel="noopener">${esc(proj.github.replace(/^https?:\/\//, ""))}</a>
    <button class="small secondary" id="ghBtn">Last commits</button><div id="ghBox"></div>` : "";
  if (proj.github) $("ghBtn").onclick = async () => { $("ghBox").innerHTML = '<span class="muted">…</span>'; $("ghBox").innerHTML = githubHtml(await githubCommits(proj.github)); };
  document.querySelectorAll(".teacher-only-sup").forEach((el) => el.classList.toggle("hidden", el.id === "projNewBtn" ? !meIsTeacher : !projIsTeacher));
  $("coInviteBtn").classList.toggle("hidden", !projIsTeacher);
  renderProjectTab();
}
document.querySelectorAll("#projTabs [data-ptab]").forEach((b) => b.onclick = () => { projTab = b.dataset.ptab; renderProjectTab(); });
$("projBackBtn").onclick = () => loadProjects();
$("projRefreshBtn").onclick = () => reloadProject();

function renderProjectTab() {
  document.querySelectorAll("#projTabs [data-ptab]").forEach((b) => b.classList.toggle("active", b.dataset.ptab === projTab));
  ["thread", "files", "milestones", "meetings", "settings"].forEach((t) => $("ptab-" + t).classList.toggle("hidden", t !== projTab));
  ({ thread: renderThread, files: renderFiles, milestones: renderMilestones, meetings: renderMeetings, settings: renderSettings })[projTab]();
}

// ---- thread
function renderThread() {
  $("projPosts").innerHTML = projectPostsHtml(proj.posts, "data-pfile");
  $("projPosts").querySelectorAll("[data-pfile]").forEach((a) => a.onclick = (e) => { e.preventDefault(); downloadProjectFile(Number(a.dataset.pfile)); });
  $("projPosts").scrollTop = $("projPosts").scrollHeight;
}
$("projPostBtn").onclick = async () => {
  $("projPostBtn").disabled = true;
  try { await rpc("t_project_post", { p_class: projId, p_body: $("projPostBody").value, p_file: null }); $("projPostBody").value = ""; await reloadProject(); }
  catch (e) { toast(e.message, "error"); }
  finally { $("projPostBtn").disabled = false; }
};

// ---- files
async function downloadProjectFile(id) {
  toast("Downloading…");
  try { const f = await rpc("t_project_file_get", { p_id: id }); saveBase64(f.name, f.mime, f.data); }
  catch (e) { toast(e.message, "error"); }
}
const FILE_KIND = { submission: ["version to review", "orange"], reference: ["reference", "info"], doc: ["document", "closed"] };
function renderFiles() {
  $("projUsed").textContent = (proj.used_kb / 1024).toFixed(1);
  $("projFiles").innerHTML = proj.files.length ? proj.files.map((f) => `<div class="file-row">
      <div class="row" style="justify-content:space-between"><span><a href="#" data-fget="${f.id}">📎 ${esc(f.name)}</a>
        <span class="badge ${FILE_KIND[f.kind][1]}">${FILE_KIND[f.kind][0]}</span></span>
        <span class="muted">${esc(sizeText(f.size))} · ${esc(f.by)} · ${esc(whenText(f.at))}</span></div>
      ${f.note ? `<div class="muted">${esc(f.note)}</div>` : ""}
      ${f.comment ? `<div class="file-comment">💬 ${esc(f.comment).replace(/\n/g, "<br>")} <span class="muted">${esc(whenText(f.comment_at))}</span></div>` : ""}
      <div class="row" style="gap:6px;margin-top:4px"><button class="small secondary" data-fcom="${f.id}">💬 ${f.comment ? "Change the comment" : "Comment"}</button>
        <button class="small red" data-fdel="${f.id}">Delete</button></div></div>`).join("") : `<p class="muted">No file yet.</p>`;
  $("projFiles").querySelectorAll("[data-fget]").forEach((a) => a.onclick = (e) => { e.preventDefault(); downloadProjectFile(Number(a.dataset.fget)); });
  $("projFiles").querySelectorAll("[data-fcom]").forEach((b) => b.onclick = async () => {
    const f = proj.files.find((x) => x.id === Number(b.dataset.fcom));
    const c = prompt(`Your comment on « ${f.name} » (the team sees it in the thread):`, f.comment || "");
    if (c === null) return;
    try { await rpc("t_project_file_comment", { p_id: f.id, p_comment: c }); await reloadProject(); } catch (e) { toast(e.message, "error"); }
  });
  $("projFiles").querySelectorAll("[data-fdel]").forEach((b) => b.onclick = async () => {
    if (!confirm("Delete this file for everyone?")) return;
    try { await rpc("t_project_file_delete", { p_id: Number(b.dataset.fdel) }); await reloadProject(); } catch (e) { toast(e.message, "error"); }
  });
}
$("projFileBtn").onclick = async () => {
  const file = $("projFile").files[0];
  if (!file) { toast("Choose a file first.", "error"); return; }
  if (file.size > 5 * 1024 * 1024) { toast(errorText({ message: "FILE_TOO_BIG" }), "error"); return; }
  $("projFileBtn").disabled = true; toast("Uploading…");
  try {
    await rpc("t_project_file_add", { p_class: projId, p_name: file.name, p_mime: file.type, p_b64: await fileToBase64(file), p_kind: $("projFileKind").value, p_note: $("projFileNote").value });
    $("projFile").value = ""; $("projFileNote").value = ""; toast("File added.", "ok"); await reloadProject();
  } catch (e) { toast(e.message, "error"); }
  finally { $("projFileBtn").disabled = false; }
};

// ---- milestones
function renderMilestones() {
  $("msTplBtn").classList.toggle("hidden", proj.milestones.length > 0);
  $("projMilestones").innerHTML = proj.milestones.length ? proj.milestones.map((m) => `<div class="ms-row ${m.validated_at ? "ok" : m.late ? "late-row" : ""}">
      <span class="ms-state">${m.validated_at ? "✔" : m.done_at ? "☑" : "○"}</span>
      <span class="ms-title"><strong>${esc(m.title)}</strong>${m.due ? ` <span class="${m.late ? "late" : "muted"}">${m.late ? "⚠ " : ""}${esc(dayText(m.due))}</span>` : ""}
        <span class="muted">${m.validated_at ? " · validated " + esc(whenText(m.validated_at)) : m.done_at ? " · done by the team " + esc(whenText(m.done_at)) + ": to validate" : ""}</span></span>
      <span class="ms-actions">${m.validated_at ? `<button class="small secondary" data-ms="unvalidate" data-id="${m.id}">Undo</button>` : `<button class="small green" data-ms="validate" data-id="${m.id}">Validate</button>`}
        <button class="small secondary" data-msedit="${m.id}">✏</button><button class="small red" data-ms="delete" data-id="${m.id}">✕</button></span></div>`).join("")
    : `<p class="muted">No milestone yet. « Add the usual steps » gives a list to adapt (then set the dates).</p>`;
  $("projMilestones").querySelectorAll("[data-ms]").forEach((b) => b.onclick = async () => {
    if (b.dataset.ms === "delete" && !confirm("Delete this milestone?")) return;
    try { await rpc("t_milestone_set", { p_id: Number(b.dataset.id), p_action: b.dataset.ms }); await reloadProject(); } catch (e) { toast(e.message, "error"); }
  });
  $("projMilestones").querySelectorAll("[data-msedit]").forEach((b) => b.onclick = async () => {
    const m = proj.milestones.find((x) => x.id === Number(b.dataset.msedit));
    const t = prompt("Title of the milestone:", m.title); if (t === null) return;
    const d = prompt("Due date (YYYY-MM-DD, empty = none):", m.due || ""); if (d === null) return;
    try { await rpc("t_milestone_save", { p_class: projId, p_id: m.id, p_title: t, p_due: d.trim() || null }); await reloadProject(); } catch (e) { toast(e.message, "error"); }
  });
}
$("msAddBtn").onclick = async () => {
  try { await rpc("t_milestone_save", { p_class: projId, p_id: null, p_title: $("msTitle").value, p_due: $("msDue").value || null }); $("msTitle").value = ""; $("msDue").value = ""; await reloadProject(); }
  catch (e) { toast(e.message, "error"); }
};
$("msTplBtn").onclick = async () => {
  try { const n = await rpc("t_milestones_template", { p_class: projId }); toast(n + " steps added: set their dates (✏).", "ok"); await reloadProject(); } catch (e) { toast(e.message, "error"); }
};

// ---- meetings
function renderMeetings() {
  if (!$("mtDay").value) $("mtDay").value = new Date().toISOString().slice(0, 10);
  $("projMeetings").innerHTML = proj.meetings.length ? proj.meetings.map((g) => `<div class="meeting">
      <div class="row" style="justify-content:space-between"><strong>🗓 ${esc(dayText(g.day))}</strong>
        <span><button class="small secondary" data-mtedit="${g.id}">✏</button> <button class="small red" data-mtdel="${g.id}">✕</button></span></div>
      ${g.attendees ? `<div class="muted">Present: ${esc(g.attendees)}</div>` : ""}
      ${g.notes ? `<div class="mt-part">${esc(g.notes).replace(/\n/g, "<br>")}</div>` : ""}
      ${g.decisions ? `<div class="mt-part"><strong>Decisions:</strong> ${esc(g.decisions).replace(/\n/g, "<br>")}</div>` : ""}
      ${g.next_tasks ? `<div class="mt-part"><strong>Next tasks:</strong> ${esc(g.next_tasks).replace(/\n/g, "<br>")}</div>` : ""}</div>`).join("")
    : `<p class="muted">No minutes yet. Five lines after each meeting are enough: the team reads them in its space.</p>`;
  $("projMeetings").querySelectorAll("[data-mtedit]").forEach((b) => b.onclick = () => {
    const g = proj.meetings.find((x) => x.id === Number(b.dataset.mtedit));
    meetingEditing = g.id;
    $("mtDay").value = g.day; $("mtWho").value = g.attendees; $("mtNotes").value = g.notes; $("mtDecisions").value = g.decisions; $("mtNext").value = g.next_tasks;
    $("mtCancelBtn").classList.remove("hidden"); $("mtDay").scrollIntoView({ block: "center" });
  });
  $("projMeetings").querySelectorAll("[data-mtdel]").forEach((b) => b.onclick = async () => {
    if (!confirm("Delete these minutes?")) return;
    try { await rpc("t_meeting_delete", { p_id: Number(b.dataset.mtdel) }); await reloadProject(); } catch (e) { toast(e.message, "error"); }
  });
}
function clearMeetingForm() {
  meetingEditing = null; ["mtWho", "mtNotes", "mtDecisions", "mtNext"].forEach((id) => { $(id).value = ""; });
  $("mtDay").value = new Date().toISOString().slice(0, 10); $("mtCancelBtn").classList.add("hidden");
}
$("mtCancelBtn").onclick = clearMeetingForm;
$("mtSaveBtn").onclick = async () => {
  try {
    await rpc("t_meeting_save", { p_class: projId, p_id: meetingEditing, p_day: $("mtDay").value || null, p_attendees: $("mtWho").value,
      p_notes: $("mtNotes").value, p_decisions: $("mtDecisions").value, p_next: $("mtNext").value });
    clearMeetingForm(); toast("Minutes saved: the team can read them.", "ok"); await reloadProject();
  } catch (e) { toast(e.message, "error"); }
};

// ---- team and settings
function renderSettings() {
  $("projTeam").innerHTML = proj.team.length ? `<table><tr><th>Student</th><th>Student number</th><th>E-mail</th><th>ClassPulse</th><th></th></tr>` +
    proj.team.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.matricule)}</td><td>${esc(s.email || "")}</td>
      <td>${s.registered ? '<span class="badge ok">project opened</span>' : s.has_account ? '<span class="badge info">has an account: sees the project at his next sign-in</span>' : '<span class="badge no">not registered: he registers with his student number</span>'}</td>
      <td>${projIsTeacher ? `<button class="small red" data-tmdel="${s.id}">Remove</button>` : ""}</td></tr>`).join("") + `</table>` : `<p class="muted">Nobody in the team yet.</p>`;
  $("projTeam").querySelectorAll("[data-tmdel]").forEach((b) => b.onclick = async () => {
    if (!confirm("Remove this student from the team? His messages and files stay in the project.")) return;
    try { await rpc("t_delete_student", { p_student: b.dataset.tmdel }); await reloadProject(); } catch (e) { toast(e.message, "error"); }
  });
  $("psTitle").value = proj.title; $("psType").value = proj.ptype || "pfe"; $("psLevel").value = proj.level || ""; $("psYear").value = proj.year || "";
  $("psStatus").value = proj.status || "in_progress"; $("psSubmit").value = proj.submit_date || ""; $("psDefense").value = proj.defense_date || "";
  $("psGithub").value = proj.github || ""; $("psDesc").value = proj.description || ""; $("psCo").value = proj.co_supervisor || "";
}
$("tmAddBtn").onclick = async () => {
  try {
    const r = await rpc("t_project_add_member", { p_class: projId, p_matricule: $("tmMat").value, p_last_name: $("tmLast").value, p_first_name: $("tmFirst").value });
    toast(`${r.name} added${r.registered ? ": he will see the project at his next sign-in." : ": he registers once on ClassPulse with his student number."}`, "ok");
    ["tmMat", "tmLast", "tmFirst"].forEach((id) => { $(id).value = ""; }); await reloadProject();
  } catch (e) { toast(e.message, "error"); }
};
$("psSaveBtn").onclick = async () => {
  const g = $("psGithub").value.trim();
  if (g && !/github\.com\/[^/\s]+\/[^/\s]+/i.test(g)) { toast("GitHub: give the address of the repository, e.g. https://github.com/team/project", "error"); return; }
  try {
    await rpc("t_project_update", { p_class: projId, p_data: { title: $("psTitle").value, year: $("psYear").value, ptype: $("psType").value, level: $("psLevel").value,
      status: $("psStatus").value, submit_date: $("psSubmit").value, defense_date: $("psDefense").value, github: g, description: $("psDesc").value, co_supervisor: $("psCo").value } });
    toast("Saved.", "ok"); await reloadProject();
  } catch (e) { toast(e.message, "error"); }
};
$("psArchiveBtn").onclick = async () => {
  if (!confirm("Archive this project? Nothing is erased; it leaves the list (tick « finished ones too » to see it).")) return;
  try { await rpc("t_archive_class", { p_class: projId, p_archived: true }); toast("Project archived.", "ok"); loadProjects(); } catch (e) { toast(e.message, "error"); }
};
$("coInviteBtn").onclick = async () => {
  try {
    const r = await rpc("t_invite_assistant", { p_class: projId, p_role: "co", p_perms: null, p_groups: null });
    const link = siteUrl("teacher.html");
    $("coInviteNote").innerHTML = `Invitation code <strong class="code-pill">${esc(r.code)}</strong> (valid 14 days). Send him: « Open ${esc(link)}, then
      « I have an invitation code »: create your account with this code. » He then finds this project in his 🎓 Supervision tab.`;
    $("coInviteNote").classList.remove("hidden");
  } catch (e) { toast(e.message, "error"); }
};

// The tab is shown to the teachers and to the co-supervisors of a project.
async function initSupervision() {
  try {
    const me = await rpc("t_me");
    meIsTeacher = !!me.is_teacher;
    $("supervisionTab").classList.toggle("hidden", !(me.is_teacher || me.has_projects));
    $("projNewBtn").classList.toggle("hidden", !meIsTeacher);
    if (me.has_projects) { projects = await rpc("t_projects"); renderProjects(); }
  } catch (e) { /* older database: no supervision */ }
}
