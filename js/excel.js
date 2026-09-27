// ClassPulse - reading and writing Excel files (SheetJS library).

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
};

// Which role (matricule / last_name / first_name) a header cell plays, or null.
function studentHeaderRole(cell) {
  const h = normaliseHeader(cell);
  if (!h) return null;
  for (const [role, words] of Object.entries(STUDENT_HEADER_WORDS)) if (words.includes(h)) return role;
  if (h.startsWith("matric")) return "matricule";
  if (h.startsWith("prenom")) return "first_name";
  if (h.startsWith("nom")) return "last_name";
  return null;
}

// Find the header line (0-based) in the first 30 lines and the columns of the three fields.
function detectStudentColumns(grid) {
  let best = { row: 0, score: -1, cols: {} };
  grid.slice(0, 30).forEach((row, r) => {
    const cols = {};
    row.forEach((cell, c) => { const role = studentHeaderRole(cell); if (role && cols[role] === undefined) cols[role] = c; });
    const score = Object.keys(cols).length;
    if (score > best.score) best = { row: r, score, cols };
  });
  return { headerRow: best.row, cols: best.cols };
}

// Build the student list from a grid, a header line and the chosen columns (-1 = none).
function studentsFromGrid(grid, headerRow, colMat, colLast, colFirst) {
  const seen = new Set();
  const out = [];
  for (const row of grid.slice(headerRow + 1)) {
    const matricule = (row[colMat] || "").replace(/\s+/g, "");
    if (!matricule || seen.has(matricule)) continue;
    seen.add(matricule);
    out.push({
      matricule,
      last_name: colLast >= 0 ? row[colLast] || "" : "",
      first_name: colFirst >= 0 ? row[colFirst] || "" : "",
    });
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
function parseQuestions(rows) {
  const problems = [];
  const out = [];
  rows.forEach((r, i) => {
    const line = i + 2; // Excel line number (line 1 = headers)
    const text = r.question || r.text || "";
    if (!text) return;
    const options = ["a", "b", "c", "d", "e"].map((k) => r[k]).filter((v) => v !== undefined && v !== "");
    const correct = String(r.correct || "").toUpperCase().split(/[^A-E]+/).filter(Boolean).map((l) => "ABCDE".indexOf(l));
    if (options.length < 2) problems.push(`line ${line}: at least 2 options needed`);
    else if (correct.length === 0 || correct.some((c) => c < 0 || c >= options.length)) problems.push(`line ${line}: "correct" must use the letters of existing options`);
    else out.push({
      ref: r.ref || `Q${line}`, chapter: r.chapter || "", text, options, correct,
      points: Number(r.points) || 1, time_limit: Number(r.time_s || r.time_limit) || 30,
    });
  });
  return { questions: out, problems };
}

// Build and download the results workbook from the t_export data.
function downloadResults(exp) {
  const statusLetter = { present: "P", late: "L", absent: "A", excused: "E" };
  const att = {};
  exp.attendance.forEach((a) => { att[a.session_id + "|" + a.student_id] = a.status; });
  const pts = {};
  exp.scores.forEach((s) => { pts[s.quiz_id + "|" + s.student_id] = Number(s.points); });
  const sessionOfQuiz = {};
  exp.quizzes.forEach((q) => { sessionOfQuiz[q.id] = q.session_id; });

  // Sheet 1: attendance
  const attRows = [["Matricule", "Last name", "First name", "In official list",
    ...exp.sessions.map((s) => `${s.date} ${s.title}`), "Present", "Absent (unexcused)"]];
  exp.students.forEach((st) => {
    const cells = exp.sessions.map((s) => statusLetter[att[s.id + "|" + st.id]] || "A");
    attRows.push([st.matricule, st.last_name, st.first_name, st.official ? "yes" : "NO",
      ...cells, cells.filter((c) => c === "P" || c === "L").length, cells.filter((c) => c === "A").length]);
  });

  // Sheet 2: quiz marks /20. Absent = 0 (the dropped lowest marks absorb occasional absences).
  const finished = exp.quizzes.filter((q) => q.status === "finished" && Number(q.max_points) > 0);
  const markRows = [["Matricule", "Last name", "First name", ...finished.map((q) => `${q.date} ${q.title}`),
    `Average /20 (without the ${CONFIG.dropLowest} lowest)`, "Average /20 (all)"]];
  exp.students.forEach((st) => {
    const marks = finished.map((q) => {
      const p = pts[q.id + "|" + st.id];
      const status = att[q.session_id + "|" + st.id];
      if (p === undefined) return status === "excused" ? "EXC" : 0;
      return Math.round((p / Number(q.max_points)) * 20 * 100) / 100;
    });
    const numeric = marks.filter((m) => typeof m === "number");
    const sorted = numeric.slice().sort((a, b) => a - b);
    const kept = sorted.slice(Math.min(CONFIG.dropLowest, Math.max(0, sorted.length - 1)));
    const avg = (arr) => (arr.length ? Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 100) / 100 : "");
    markRows.push([st.matricule, st.last_name, st.first_name, ...marks, avg(kept), avg(numeric)]);
  });

  // Sheet 3: questions
  const qRows = [["Quiz", "Ref", "Question", "Answers", "Full marks", "Success rate %", "Average score %"]];
  exp.question_stats.forEach((q) => qRows.push([q.quiz, q.ref, q.text, q.answers, q.full_marks,
    q.answers ? Math.round((100 * q.full_marks) / q.answers) : "", q.avg_score == null ? "" : Number(q.avg_score)]));

  // Sheet 4: students who left a quiz screen
  const nameOf = {};
  exp.students.forEach((s) => { nameOf[s.id] = s; });
  const quizTitle = {};
  exp.quizzes.forEach((q) => { quizTitle[q.id] = `${q.date} ${q.title}`; });
  const lRows = [["Matricule", "Last name", "First name", "Quiz", "Times left the screen"]];
  exp.leaves.forEach((l) => { const s = nameOf[l.student_id] || {}; lRows.push([s.matricule, s.last_name, s.first_name, quizTitle[l.quiz_id], l.leaves]); });

  const wb = XLSX.utils.book_new();
  const add = (rows, name, widths) => {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = widths.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  };
  add(attRows, "Attendance", [12, 18, 16, 10, ...exp.sessions.map(() => 14), 9, 12]);
  add(markRows, "Quiz marks", [12, 18, 16, ...finished.map(() => 14), 18, 12]);
  add(qRows, "Questions", [22, 8, 60, 9, 10, 12, 14]);
  add(lRows, "Left the quiz", [12, 18, 16, 26, 12]);
  const safe = exp.class.name.replace(/[^\w-]+/g, "_");
  XLSX.writeFile(wb, `ClassPulse_${safe}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
