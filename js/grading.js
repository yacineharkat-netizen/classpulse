(window.CP_FILES = window.CP_FILES || {})["grading.js"] = "33.1"; // file version, checked by common.js
// v33: final mark of a class. One evaluation column = a quiz / test / TP (the same unit + title run once per sub-group
// makes ONE column, as in the Excel file), or a column typed in the app (exam, project, oral…).
// Each column counts or not, and goes into one part: quiz | tp | td | exam | project. The final mark is
// the weighted mean of the parts (out of 20), with the bonus added to its part (capped) or as a part of its own.
const GRADE = (() => {
  const PARTS = ["exam", "project", "tp", "td", "quiz"];
  const PART_LABEL = { exam: "Exam", project: "Project", tp: "TP", td: "TD", quiz: "Quizzes and tests", bonus: "Bonus" };
  const PART_OF_BONUS = { quiz: "course", tp: "tp", td: "td" };   // bonus category added to each part
  const MODELS = {
    td: { label: "With TD", weights: { exam: 50, project: 15, tp: 15, td: 10, quiz: 10 }, on: { exam: true, project: true, tp: true, td: true, quiz: true } },
    notd: { label: "Without TD", weights: { exam: 50, project: 20, tp: 20, td: 0, quiz: 10 }, on: { exam: true, project: true, tp: true, td: false, quiz: true } },
    noexam: { label: "Without exam", weights: { exam: 0, project: 40, tp: 40, td: 0, quiz: 20 }, on: { exam: false, project: true, tp: true, td: false, quiz: true } },
  };
  const DEFAULTS = {
    model: "notd", weights: { exam: 50, project: 20, tp: 20, td: 0, quiz: 10, bonus: 5 }, on: { exam: true, project: true, tp: true, td: false, quiz: true },
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
    const groupsOf = (ses) => ses.groups ? ses.groups : (ses.group ? [ses.group] : []);
    const inGroup = (ses, st) => {
      const gs = groupsOf(ses);
      if (!gs.length) return true;
      if (ses.kind === "td") return gs.includes(st.td_group);
      if (ses.kind === "tp") return gs.includes(st.tp_group);
      return gs.includes(st.td_group) || gs.includes(st.tp_group);
    };
    const cols = [], colOf = {};
    d.quizzes.filter((q) => q.status === "finished" && q.graded !== false && q.kind !== "survey").forEach((q) => {
      const ses = sessionOf[q.session_id] || {};
      const key = "q:" + (ses.unit ? ses.unit + "|" + q.title : "id|" + q.id);
      if (!colOf[key]) {
        const e = evals[key] || {};
        colOf[key] = { key, type: "quiz", kind: q.kind || "quiz", title: (ses.unit ? ses.unit + " " : "") + q.title, date: q.date,
          scale: Number(q.total_points || 20), quizzes: [],
          counts: e.counts == null ? true : !!e.counts, part: e.component || (q.kind === "tp" ? "tp" : "quiz") };
        cols.push(colOf[key]);
      }
      colOf[key].quizzes.push(q);
    });
    (g.items || []).forEach((it) => {
      const key = "i:" + it.id, e = evals[key] || {};
      const c = { key, type: "item", kind: "typed", item: it, title: it.title, date: it.date || "", scale: Number(it.scale || 20),
        counts: e.counts == null ? true : !!e.counts, part: e.component || it.component || "exam" };
      cols.push(c); colOf[key] = c;
    });
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
      const own = col.quizzes.filter((q) => inGroup(sessionOf[q.session_id] || {}, st));
      const target = col.quizzes.find((q) => overrideOf[q.id + "|" + st.id] !== undefined || pts[q.id + "|" + st.id] !== undefined) || own[0] || col.quizzes[0];
      if (forced) return { v: forced.status === "abs" ? 0 : null, st: forced.status, forced: true, quiz: target, reason: forced.reason };
      const corrected = col.quizzes.find((q) => overrideOf[q.id + "|" + st.id] !== undefined);
      if (corrected) return { v: overrideOf[corrected.id + "|" + st.id] * col.scale / Number(corrected.total_points || 20), st: "mark", corrected: true, quiz: corrected };
      const done = col.quizzes.find((q) => pts[q.id + "|" + st.id] !== undefined);
      if (done) {
        const k = done.id + "|" + st.id, scale = Number(done.total_points || 20), max = maxOf[k] || Number(done.max_points) || 1;
        return { v: Math.max(0, (pts[k] / max) * scale - (penaltyOf[k] || 0)) * col.scale / scale, st: "mark", quiz: done };
      }
      if (!own.length) return { v: null, st: "none", quiz: target };
      if (own.some((q) => att[q.session_id + "|" + st.id] === "excused")) return { v: null, st: "exc", quiz: target };
      return { v: 0, st: "abs", quiz: target };
    };
    const bonus = {}; (d.bonuses || []).forEach((b) => { bonus[b.student_id + "|" + b.category] = Number(b.points); });
    const bonusOf = (st) => ({ course: bonus[st.id + "|course"] || 0, td: bonus[st.id + "|td"] || 0, tp: bonus[st.id + "|tp"] || 0 });

    const sep = S.bonus_mode === "sep";
    const active = PARTS.filter((p) => S.on[p]).concat(sep ? ["bonus"] : []);
    const wSum = active.reduce((a, p) => a + Number(S.weights[p] || 0), 0);
    const compute = (st) => {
      const cells = cols.map((c) => cell(c, st)), bo = bonusOf(st), parts = {};
      PARTS.forEach((p) => {
        const mine = cols.map((c, i) => ({ c, x: cells[i] })).filter(({ c }) => c.counts && c.part === p);
        const vals = mine.filter(({ x }) => x.st === "mark" || x.st === "abs").map(({ c, x }) => ({ c, n: (x.v / c.scale) * 20 })).sort((a, b) => b.n - a.n);
        const N = Number(S.best[p] || 0), kept = N ? vals.slice(0, N) : vals, dropped = N ? vals.slice(N) : [];
        let n = kept.length ? kept.reduce((a, x) => a + x.n, 0) / kept.length : null, add = 0;
        const cat = PART_OF_BONUS[p];
        if (n != null && !sep && cat && S.bonus_on[cat]) { add = Math.min(Number(S.bonus_cap), bo[cat]); n = Math.min(20, n + add); }
        const notes = [];
        if (kept.length) notes.push("mean of " + kept.length);
        const exc = mine.filter(({ x }) => x.st === "exc").map(({ c }) => c.title); if (exc.length) notes.push("excused: " + exc.join(", "));
        const abs = mine.filter(({ x }) => x.st === "abs").map(({ c }) => c.title); if (abs.length) notes.push("absent (0): " + abs.join(", "));
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
  return { PARTS, PART_LABEL, MODELS, DEFAULTS, settings, build, fmt, r2 };
})();
