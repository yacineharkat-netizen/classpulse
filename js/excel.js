// ClassPulse - reading and writing Excel files (SheetJS library).
(window.CP_FILES = window.CP_FILES || {})["excel.js"] = "25"; // file version, checked by common.js

// Read the first sheet of a file as an array of objects, with normalised column names.
async function readSheet(file) {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: "array" });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: false });
  return rows.map((row) => {
    const out = {};
    for (const [k, v] of Object.entries(row)) out[normaliseHeader(k)] = String(v).trim();
    return out;
  });
}

function normaliseHeader(h) {
  return String(h).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

// ---- Student lists: any workbook, any sheet, any column layout ----

// Read every sheet of a workbook as arrays of rows (array of arrays of strings).
async function readWorkbookGrid(file) {
  const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
  const sheets = {};
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws["!ref"]) { sheets[name] = []; continue; }
    // Start at A1 and keep blank lines, so line numbers and column letters match the spreadsheet.
    const range = XLSX.utils.decode_range(ws["!ref"]);
    range.s.r = 0; range.s.c = 0;
    sheets[name] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "", raw: false, blankrows: true, range })
      .map((row) => row.map((v) => String(v).trim()));
  }
  return { names: wb.SheetNames, sheets };
}

const STUDENT_HEADER_WORDS = {
  matricule: ["matricule", "mat", "matr", "student_number", "numero", "num", "n_inscription", "numero_inscription", "id"],
  last_name: ["nom", "last_name", "lastname", "surname", "nom_etudiant", "name", "nom_et_prenom", "nom_prenom"],
  first_name: ["prenom", "first_name", "firstname", "prenoms"],
  td_group: ["td", "groupe_td", "td_group", "groupe", "group", "gr", "grp"],
  tp_group: ["tp", "groupe_tp", "tp_group", "sous_groupe", "sous_groupe_tp", "sg", "subgroup"],
  email: ["email", "e_mail", "e_mails", "emails", "mail", "mails", "courriel", "adresse_mail", "adresse_email"],
};

// Which role (matricule / last_name / first_name) a header cell plays, or null.
function studentHeaderRole(cell) {
  const h = normaliseHeader(cell);
  if (!h) return null;
  for (const [role, words] of Object.entries(STUDENT_HEADER_WORDS)) if (words.includes(h)) return role;
  if (h.startsWith("matric")) return "matricule";
  if (h.includes("mail") || h.startsWith("courriel")) return "email";
  if (h.startsWith("sous_groupe") || h.startsWith("tp_") || h.startsWith("groupe_tp")) return "tp_group";
  if (h.startsWith("groupe") || h.startsWith("td_")) return "td_group";
  if (h.startsWith("prenom")) return "first_name";
  if (h.startsWith("nom")) return "last_name";
  return null;
}

// Find the header line (0-based) in the first 30 lines and the columns of the three fields.
// v25: a column named exactly "Matricule" wins over "Numero inscription", "N°"... placed before it.
function studentColumnsOf(row) {
  const cols = {};
  row.forEach((cell, c) => { const role = studentHeaderRole(cell); if (role && cols[role] === undefined) cols[role] = c; });
  const exact = row.findIndex((cell) => normaliseHeader(cell).startsWith("matric"));
  if (exact >= 0) cols.matricule = exact;
  return cols;
}
function detectStudentColumns(grid) {
  let best = { row: 0, score: -1, cols: {} };
  grid.slice(0, 30).forEach((row, r) => {
    const cols = studentColumnsOf(row);
    const score = Object.keys(cols).length;
    if (score > best.score) best = { row: r, score, cols };
  });
  return { headerRow: best.row, cols: best.cols };
}

// Build the student list from a grid, a header line and the chosen columns (-1 = none).
// The group columns are optional: when one is not chosen, the groups already in the class are kept.
function studentsFromGrid(grid, headerRow, colMat, colLast, colFirst, colTd, colTp, colMail) {
  const seen = new Set();
  const out = [];
  for (const row of grid.slice(headerRow + 1)) {
    const matricule = (row[colMat] || "").replace(/\s+/g, "");
    if (!matricule || seen.has(matricule)) continue;
    seen.add(matricule);
    const st = {
      matricule,
      last_name: colLast >= 0 ? row[colLast] || "" : "",
      first_name: colFirst >= 0 ? row[colFirst] || "" : "",
    };
    if (colTd >= 0) st.td_group = row[colTd] || "";
    if (colTp >= 0) st.tp_group = row[colTp] || "";
    if (colMail >= 0) st.email = String(row[colMail] || "").trim().toLowerCase();
    out.push(st);
  }
  return out;
}

// Accepts English or French column names.
function parseStudents(rows) {
  const pick = (r, names) => { for (const n of names) if (r[n]) return r[n]; return ""; };
  return rows.map((r) => ({
    matricule: pick(r, ["matricule", "student_number", "id", "numero"]),
    last_name: pick(r, ["last_name", "nom", "name"]),
    first_name: pick(r, ["first_name", "prenom", "firstname"]),
  })).filter((s) => s.matricule);
}

// Template columns: ref | chapter | question | A | B | C | D | E | correct | points | time_s
// Numbers typed in French or English: "2,24" or "2.24".
function num(x) { return typeof x === "number" ? x : parseFloat(String(x).trim().replace(",", ".")); }

// "3" -> {value: 3}; "10..40" or "10 to 40" -> {min: 10, max: 40}; "1:2; 2:2,24" -> {variants: {"1": 2, "2": 2.24}}
function parseNumericAnswer(answer) {
  if (answer === undefined || answer === null || answer === "") return null;
  if (typeof answer === "number") return { value: answer };
  const t = String(answer).trim();
  if (t.includes(":")) {
    const variants = {};
    for (const part of t.split(/[;\n]+/).map((x) => x.trim()).filter(Boolean)) {
      const [k, v] = part.split(":").map((x) => x.trim());
      if (!/^\d+$/.test(k) || isNaN(num(v))) return null;
      variants[k] = num(v);
    }
    return Object.keys(variants).length ? { variants } : null;
  }
  const m = t.match(/^(-?[\d.,]+)\s*(?:\.\.|to|à|a)\s*(-?[\d.,]+)$/i);
  if (m) { const lo = num(m[1]), hi = num(m[2]); return isNaN(lo) || isNaN(hi) ? null : { min: Math.min(lo, hi), max: Math.max(lo, hi) }; }
  return isNaN(num(t)) ? null : { value: num(t) };
}

function parseQuestions(rows) {
  const problems = [];
  const out = [];
  const surveys = [];
  rows.forEach((r, i) => {
    const line = i + 2; // Excel line number (line 1 = headers)
    const text = r.question || r.text || "";
    if (!text) return;
    if (/^(number|numeric|nombre)$/i.test(String(r.type || "").trim())) {
      const spec = parseNumericAnswer(r.answer);
      if (!spec) { problems.push(`line ${line}: numeric question: "answer" must be a value (3.0), a range (10..40) or one value per board (1:2; 2:2.24)`); return; }
      out.push({ ref: r.ref || `Q${line}`, chapter: r.chapter || "", text, qtype: "number", num_spec: spec,
        tolerance: r.tolerance === undefined || r.tolerance === "" ? 5 : num(r.tolerance), unit: String(r.unit || ""),
        points: Number(r.points) || 1, time_limit: Number(r.time_s || r.time_limit) || 30 });
      return;
    }
    const options = ["a", "b", "c", "d", "e", "f", "g", "h"].map((k) => r[k]).filter((v) => v !== undefined && v !== "");
    const correct = String(r.correct || "").toUpperCase().split(/[^A-H]+/).filter(Boolean).map((l) => "ABCDEFGH".indexOf(l));
    if (options.length < 2) problems.push(`line ${line}: at least 2 options needed`);
    else if (correct.some((c) => c < 0 || c >= options.length)) problems.push(`line ${line}: "correct" must use the letters of existing options`);
    else {
      if (correct.length === 0) surveys.push(r.ref || `line ${line}`);
      out.push({
        ref: r.ref || `Q${line}`, chapter: r.chapter || "", text, options, correct,
        points: Number(r.points) || 1, time_limit: Number(r.time_s || r.time_limit) || 30,
      });
    }
  });
  return { questions: out, problems, surveys };
}

// Build and download the results workbook from the t_export data.
function downloadResults(exp) {
  const KIND = { course: "Course", td: "TD", tp: "TP" };
  const statusLetter = { present: "P", late: "L", absent: "A", excused: "E" };
  const att = {};
  exp.attendance.forEach((a) => { att[a.session_id + "|" + a.student_id] = a.status; });
  const pts = {}, maxOf = {}, penaltyOf = {}, boardOf = {};
  exp.scores.forEach((s) => {
    const k = s.quiz_id + "|" + s.student_id;
    pts[k] = Number(s.points); maxOf[k] = Number(s.max);
    penaltyOf[k] = Number(s.penalty || 0);                       // v25: board corrected by the teacher, penalty on the quiz scale
    if (s.board_used != null) boardOf[k] = { from: s.board_declared, to: s.board_used, penalty: Number(s.penalty || 0) };
  });
  const sessionLabel = (s) => `${s.date}${s.time ? " " + s.time : ""} ${KIND[s.kind] || ""} ${s.title}`.replace(/\s+/g, " ");

  // v24: groups. A session may be for one TD group / TP sub-group; the sessions of the same unit (e.g. TP1,
  // run once per sub-group) make ONE column. A student allowed in another group counts as present (catch-up).
  const sessionOf = {};
  exp.sessions.forEach((x) => { sessionOf[x.id] = x; });
  // v25: a session has the groups of its attendance runs (one session for all the sub-groups of a lab); [] = whole class
  const groupsOf = (ses) => ses.groups ? ses.groups : (ses.group ? [ses.group] : []);
  const inGroup = (ses, st) => {
    const gs = groupsOf(ses);
    if (!gs.length) return true;
    if (ses.kind === "td") return gs.includes(st.td_group);
    if (ses.kind === "tp") return gs.includes(st.tp_group);
    return gs.includes(st.td_group) || gs.includes(st.tp_group);
  };
  const present = (ses, st) => { const v = att[ses.id + "|" + st.id]; return v === "present" || v === "late"; };
  const columns = [];                       // [{ label, sessions: [...] }]
  const columnOf = {};
  exp.sessions.forEach((x) => {
    const key = x.unit ? x.kind + "|" + x.unit : "id|" + x.id;
    if (!columnOf[key]) {
      columnOf[key] = { label: x.unit ? (x.unit.toUpperCase().startsWith((KIND[x.kind] || "?").toUpperCase()) ? x.unit : `${KIND[x.kind] || ""} ${x.unit}`.trim()) : sessionLabel(x) + (groupsOf(x).length ? ` [${groupsOf(x).join(", ")}]` : ""), sessions: [] };
      columns.push(columnOf[key]);
    }
    columnOf[key].sessions.push(x);
  });
  const attendanceCell = (col, st) => {
    const own = col.sessions.filter((x) => inGroup(x, st));
    const ownPresent = own.find((x) => present(x, st));
    if (ownPresent) return statusLetter[att[ownPresent.id + "|" + st.id]];
    const other = col.sessions.find((x) => !inGroup(x, st) && present(x, st));
    if (other) return `P (with ${groupsOf(other).join(", ") || "another group"})`;
    if (own.some((x) => att[x.id + "|" + st.id] === "excused")) return "E";
    return own.length ? "A" : "-";
  };

  // Sheet 1: attendance, one column per session or per unit
  const attRows = [["Matricule", "Last name", "First name", "TD group", "TP group", "E-mail", "In official list", ...columns.map((c) => c.label), "Present", "Absent (unexcused)"]];
  exp.students.forEach((st) => {
    const cells = columns.map((c) => attendanceCell(c, st));
    attRows.push([st.matricule, st.last_name, st.first_name, st.td_group || "", st.tp_group || "", st.email || "", st.official ? "yes" : "NO",
      ...cells, cells.filter((c) => c[0] === "P" || c === "L").length, cells.filter((c) => c === "A").length]);
  });

  // Marks, one sheet per type of evaluation. Each cell is the mark on the scale of the quiz (e.g. /5);
  // the averages are computed on /20. Absent = 0; excused = EXC (ignored); not in the group of the quiz = empty (ignored).
  const finished = exp.quizzes.filter((q) => q.status === "finished" && q.graded !== false && q.kind !== "survey");
  const markSheet = (kind, dropLowest) => {
    const list = finished.filter((q) => (q.kind || "quiz") === kind);
    const groups = [], groupOf = {};          // the same test run once per sub-group = one column
    list.forEach((q) => {
      const ses = sessionOf[q.session_id] || {};
      const key = ses.unit ? ses.unit + "|" + q.title : "id|" + q.id;
      if (!groupOf[key]) {
        groupOf[key] = { label: (ses.unit ? `${ses.unit} ${q.title}` : `${q.date}${q.time ? " " + q.time : ""} ${q.title}`) + ` (/${Number(q.total_points || 20)})`, quizzes: [] };
        groups.push(groupOf[key]);
      }
      groupOf[key].quizzes.push(q);
    });
    const head = ["Matricule", "Last name", "First name", ...groups.map((g) => g.label)];
    if (dropLowest) head.push(`Average /20 (without the ${dropLowest} lowest)`);
    head.push("Average /20 (all)");
    const rows = [head];
    exp.students.forEach((st) => {
      const on20 = [];
      const cells = groups.map((g) => {
        const done = g.quizzes.find((q) => pts[q.id + "|" + st.id] !== undefined);
        if (done) {
          const key = done.id + "|" + st.id, scale = Number(done.total_points || 20);
          const max = maxOf[key] || Number(done.max_points) || 1;
          const mark = Math.max(0, (pts[key] / max) * scale - (penaltyOf[key] || 0));   // v25: penalty of a board correction
          on20.push((mark / scale) * 20);
          return Math.round(mark * 100) / 100;
        }
        const own = g.quizzes.filter((q) => inGroup(sessionOf[q.session_id] || {}, st));
        if (!own.length) return "";                                             // this test was not for his group
        if (own.some((q) => att[q.session_id + "|" + st.id] === "excused")) return "EXC";
        on20.push(0); return 0;
      });
      const sorted = on20.slice().sort((x, y) => x - y);
      const kept = sorted.slice(Math.min(dropLowest, Math.max(0, sorted.length - 1)));
      const avg = (arr) => (arr.length ? Math.round((arr.reduce((x, y) => x + y, 0) / arr.length) * 100) / 100 : "");
      rows.push([st.matricule, st.last_name, st.first_name, ...cells, ...(dropLowest ? [avg(kept)] : []), avg(on20)]);
    });
    return { rows, count: groups.length };
  };
  const quizSheet = markSheet("quiz", CONFIG.dropLowest);
  const testSheet = markSheet("test", 0);
  const tpSheet = markSheet("tp", 0);

  // Bonus points by category
  const bonus = {};
  (exp.bonuses || []).forEach((b) => { bonus[b.student_id + "|" + b.category] = Number(b.points); });
  const bRows = [["Matricule", "Last name", "First name", "Bonus course", "Bonus TD", "Bonus TP", "Total"]];
  exp.students.forEach((st) => {
    const v = ["course", "td", "tp"].map((c) => bonus[st.id + "|" + c] || 0);
    bRows.push([st.matricule, st.last_name, st.first_name, ...v, v.reduce((x, y) => x + y, 0)]);
  });

  // Questions (success rates)
  const qRows = [["Quiz", "Ref", "Question", "Answers", "Full marks", "Success rate %", "Average score %"]];
  exp.question_stats.forEach((q) => qRows.push([q.quiz, q.ref, q.text, q.answers, q.full_marks,
    q.answers ? Math.round((100 * q.full_marks) / q.answers) : "", q.avg_score == null ? "" : Number(q.avg_score)]));

  // Surveys: percentage of each option (anonymous)
  const sRows = [["Date", "Survey", "Question", "Answers", "Option", "Count", "%"]];
  (exp.surveys || []).forEach((q) => q.options.forEach((o, i) => sRows.push([q.date, q.quiz, i === 0 ? q.question : "", i === 0 ? q.answers : "",
    o, q.counts[i], q.answers ? Math.round((100 * q.counts[i]) / q.answers) : 0])));

  // Students who left a quiz screen
  const nameOf = {};
  exp.students.forEach((s) => { nameOf[s.id] = s; });
  const quizTitle = {};
  exp.quizzes.forEach((q) => { quizTitle[q.id] = `${q.date} ${q.title}`; });
  const lRows = [["Matricule", "Last name", "First name", "Quiz", "Times left the screen"]];
  exp.leaves.forEach((l) => { const s = nameOf[l.student_id] || {}; lRows.push([s.matricule, s.last_name, s.first_name, quizTitle[l.quiz_id], l.leaves]); });

  // v25: boards corrected by the teacher (the marks of the TP sheet already include them)
  const bfRows = [["Matricule", "Last name", "First name", "Test", "Board typed", "Board used for the mark", "Penalty (points of the test scale)"]];
  Object.entries(boardOf).forEach(([k, b]) => {
    const [quizId, studentId] = k.split("|"); const s = nameOf[studentId] || {};
    bfRows.push([s.matricule, s.last_name, s.first_name, quizTitle[quizId], b.from, b.to, b.penalty]);
  });

  const wb = XLSX.utils.book_new();
  const add = (rows, name, widths) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = widths.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  add(attRows, "Attendance", [12, 18, 16, 9, 9, 28, 10, ...columns.map(() => 16), 9, 12]);
  add(quizSheet.rows, "Course quizzes", [12, 18, 16, ...Array(quizSheet.count).fill(16), 18, 12]);
  add(testSheet.rows, "Tests", [12, 18, 16, ...Array(testSheet.count).fill(16), 12]);
  add(tpSheet.rows, "TP tests", [12, 18, 16, ...Array(tpSheet.count).fill(16), 12]);
  add(bRows, "Bonus", [12, 18, 16, 12, 10, 10, 8]);
  add(qRows, "Questions", [22, 8, 60, 9, 10, 12, 14]);
  add(sRows, "Surveys", [11, 24, 50, 9, 30, 8, 6]);
  add(lRows, "Left the quiz", [12, 18, 16, 26, 12]);
  if (bfRows.length > 1) add(bfRows, "Board corrections", [12, 18, 16, 26, 12, 22, 22]);
  const safe = exp.class.name.replace(/[^\w-]+/g, "_");
  XLSX.writeFile(wb, `ClassPulse_${safe}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
