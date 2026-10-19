// ClassPulse v32 - timetable logic shared by the teacher console and the student pages (no page access here):
// weeks A/B, the sessions of a date (with the changes: cancelled, moved, added), the next session, the calendar file (.ics),
// reading a DeptDesk "timetable-exchange v1" file or the DeptDesk Excel template, writing the usual Excel grid.
// The Excel and exchange code comes from DeptDesk 2.2 (timetable-excel.js, exchange.js), renamed inside the TT object.
(window.CP_FILES = window.CP_FILES || {})["timetable.js"] = "32.1"; // file version, checked by common.js

const TT = {
  KIND: { course: "Course", td: "TD", tp: "TP" },
  STATUS: { cancelled: "cancelled", moved: "moved", moved_in: "moved here", added: "extra session" },

  // ------------------------------------------------------------------ dates (Algiers: UTC+1, no summer time)
  now() { const d = new Date(Date.now() + 3600000); return { date: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() }; },
  saturdayOf(iso) { return TTV.addDays(iso, -TTV.todayIndex(iso)); },
  weekOf(tt, iso) { const sat = TT.saturdayOf(iso); return (tt.weeks || []).find((w) => w.week_start === sat) || null; },
  // the week shown first (this week, or the next teaching week)
  weekChoice(tt, today) {
    const r = TTV.weekChoice((tt.weeks || []).map((w) => ({ week_start: w.week_start, kind: w.kind, no: w.no, parity: w.parity })), today);
    if (!r.parity && (tt.slots || []).some((s) => s.parity !== "all")) return { parity: "A", label: "", unknown: true };
    return r;
  },
  dayLabel(iso) { return new Date(iso + "T12:00:00Z").toLocaleDateString([], { weekday: "long", day: "2-digit", month: "short", timeZone: "UTC" }); },
  shortDay(iso) { return new Date(iso + "T12:00:00Z").toLocaleDateString([], { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" }); },
  plusMin(t, m) { return TTV.clock(TTV.min(t) + m); },
  label(s) { return `${s.module} · ${TTV.kindLabel(s)}`; },

  // ------------------------------------------------------------------ who sees what
  // a student: the whole-section sessions, his TD group and his TP sub-group
  forGroups(td, tp) { return (s) => !s.target || s.target === td || s.target === tp; },
  forModule(m) { return (s) => s.module === m; },

  // ------------------------------------------------------------------ the sessions of a date
  // Weekly slots of that weekday (in the semester, right parity), then the changes of the date applied.
  occurrencesOn(tt, iso, filter) {
    const di = TTV.todayIndex(iso), ok = (s) => !filter || filter(s);
    const hasWeeks = (tt.weeks || []).length > 0, w = TT.weekOf(tt, iso);
    const inSemester = !hasWeeks || !!w;
    const teaching = !hasWeeks || (w && w.kind === "teaching");
    const parity = w ? w.parity : null;
    const exc = tt.exceptions || [], out = [];
    if (teaching && inSemester) {
      (tt.slots || []).filter((s) => s.day === di && ok(s) && (!s.valid_from || s.valid_from <= iso) && (!s.valid_to || iso <= s.valid_to)
        && (s.parity === "all" || !parity || s.parity === parity)).forEach((s) => {
        const e = exc.find((x) => x.slot === s.id && x.day === iso && x.action !== "added");
        out.push(Object.assign({}, s, { date: iso, status: e ? e.action : "normal", reason: e ? e.reason : "", change: e || null,
          unsure: !parity && s.parity !== "all" }));
      });
    }
    exc.filter((e) => e.action === "moved" && (e.to_day || e.day) === iso).forEach((e) => {
      const s = (tt.slots || []).find((x) => x.id === e.slot);
      if (!s || !ok(s)) return;
      const len = TTV.min(s.ends) - TTV.min(s.starts), st = e.to_start || s.starts;
      out.push(Object.assign({}, s, { date: iso, starts: st, ends: e.to_end || TT.plusMin(st, len), room: e.to_room || s.room, status: "moved_in", reason: e.reason, change: e }));
    });
    exc.filter((e) => e.action === "added" && e.day === iso).forEach((e) => {
      const same = (tt.slots || []).find((x) => x.module === e.module) || {};
      const s = { id: null, module: e.module, module_name: same.module_name || "", color: same.color || "", kind: e.kind, target: e.target || "", day: di,
        starts: e.starts, ends: e.ends, parity: "all", room: e.room, teacher: same.teacher || "" };
      if (ok(s)) out.push(Object.assign(s, { date: iso, status: "added", reason: e.reason, change: e }));
    });
    return out.sort((a, b) => TTV.min(a.starts) - TTV.min(b.starts));
  },
  // every session from a date over n days
  upcoming(tt, filter, fromIso, days) {
    const out = [];
    for (let i = 0; i < days; i++) TT.occurrencesOn(tt, TTV.addDays(fromIso, i), filter).forEach((o) => out.push(o));
    return out;
  },
  // the next session that takes place (today: not finished yet)
  next(tt, filter, now, horizon) {
    for (let i = 0; i < (horizon || 21); i++) {
      const iso = TTV.addDays(now.date, i);
      const o = TT.occurrencesOn(tt, iso, filter).find((x) => x.status !== "cancelled" && x.status !== "moved" && (i > 0 || TTV.min(x.ends) > now.min));
      if (o) return o;
    }
    return null;
  },
  // the changes (cancelled, moved, extra) from a date over n days, for these sessions
  changes(tt, filter, fromIso, days) {
    return TT.upcoming(tt, filter, fromIso, days).filter((o) => o.status !== "normal");
  },
  occText(o) {
    const what = `${TT.label(o)} · ${TTV.hm(o.starts)}–${TTV.hm(o.ends)}${o.room ? " · " + o.room : ""}`;
    if (o.status === "cancelled") return `${what} — cancelled${o.reason ? " (" + o.reason + ")" : ""}`;
    if (o.status === "moved") return `${what} — moved to ${TT.shortDay(o.change.to_day || o.date)} ${TTV.hm(o.change.to_start)}${o.change.to_room ? ", " + o.change.to_room : ""}`;
    if (o.status === "moved_in") return `${what} — moved from ${TT.shortDay(o.change.day)}`;
    if (o.status === "added") return `${what} — extra session${o.reason ? " (" + o.reason + ")" : ""}`;
    return what;
  },
  occHtml(o, withDay) {
    return `<div class="tt-occ ${o.status}">${withDay ? `<span class="d">${esc(TT.shortDay(o.date))}</span>` : ""}<span class="t">${esc(TTV.hm(o.starts))}–${esc(TTV.hm(o.ends))}</span>
      <span class="w"><strong>${esc(o.module)}</strong> · ${esc(TTV.kindLabel(o))}${o.room ? " · " + esc(o.room) : ""}${o.teacher ? " · " + esc(o.teacher) : ""}</span>
      ${o.status !== "normal" ? `<span class="badge ${o.status === "cancelled" ? "no" : "orange"}">${esc(TT.STATUS[o.status])}</span>` : ""}
      ${o.status === "moved" ? `<span class="muted">→ ${esc(TT.shortDay(o.change.to_day || o.date))} ${esc(TTV.hm(o.change.to_start))}${o.change.to_room ? ", " + esc(o.change.to_room) : ""}</span>` : ""}
      ${o.reason ? `<span class="muted">${esc(o.reason)}</span>` : ""}${o.unsure ? `<span class="muted">(week ${esc(o.parity)} only)</span>` : ""}</div>`;
  },

  // ------------------------------------------------------------------ calendar file (.ics) for a phone or Google Calendar
  ics(tt, filter, name) {
    const start = tt.sem_starts && tt.sem_starts > TT.now().date ? tt.sem_starts : TT.now().date;
    const end = tt.sem_ends || TTV.addDays(start, 120);
    const days = Math.max(1, Math.round((new Date(end + "T12:00:00Z") - new Date(start + "T12:00:00Z")) / 86400000) + 1);
    const occ = TT.upcoming(tt, filter, start, Math.min(days, 200)).filter((o) => o.status !== "cancelled" && o.status !== "moved");
    // Algiers = UTC+1 all year: 08:00 local = 07:00Z
    const utc = (iso, t) => { const m = TTV.min(t) - 60, d = m < 0 ? TTV.addDays(iso, -1) : iso, mm = (m + 1440) % 1440;
      return d.replace(/-/g, "") + "T" + String(Math.floor(mm / 60)).padStart(2, "0") + String(mm % 60).padStart(2, "0") + "00Z"; };
    const txt = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
    const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ClassPulse//Timetable//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:" + txt(name)];
    occ.forEach((o, i) => lines.push("BEGIN:VEVENT", `UID:cp-${tt.id}-${o.id || "x" + i}-${o.date}@classpulse`, "DTSTAMP:" + stamp,
      "DTSTART:" + utc(o.date, o.starts), "DTEND:" + utc(o.date, o.ends), "SUMMARY:" + txt(`${o.module} · ${TTV.kindLabel(o)}`),
      "LOCATION:" + txt(o.room), "DESCRIPTION:" + txt([o.module_name, o.teacher, o.status === "added" ? "extra session" : o.status === "moved_in" ? "moved session" : ""].filter(Boolean).join(" · ")),
      "END:VEVENT"));
    lines.push("END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n") + "\r\n"], { type: "text/calendar" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = TT.safeName(name) + ".ics"; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return occ.length;
  },
  safeName(s) { return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\w-]+/g, "_").replace(/^_|_$/g, ""); },

  // ------------------------------------------------------------------ DeptDesk "timetable-exchange v1" (exchange.js of DeptDesk 2.2)
  TX_DAYS: ["saturday", "sunday", "monday", "tuesday", "wednesday", "thursday", "friday"],
  validateExchange(x) {
    const p = [], time = /^([01]\d|2[0-3]):[0-5]\d$/, date = /^\d{4}-\d{2}-\d{2}$/;
    if (!x || x.format !== "timetable-exchange") return ["not a timetable-exchange file"];
    if (x.version !== 1) p.push(`version ${x.version} not supported (expected 1)`);
    if (!Array.isArray(x.slots)) return p.concat(["slots missing"]);
    const ids = new Set(), byId = {}, sections = new Set((x.sections || []).map((s) => s.code)), modules = new Set((x.modules || []).map((m) => m.code));
    const teachers = new Set((x.teachers || []).map((t) => t.key));
    x.slots.forEach((s, i) => {
      const w = `slot ${i + 1}`;
      if (!s.id || ids.has(s.id)) p.push(`${w}: missing or repeated id`); ids.add(s.id); byId[s.id] = s;
      if (!sections.has(s.section)) p.push(`${w}: unknown section ${s.section}`);
      if (!modules.has(s.module)) p.push(`${w}: unknown module ${s.module}`);
      if (!["course", "td", "tp"].includes(s.kind)) p.push(`${w}: kind must be course, td or tp`);
      if (s.kind === "course" && s.group) p.push(`${w}: a course is for the whole section (group "")`);
      if (s.kind !== "course" && !/^S?G\d+$/.test(s.group || "")) p.push(`${w}: group must be G<n> or SG<n>`);
      if (TT.TX_DAYS.indexOf(s.day) !== s.day_index) p.push(`${w}: day and day_index disagree`);
      if (!time.test(s.start || "") || !time.test(s.end || "") || s.end <= s.start) p.push(`${w}: bad hours`);
      if (!["all", "A", "B"].includes(s.weeks)) p.push(`${w}: weeks must be all, A or B`);
      if (s.teacher && !teachers.has(s.teacher)) p.push(`${w}: unknown teacher key ${s.teacher}`);
      if ((s.valid_from && !date.test(s.valid_from)) || (s.valid_to && !date.test(s.valid_to))) p.push(`${w}: bad validity dates`);
    });
    (x.exceptions || []).forEach((e, i) => {
      const w = `exception ${i + 1}`;
      if (!date.test(e.date || "")) p.push(`${w}: bad date`);
      if (!["cancelled", "moved", "added"].includes(e.action)) p.push(`${w}: action must be cancelled, moved or added`);
      if ((e.action === "cancelled" || e.action === "moved") && !ids.has(e.slot)) p.push(`${w}: unknown slot ${e.slot}`);
      else if (byId[e.slot] && date.test(e.date || "") && (new Date(e.date + "T12:00:00Z").getUTCDay() + 1) % 7 !== byId[e.slot].day_index) p.push(`${w}: ${e.date} is not a ${byId[e.slot].day}`);
      if (e.action === "moved" && !(e.to && date.test(e.to.date || "") && time.test(e.to.start || ""))) p.push(`${w}: a moved session needs to.date and to.start`);
    });
    return p;
  },
  // One section of an exchange file -> what t_tt_import takes. Weeks are those of the source (never computed again).
  fromExchange(x, code) {
    const sec = (x.sections || []).find((s) => s.code === code) || (x.sections || [])[0] || { code: "", td_groups: [], tp_groups: [] };
    const mod = {}, tch = {};
    (x.modules || []).forEach((m) => { mod[m.code] = m; });
    (x.teachers || []).forEach((t) => { tch[t.key] = t.label; });
    const slots = x.slots.filter((s) => s.section === sec.code).map((s) => ({ source_id: s.id, module: s.module, module_name: (mod[s.module] || {}).name || "",
      color: (mod[s.module] || {}).color || "", kind: s.kind, target: s.group || "", day: s.day_index, starts: s.start, ends: s.end, parity: s.weeks,
      room: s.room || "", teacher: s.teacher ? tch[s.teacher] || "" : "", note: s.note || "", valid_from: s.valid_from || "", valid_to: s.valid_to || "" }));
    const ids = new Set(slots.map((s) => s.source_id));
    const exceptions = (x.exceptions || []).filter((e) => (e.slot ? ids.has(e.slot) : e.section === sec.code));
    const c = x.context || {};
    return {
      meta: { title: `${c.level_short || c.level || "Timetable"}${(x.sections || []).length > 1 ? " · section " + sec.code : ""} · ${c.period || ""} ${c.year || ""}`.trim(),
        level_short: c.level_short || "", year: c.year || "", period: c.period || "", section: sec.code, td_groups: sec.td_groups || [], tp_groups: sec.tp_groups || [],
        sem_starts: (x.semester || {}).starts || "", sem_ends: (x.semester || {}).ends || "", week_a_start: (x.semester || {}).week_a_start || "",
        weeks: (x.weeks || []).map((w) => ({ week_start: w.week_start, kind: w.kind, no: w.teaching_no, parity: w.parity })),
        source: "deptdesk", source_key: [(x.generator || {}).app, c.level_short, c.year, c.period, x.scope].join("|") },
      slots, exceptions };
  },

  // ------------------------------------------------------------------ DeptDesk Excel template (timetable-excel.js of DeptDesk 2.2)
  norm(h) { return String(h).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""); },
  DAY_WORDS: [["sat", "sam", "samedi", "saturday"], ["sun", "dim", "dimanche", "sunday"], ["mon", "lun", "lundi", "monday"],
    ["tue", "mar", "mardi", "tuesday"], ["wed", "mer", "mercredi", "wednesday"], ["thu", "jeu", "jeudi", "thursday"], ["fri", "ven", "vendredi", "friday"]],
  dayFromText(t) {
    const h = TT.norm(t);
    if (/^[0-6]$/.test(h)) return Number(h);
    const i = TT.DAY_WORDS.findIndex((w) => w.includes(h) || w.some((x) => h.startsWith(x) && x.length >= 3));
    return i >= 0 ? i : null;
  },
  timeFromText(t) {
    const s = String(t || "").trim().toLowerCase().replace(/\s/g, "");
    if (!s) return "";
    if (/^0?\.\d+$/.test(s) || (/^\d*\.\d+$/.test(s) && Number(s) < 1)) {
      const mins = Math.round(Number(s) * 1440); return String(Math.floor(mins / 60)).padStart(2, "0") + ":" + String(mins % 60).padStart(2, "0");
    }
    const m = s.match(/^(\d{1,2})(?:[h:.](\d{0,2}))?(?::\d{2})?$/);
    if (!m) return "";
    const hh = Number(m[1]), mm = Number(m[2] || 0);
    if (hh > 23 || mm > 59) return "";
    return String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
  },
  kindFromText(t) {
    const h = TT.norm(t);
    if (/^(td|tds|travaux_diriges)/.test(h)) return "td";
    if (/^(tp|tps|lab|labo|travaux_pratiques)/.test(h)) return "tp";
    return "course";
  },
  HEADER_WORDS: {
    day: ["day", "jour"], starts: ["start", "starts", "debut", "heure_debut", "from", "de"], ends: ["end", "ends", "fin", "heure_fin", "to", "a"],
    module: ["module", "code", "matiere", "module_code"], module_name: ["module_name", "intitule", "title", "name", "nom_du_module"],
    kind: ["activity", "type", "kind", "nature", "activite"], target: ["group", "groupe", "public", "target", "groups"],
    parity: ["week", "semaine", "parity", "parite"], room: ["room", "salle", "lieu"], teacher: ["teacher", "enseignant", "prof", "teachers"],
  },
  // book = readWorkbookGrid(file) of excel.js -> { sheet, slots, problems, td_groups, tp_groups }
  fromWorkbook(book) {
    for (const name of book.names) {
      const grid = book.sheets[name] || [];
      for (let r = 0; r < Math.min(grid.length, 15); r++) {
        const cols = {};
        grid[r].forEach((cell, c) => {
          const h = TT.norm(cell);
          for (const [k, words] of Object.entries(TT.HEADER_WORDS)) if (cols[k] === undefined && words.includes(h)) cols[k] = c;
        });
        if (cols.day === undefined || cols.starts === undefined || cols.module === undefined) continue;
        const slots = [], problems = [];
        grid.slice(r + 1).forEach((row, i) => {
          const get = (k) => (cols[k] === undefined ? "" : String(row[cols[k]] || "").trim());
          if (!get("day") && !get("module")) return;
          const line = r + 2 + i, day = TT.dayFromText(get("day")), starts = TT.timeFromText(get("starts")), ends = TT.timeFromText(get("ends"));
          if (day === null) { problems.push(`line ${line}: unknown day "${get("day")}"`); return; }
          if (!starts || !ends || ends <= starts) { problems.push(`line ${line}: start / end time not understood`); return; }
          if (!get("module")) { problems.push(`line ${line}: no module`); return; }
          const p = get("parity").toUpperCase();
          let target = /^(section|all|tous|toute|whole)/i.test(get("target")) ? "" : get("target").toUpperCase().replace(/\s/g, "");
          if (target && !/^S?G\d{1,2}$/.test(target)) { problems.push(`line ${line}: group "${get("target")}" not understood (Section, G1, SG3...): imported as the whole section`); target = ""; }
          slots.push({ line, day, starts, ends, module: get("module"), module_name: get("module_name"), kind: TT.kindFromText(get("kind")), target,
            parity: /(^|\s)(A|1|S1)$/.test(p) || /WEEK ?A|SEMAINE ?1/.test(p) ? "A" : /(^|\s)(B|2|S2)$/.test(p) || /WEEK ?B|SEMAINE ?2/.test(p) ? "B" : "all",
            room: get("room"), teacher: get("teacher") });
        });
        const groups = (re) => [...new Set(slots.map((s) => s.target).filter((t) => re.test(t)))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        return { sheet: name, slots, problems, td_groups: groups(/^G\d+$/), tp_groups: groups(/^SG\d+$/) };
      }
    }
    return { sheet: null, slots: [], problems: ["No sheet with the columns Day, Start, End, Module."], td_groups: [], tp_groups: [] };
  },

  // ------------------------------------------------------------------ the usual Excel grid (+ a "TP rotation" sheet)
  PERIODS: [["08:00", "09:30"], ["09:40", "11:10"], ["11:20", "12:50"], ["13:00", "14:30"], ["14:40", "16:10"], ["16:20", "17:50"]],
  periodRange(slot) {
    const s = TTV.min(slot.starts), e = TTV.min(slot.ends), cols = [];
    TT.PERIODS.forEach(([a, b], i) => { if (Math.min(e, TTV.min(b)) - Math.max(s, TTV.min(a)) >= 40) cols.push(i); });
    if (!cols.length) { let best = 0, bd = 1e9; TT.PERIODS.forEach(([a], i) => { const d = Math.abs(TTV.min(a) - s); if (d < bd) { bd = d; best = i; } }); cols.push(best); }
    return [cols[0], cols[cols.length - 1]];
  },
  slotText(s, students) {
    const head = `${s.module}${s.kind === "course" || s.kind === "rotation" ? "" : " " + TT.KIND[s.kind]}${s.target ? " " + s.target : ""}${s.parity !== "all" ? " (week " + s.parity + ")" : ""}`;
    const time = (s.kind === "tp" || TTV.hm(s.starts) !== TT.PERIODS[TT.periodRange(s)[0]][0]) ? ` ${TTV.hm(s.starts)}-${TTV.hm(s.ends)}` : "";
    return [head + time, s.room || "", students || !s.teacher ? "" : "(" + s.teacher + ")"].filter(Boolean).join(" · ");
  },
  gridRows(slots, students) {
    const days = [0, 1, 2, 3, 4, 5].concat(slots.some((s) => s.day === 6) ? [6] : []);
    const rows = [["", ...TT.PERIODS.map(([a, b]) => `${a}-${b}`)]], merges = [];
    days.forEach((d, di) => {
      const r = di + 1, row = [TT_DAYS[d], "", "", "", "", "", ""], blocks = [];
      slots.filter((s) => s.day === d).sort((a, b) => TTV.min(a.starts) - TTV.min(b.starts)).forEach((s) => {
        const [c0, c1] = TT.periodRange(s);
        const b = blocks.find((x) => !(c1 < x.c0 || c0 > x.c1));
        if (b) { b.c0 = Math.min(b.c0, c0); b.c1 = Math.max(b.c1, c1); b.items.push(s); } else blocks.push({ c0, c1, items: [s] });
      });
      blocks.forEach((b) => {
        row[b.c0 + 1] = b.items.map((s) => TT.slotText(s, students)).join("\n");
        if (b.c1 > b.c0) merges.push({ s: { r: r + 2, c: b.c0 + 1 }, e: { r: r + 2, c: b.c1 + 1 } });
      });
      rows.push(row);
    });
    return { rows, merges };
  },
  rotationDays(slots) { return [0, 1, 2, 3, 4, 5, 6].filter((d) => new Set(slots.filter((s) => s.day === d && s.kind === "tp").map((s) => s.target)).size >= 2); },
  rotationRows(slots, students) {
    const rows = [];
    TT.rotationDays(slots).forEach((d) => {
      const tp = slots.filter((s) => s.day === d && s.kind === "tp");
      const wins = [...new Set(tp.map((s) => `${TTV.hm(s.starts)}-${TTV.hm(s.ends)}`))].sort();
      const targets = [...new Set(tp.map((s) => s.target))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      rows.push([`${TT_DAYS[d]} - TP rotation`], ["Sub-group", "Week", ...wins]);
      targets.forEach((t) => {
        [...new Set(tp.filter((s) => s.target === t).map((s) => s.parity))].sort().forEach((p) => rows.push([t || "Section", p === "all" ? "every week" : p, ...wins.map((w) => {
          const s = tp.find((x) => x.target === t && x.parity === p && `${TTV.hm(x.starts)}-${TTV.hm(x.ends)}` === w);
          return s ? [s.module, s.room || "", students || !s.teacher ? "" : "(" + s.teacher + ")"].filter(Boolean).join(" · ") : "";
        })]));
      });
      rows.push([]);
    });
    return rows;
  },
  exportGrid(title, slots, students, collapseTp) {
    const tpDays = collapseTp ? TT.rotationDays(slots) : [];
    const gridSlots = slots.filter((s) => !(s.kind === "tp" && tpDays.includes(s.day)));
    tpDays.forEach((d) => {
      const tp = slots.filter((s) => s.day === d && s.kind === "tp");
      const s0 = tp.reduce((m, s) => (s.starts < m ? s.starts : m), "99"), e0 = tp.reduce((m, s) => (s.ends > m ? s.ends : m), "");
      gridSlots.push({ day: d, starts: s0, ends: e0, kind: "rotation", module: "TP in turn: see the sheet TP rotation", target: "", parity: "all", room: "" });
    });
    const g = TT.gridRows(gridSlots, students);
    const ws = XLSX.utils.aoa_to_sheet([[`${title}${students ? "" : " (with teachers)"}`], [], ...g.rows]);
    ws["!cols"] = [11, 28, 28, 28, 28, 28, 28].map((w) => ({ wch: w }));
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 6 } }, ...g.merges];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Timetable");
    const rot = TT.rotationRows(slots, students);
    if (rot.length) { const r = XLSX.utils.aoa_to_sheet(rot); r["!cols"] = [12, 12, 30, 30, 30, 30].map((w) => ({ wch: w })); XLSX.utils.book_append_sheet(wb, r, "TP rotation"); }
    XLSX.writeFile(wb, `Timetable_${TT.safeName(title)}${students ? "_students" : ""}_${TT.now().date}.xlsx`);
  },
  // the DeptDesk template (one line per slot): what we export can be imported again
  exportTemplate(title, slots) {
    const rows = [["Day", "Start", "End", "Module", "Module name", "Activity", "Group", "Week", "Room", "Teacher"]];
    slots.forEach((s) => rows.push([TT_DAYS[s.day], TTV.hm(s.starts), TTV.hm(s.ends), s.module, s.module_name || "", TT.KIND[s.kind] || s.kind,
      s.target || "Section", s.parity === "all" ? "every week" : s.parity, s.room || "", s.teacher || ""]));
    const ws = XLSX.utils.aoa_to_sheet(rows);
    ws["!cols"] = [11, 7, 7, 10, 36, 9, 9, 11, 12, 20].map((w) => ({ wch: w }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Timetable");
    XLSX.writeFile(wb, `Timetable_template_${TT.safeName(title)}_${TT.now().date}.xlsx`);
  },
};
if (typeof module !== "undefined") module.exports = { TT };
