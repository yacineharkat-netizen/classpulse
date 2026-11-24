(window.CP_FILES = window.CP_FILES || {})["grading.js"] = "33.4.6"; // file version, checked by common.js
// v33: final mark of a class. One evaluation column = a quiz / test / TP, or a column typed in the app (exam, project, oral…).
// v33.2: in a unit (TP1) the quizzes are grouped by UNIT, whatever their title (the same quiz reused, or one quiz per
// sub-group): the n-th graded quiz of each pass (attendance run) goes to column n (« TP1 · test 2 »). A quiz concerns only
// the students checked in during its pass; checked in during another pass of the unit = not concerned (neither absent nor
// « no answer »); absent only when he came to no pass of the unit.
// Each column counts or not, and goes into one part: quiz | tp | td | exam | project. The final mark is
// the weighted mean of the parts (out of 20), with the bonus added to its part (capped) or as a part of its own.
const GRADE = (() => {
  const PARTS = ["exam", "project", "tp", "td", "quiz", "attendance"];   // v33.4.6: « attendance » has no column: it is computed from the sessions
  const CAT_LABEL = { prep: "Prep", report: "Report", tp_final: "TP · Final test", cc1: "CC1", cc2: "CC2" };
  const CAT_NAMES = { prep: "Preparation quiz", report: "Report quiz (compte rendu)", tp_final: "Final TP test", cc1: "CC1", cc2: "CC2" };
  // v33.4.5: the name of a quiz column is computed from the type of the quiz (set once on the prepared quiz): « TP1 · Prep »,
  // « TP1 · Report », « TP · Final test », « CC2 »; without a type: the unit (« TP1 · quiz 2 ») or the title of the quiz.
  const colTitle = (q, unit, n, many, ses) => {
    const cat = q.category, lab = CAT_LABEL[cat];
    if (cat === "tp_final") return lab;
    if (cat === "cc1" || cat === "cc2") return unit ? lab + " · " + unit : lab + (q.session_title || ses.title ? " · " + (q.session_title || ses.title) : "");
    if (unit) return unit + " · " + (lab || "quiz " + n);
    return lab ? lab + " · " + (q.session_title || ses.title || q.title) : q.title;
  };
  const PART_LABEL = { exam: "Exam", project: "Project", tp: "TP", td: "TD", quiz: "Quizzes and tests", attendance: "Attendance", bonus: "Bonus" };
  const PART_OF_BONUS = { quiz: "course", tp: "tp", td: "td" };   // bonus category added to each part
  const MODELS = {
    td: { label: "With TD", weights: { exam: 50, project: 15, tp: 15, td: 10, quiz: 10, attendance: 5 }, on: { exam: true, project: true, tp: true, td: true, quiz: true, attendance: false } },
    notd: { label: "Without TD", weights: { exam: 50, project: 20, tp: 20, td: 0, quiz: 10, attendance: 5 }, on: { exam: true, project: true, tp: true, td: false, quiz: true, attendance: false } },
    noexam: { label: "Without exam", weights: { exam: 0, project: 40, tp: 40, td: 0, quiz: 20, attendance: 5 }, on: { exam: false, project: true, tp: true, td: false, quiz: true, attendance: false } },
  };
  const DEFAULTS = {
    model: "notd", weights: { exam: 50, project: 20, tp: 20, td: 0, quiz: 10, attendance: 5, bonus: 5 }, on: { exam: true, project: true, tp: true, td: false, quiz: true, attendance: false },
    att_w: { course: 1, td: 1, tp: 1 },   // v33.4.6: relative weight of the sessions of each type inside the attendance part
    best: { quiz: 0, tp: 0, td: 0 }, bonus_on: { course: true, td: true, tp: true }, bonus_mode: "add", bonus_cap: 2, bonus_factor: 4,
    step: 0.25, show_detail: true,
  };
  const clone = (o) => JSON.parse(JSON.stringify(o));
  function settings(raw) {
    const s = clone(DEFAULTS), r = raw || {};
    Object.keys(s).forEach((k) => {
      if (r[k] === undefined || r[k] === null) return;
      if (typeof s[k] === "object") Object.assign(s[k], r[k]); else s[k] = r[k];
    });
    return s;
  }
  const r2 = (x) => Math.round(x * 100) / 100;
  const fmt = (x) => (x == null || isNaN(x) ? "—" : String(r2(x)));

  // ---- the columns and the cell of each student
  function build(g) {
    const d = g.data, S = settings(g.settings);
    const evals = {}; (g.evals || []).forEach((e) => { evals[e.key] = e; });
    const sessionOf = {}; d.sessions.forEach((x) => { sessionOf[x.id] = x; });
    const att = {}; d.attendance.forEach((a) => { att[a.session_id + "|" + a.student_id] = a.status; });
    const pts = {}, maxOf = {}, penaltyOf = {};
    d.scores.forEach((s) => { const k = s.quiz_id + "|" + s.student_id; pts[k] = Number(s.points); maxOf[k] = Number(s.max); penaltyOf[k] = Number(s.penalty || 0); });
    const overrideOf = {}; (d.overrides || []).forEach((o) => { overrideOf[o.quiz_id + "|" + o.student_id] = Number(o.mark); });
    const statusOf = {}; (g.status || []).forEach((x) => { statusOf[x.key + "|" + x.student_id] = x; });
    const markOf = {}; (g.marks || []).forEach((m) => { markOf[m.item_id + "|" + m.student_id] = m; });
    const choiceOf = {}; (d.dup_choice || []).forEach((x) => { choiceOf[x.key + "|" + x.student_id] = x.quiz_id; });   // v33.4.4: the run chosen by hand
    const groupsOf = (ses) => ses.groups ? ses.groups : (ses.group ? [ses.group] : []);
    const inGroup = (ses, st) => {
      const gs = groupsOf(ses);
      if (!gs.length) return true;
      if (ses.kind === "td") return gs.includes(st.td_group);
      if (ses.kind === "tp") return gs.includes(st.tp_group);
      return gs.includes(st.td_group) || gs.includes(st.tp_group);
    };
    const cols = [], colOf = {};
    const graded = d.quizzes.filter((q) => q.status === "finished" && q.graded !== false && q.kind !== "survey");
    const unitOf = (q) => String(q.unit || (sessionOf[q.session_id] || {}).unit || "").toUpperCase();
    const multi = {}; graded.forEach((q) => { if (unitOf(q) && Number(q.pass_index) > 1) multi[unitOf(q)] = true; });
    graded.forEach((q) => {
      const ses = sessionOf[q.session_id] || {}, unit = unitOf(q), n = Math.max(1, Number(q.pass_index) || 1);
      const key = q.key || "q:" + (unit ? unit + "#" + n : "id|" + q.id);
      if (!colOf[key]) {
        const e = evals[key] || {};
        colOf[key] = { key, type: "quiz", kind: q.kind || "quiz", unit, cat: q.category || "", title: colTitle(q, unit, n, false, ses), date: q.date,
          scale: Number(q.total_points || 20), quizzes: [],
          counts: e.counts == null ? true : !!e.counts, part: e.component || (q.kind === "tp" || ses.kind === "tp" ? "tp" : ses.kind === "td" ? "td" : "quiz") };
        cols.push(colOf[key]);
      }
      colOf[key].quizzes.push(q);
    });
    cols.forEach((c) => {   // the type of a column: the first quiz of it that has one (the passes of the sub-groups put together)
      const withCat = c.quizzes.find((x) => x.category);
      if (withCat && !c.cat) { c.cat = withCat.category; c.title = colTitle(Object.assign({}, c.quizzes[0], { category: withCat.category }), c.unit, Math.max(1, Number(c.quizzes[0].pass_index) || 1), false, sessionOf[c.quizzes[0].session_id] || {}); }
    });
    { const seen = {}; cols.forEach((c) => { const t = c.title; seen[t] = (seen[t] || 0) + 1; if (seen[t] > 1) c.title = t + " (" + seen[t] + ")"; }); }   // v33.4.5: two columns never share a name
    // attendance by session: who came, in which pass (run)
    const came = {}, excusedIn = {};
    d.attendance.forEach((a) => {
      if (a.status === "present" || a.status === "late") (came[a.session_id + "|" + a.student_id] = came[a.session_id + "|" + a.student_id] || []).push(a.run_id == null ? null : Number(a.run_id));
      if (a.status === "excused") excusedIn[a.session_id + "|" + a.student_id] = true;
    });
    const unitSessions = {}; d.sessions.forEach((x) => { const u = String(x.unit || "").toUpperCase(); if (u) (unitSessions[u] = unitSessions[u] || []).push(x); });
    const inPass = (q, st) => { const r = came[q.session_id + "|" + st.id]; if (!r) return false; return q.run_id == null || r.some((x) => x == null || x === Number(q.run_id)); };
    (g.items || []).forEach((it) => {
      const key = "i:" + it.id, e = evals[key] || {};
      const c = { key, type: "item", kind: "typed", item: it, title: it.title, date: it.date || "", scale: Number(it.scale || 20),
        counts: e.counts == null ? true : !!e.counts, part: e.component || it.component || "exam" };
      cols.push(c); colOf[key] = c;
    });
    // v33.4.4: a student who took the same column twice: the chosen run counts, else the LAST one (never the first by chance)
    const taken = (q, st) => overrideOf[q.id + "|" + st.id] !== undefined || pts[q.id + "|" + st.id] !== undefined;
    const pickRun = (col, st) => {
      const all = col.quizzes.filter((q) => taken(q, st));
      if (!all.length) return { run: undefined, all };
      const ch = choiceOf[col.key + "|" + st.id];
      return { run: all.find((q) => q.id === ch) || all[all.length - 1], all };
    };
    // cell: { v (on the scale of the column) | null, st: mark | abs | exc | none (not his / not typed yet), quiz (the run to correct) }
    const cell = (col, st) => {
      if (col.type === "item") {
        const m = markOf[col.item.id + "|" + st.id];
        if (!m) return { v: null, st: "none" };
        if (m.status === "abs") return { v: 0, st: "abs", reason: m.reason };
        if (m.status === "exc") return { v: null, st: "exc", reason: m.reason };
        return { v: Number(m.mark), st: "mark", reason: m.reason };
      }
      const forced = statusOf[col.key + "|" + st.id];
      if (col.unit) return unitCell(col, st, forced);
      const own = col.quizzes.filter((q) => inGroup(sessionOf[q.session_id] || {}, st));
      const target = col.quizzes.find((q) => overrideOf[q.id + "|" + st.id] !== undefined || pts[q.id + "|" + st.id] !== undefined) || own[0] || col.quizzes[0];
      if (forced) return { v: forced.status === "abs" ? 0 : null, st: forced.status, forced: true, quiz: target, reason: forced.reason };
      const pk = pickRun(col, st), dups = pk.all.length > 1 ? pk.all : null;
      const corrected = pk.run && overrideOf[pk.run.id + "|" + st.id] !== undefined ? pk.run : null;
      if (corrected) return { v: overrideOf[corrected.id + "|" + st.id] * col.scale / Number(corrected.total_points || 20), st: "mark", corrected: true, quiz: corrected, dups };
      const done = pk.run && pts[pk.run.id + "|" + st.id] !== undefined ? pk.run : null;
      if (done) {
        const k = done.id + "|" + st.id, scale = Number(done.total_points || 20), max = maxOf[k] || Number(done.max_points) || 1;
        return { v: Math.max(0, (pts[k] / max) * scale - (penaltyOf[k] || 0)) * col.scale / scale, st: "mark", quiz: done, dups };
      }
      if (!own.length) return { v: null, st: "none", quiz: target };
      if (own.some((q) => att[q.session_id + "|" + st.id] === "excused")) return { v: null, st: "exc", quiz: target };
      return { v: 0, st: "abs", quiz: target };
    };
    // a column of a unit: the passes of the sub-groups put together
    const unitCell = (col, st, forced) => {
      const pk = pickRun(col, st), dups = pk.all.length > 1 ? pk.all : null;
      const corrected = pk.run && overrideOf[pk.run.id + "|" + st.id] !== undefined ? pk.run : null;
      const done = pk.run && !corrected && pts[pk.run.id + "|" + st.id] !== undefined ? pk.run : null;
      const mine = col.quizzes.filter((q) => inPass(q, st));
      const target = corrected || done || mine[0] || col.quizzes[0];
      if (forced) return { v: forced.status === "abs" ? 0 : null, st: forced.status, forced: true, quiz: target, reason: forced.reason };
      if (corrected) return { v: overrideOf[corrected.id + "|" + st.id] * col.scale / Number(corrected.total_points || 20), st: "mark", corrected: true, quiz: corrected, dups };
      if (done) {
        const k = done.id + "|" + st.id, scale = Number(done.total_points || 20), max = maxOf[k] || Number(done.max_points) || 1;
        return { v: Math.max(0, (pts[k] / max) * scale - (penaltyOf[k] || 0)) * col.scale / scale, st: "mark", quiz: done, dups };
      }
      if (mine.length) return { v: 0, st: "abs", noans: true, quiz: target };                     // checked in during the pass, no answer
      const ses = unitSessions[col.unit] || [];
      if (ses.some((x) => came[x.id + "|" + st.id])) return { v: null, st: "none", other: true, quiz: target };   // came in another pass
      if (ses.some((x) => excusedIn[x.id + "|" + st.id])) return { v: null, st: "exc", quiz: target };
      if (ses.some((x) => inGroup(x, st))) return { v: 0, st: "abs", quiz: target };             // came to no pass of the unit
      return { v: null, st: "none", quiz: target };
    };
    // v33.4.6: attendance by type. A session is held when its day has passed (or someone was checked in). The passes of a unit
    // (TP1 SG1, TP1 SG2) are ONE session for a student; a student who came in any of them is present; excused is left out.
    const today = new Date().toISOString().slice(0, 10), hasRows = {}; d.attendance.forEach((a) => { hasRows[a.session_id] = true; });
    const typeOf = (x) => (x.kind === "td" ? "td" : x.kind === "tp" ? "tp" : "course");
    const heldItems = {};
    d.sessions.filter((x) => (x.date && x.date < today) || hasRows[x.id]).forEach((x) => {
      const t = typeOf(x), u = String(x.unit || "").toUpperCase(), k = u ? t + ":U:" + u : t + ":S:" + x.id;
      (heldItems[k] = heldItems[k] || { type: t, sessions: [] }).sessions.push(x);
    });
    const attendanceOf = (st) => {
      const by = { course: { n: 0, p: 0 }, td: { n: 0, p: 0 }, tp: { n: 0, p: 0 } };
      Object.values(heldItems).forEach((it) => {
        if (!it.sessions.some((x) => inGroup(x, st))) return;                       // not his group
        if (it.sessions.some((x) => came[x.id + "|" + st.id])) { by[it.type].n++; by[it.type].p++; return; }
        if (it.sessions.some((x) => excusedIn[x.id + "|" + st.id])) return;          // excused: left out
        by[it.type].n++;
      });
      const w = S.att_w || { course: 1, td: 1, tp: 1 }, used = Object.keys(by).filter((t) => by[t].n > 0 && Number(w[t]) > 0), ws = used.reduce((a, t) => a + Number(w[t]), 0);
      const n = ws ? (used.reduce((a, t) => a + Number(w[t]) * by[t].p / by[t].n, 0) / ws) * 20 : null;
      const notes = Object.keys(by).filter((t) => by[t].n > 0).map((t) => ({ course: "Course", td: "TD", tp: "TP" }[t] + " " + by[t].p + "/" + by[t].n)).join(" · ");
      return { n, notes: notes || "no session held yet" };
    };
    const bonus = {}; (d.bonuses || []).forEach((b) => { bonus[b.student_id + "|" + b.category] = Number(b.points); });
    const bonusOf = (st) => ({ course: bonus[st.id + "|course"] || 0, td: bonus[st.id + "|td"] || 0, tp: bonus[st.id + "|tp"] || 0 });

    const sep = S.bonus_mode === "sep";
    const active = PARTS.filter((p) => S.on[p]).concat(sep ? ["bonus"] : []);
    const wSum = active.reduce((a, p) => a + Number(S.weights[p] || 0), 0);
    const compute = (st) => {
      const cells = cols.map((c) => cell(c, st)), bo = bonusOf(st), parts = {};
      PARTS.forEach((p) => {
        if (p === "attendance") { parts.attendance = attendanceOf(st); return; }   // v33.4.6
        const mine = cols.map((c, i) => ({ c, x: cells[i] })).filter(({ c }) => c.counts && c.part === p);
        const vals = mine.filter(({ x }) => x.st === "mark" || x.st === "abs").map(({ c, x }) => ({ c, n: (x.v / c.scale) * 20 })).sort((a, b) => b.n - a.n);
        const N = Number(S.best[p] || 0), kept = N ? vals.slice(0, N) : vals, dropped = N ? vals.slice(N) : [];
        let n = kept.length ? kept.reduce((a, x) => a + x.n, 0) / kept.length : null, add = 0;
        const cat = PART_OF_BONUS[p];
        if (n != null && !sep && cat && S.bonus_on[cat]) { add = Math.min(Number(S.bonus_cap), bo[cat]); n = Math.min(20, n + add); }
        const notes = [];
        if (kept.length) notes.push("mean of " + kept.length);
        const exc = mine.filter(({ x }) => x.st === "exc").map(({ c }) => c.title); if (exc.length) notes.push("excused: " + exc.join(", "));
        const abs = mine.filter(({ x }) => x.st === "abs" && !x.noans).map(({ c }) => c.title); if (abs.length) notes.push("absent (0): " + abs.join(", "));
        const noans = mine.filter(({ x }) => x.st === "abs" && x.noans).map(({ c }) => c.title); if (noans.length) notes.push("no answer (0): " + noans.join(", "));
        if (dropped.length) notes.push("left out (not in the " + N + " best): " + dropped.map((x) => x.c.title).join(", "));
        if (add) notes.push("+" + fmt(add) + " bonus");
        parts[p] = { n, notes: notes.join(" · ") || "no mark" };
      });
      const bt = (S.bonus_on.course ? bo.course : 0) + (S.bonus_on.td ? bo.td : 0) + (S.bonus_on.tp ? bo.tp : 0);
      parts.bonus = { n: Math.min(20, bt * Number(S.bonus_factor || 4)), notes: fmt(bt) + " point(s) × " + S.bonus_factor };
      const used = active.filter((p) => parts[p].n != null && Number(S.weights[p]) > 0), ws = used.reduce((a, p) => a + Number(S.weights[p]), 0);
      const raw = ws ? used.reduce((a, p) => a + Number(S.weights[p]) * parts[p].n, 0) / ws : null;
      const step = Number(S.step) > 0 ? Number(S.step) : 0.01;
      const final = raw == null ? null : r2(Math.round(raw / step) * step);
      const detail = active.map((p) => ({ part: p, label: PART_LABEL[p], weight: Number(S.weights[p]), mark: parts[p].n == null ? null : r2(parts[p].n), notes: parts[p].notes }));
      return { cells, parts, final, detail, bonus: bo };
    };
    const rows = d.students.map((st) => Object.assign({ st }, compute(st)));
    const finals = rows.map((r) => r.final).filter((x) => x != null);
    const stats = finals.length ? { mean: r2(finals.reduce((a, b) => a + b, 0) / finals.length), pass: finals.filter((x) => x >= 10).length,
      count: finals.length, min: Math.min(...finals), max: Math.max(...finals) } : null;
    const formula = "Final = " + active.map((p) => S.weights[p] + " % " + PART_LABEL[p]).join(" + ")
      + PARTS.filter((p) => S.on[p] && Number(S.best[p])).map((p) => " · " + PART_LABEL[p] + ": " + S.best[p] + " best").join("")
      + (sep ? "" : " · bonus added (at most +" + S.bonus_cap + ")") + " · rounded to " + S.step;
    return { S, cols, rows, stats, active, wSum, formula, cell, sep };
  }
  const nameOf = (q) => colTitle(q, String(q.unit || "").toUpperCase(), Math.max(1, Number(q.pass_index) || 1), false, { title: q.session });
  return { nameOf, attendanceNote: null, PARTS, PART_LABEL, CAT_LABEL, CAT_NAMES, MODELS, DEFAULTS, settings, build, fmt, r2 };
})();
