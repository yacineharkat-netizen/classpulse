// ClassPulse v32 - timetable views, taken from DeptDesk 2.2 (ttview.js) with two changes: the day names are TT_DAYS
// and the rotation dialog is TTV.ask (no dependency on the page). Shared by the teacher console and the student pages:
//   week agenda in proportional time (block height = duration, free time visible), a TP day summarised in the
//   whole-section view (click: the rotation table), one lane per group for a single day, the phone's day timeline.
(window.CP_FILES = window.CP_FILES || {})["ttview.js"] = "32.1"; // file version, checked by common.js
const TT_DAYS = ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

const TTV = {
  DAY_START: 480, DAY_END: 1080,              // 08:00 - 18:00 (classes end at 17:50)
  SHORT: ["Sa", "Su", "Mo", "Tu", "We", "Th"],
  PALETTE: ["#2F6F9F", "#B5651D", "#7A4FA3", "#2E7D4F", "#B83A5B", "#1B7F8C", "#7A6A1E", "#4A5A8B", "#A3473A", "#3F7F6F"],

  min(t) { const [h, m] = String(t).slice(0, 5).split(":").map(Number); return h * 60 + m; },
  hm(t) { return String(t || "").slice(0, 5); },
  clock(m) { return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); },
  dur(a, b) { const d = b - a, h = Math.floor(d / 60), m = d % 60; return h ? `${h} h${m ? " " + String(m).padStart(2, "0") : ""}` : `${m} min`; },
  mix(hex, white) {
    const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const f = (c) => Math.round(c + (255 - c) * white);
    return `rgb(${f(r)}, ${f(g)}, ${f(b)})`;
  },
  dark(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    return `rgb(${Math.round((n >> 16) * k)}, ${Math.round(((n >> 8) & 255) * k)}, ${Math.round((n & 255) * k)})`;
  },
  // One colour per module: its own colour when it was chosen, otherwise a palette colour (stable: sorted codes).
  colors(slots) {
    const codes = [...new Set(slots.map((s) => s.module))].sort();
    const out = {};
    codes.forEach((c, i) => {
      const own = (slots.find((s) => s.module === c) || {}).color;
      const base = own && own.toLowerCase() !== "#1b7f8c" ? own : TTV.PALETTE[i % TTV.PALETTE.length];
      out[c] = { bg: TTV.mix(base, 0.86), bd: base, fg: TTV.dark(base, 0.62) };
    });
    return out;
  },
  kindLabel(s) { return s.kind === "course" ? "Course" : `${s.kind.toUpperCase()}${s.target ? " " + s.target : ""}`; },

  // The week shown first: this week; a holiday or exam week shows the next teaching week.
  weekChoice(weeks, today) {
    if (!weeks || !weeks.length) return { parity: null, label: "" };
    const cur = weeks.find((w) => w.week_start <= today && today <= TTV.addDays(w.week_start, 6));
    if (cur && cur.kind === "teaching") return { parity: cur.parity, label: "this week", no: cur.no };
    const next = weeks.find((w) => w.week_start > today && w.kind === "teaching");
    if (next) return { parity: next.parity, label: cur ? `next teaching week (this week: ${cur.kind})` : "next teaching week", no: next.no };
    return { parity: null, label: "" };
  },
  addDays(iso, n) { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); },
  todayIndex(today) { return (new Date(today + "T12:00:00Z").getUTCDay() + 1) % 7; },
  inWeek(s, week) { return !week || s.parity === "all" || s.parity === week; },

  // Items laid side by side when they overlap (lanes inside a cluster of overlapping items).
  lanes(items) {
    const sorted = items.slice().sort((a, b) => a.s - b.s || a.e - b.e);
    let cluster = [], end = -1;
    const flush = () => {
      const laneEnds = [];
      cluster.forEach((it) => {
        let l = laneEnds.findIndex((e) => e <= it.s);
        if (l < 0) { l = laneEnds.length; laneEnds.push(0); }
        laneEnds[l] = it.e; it.lane = l;
      });
      cluster.forEach((it) => { it.lanes = laneEnds.length; });
      cluster = [];
    };
    sorted.forEach((it) => { if (it.s >= end && cluster.length) flush(); cluster.push(it); end = Math.max(end, it.e); });
    if (cluster.length) flush();
    return sorted;
  },

  // ------------------------------------------------------------------ the whole view
  // o: { slots, week, day, mode: section|group|other, students, phone, today, canEdit, onEdit(slot), onAdd(day),
  //      onRoom(slot), onChange({week, day}), weekLabel, otherWeekLabel, showSection }
  render(box, o) {
    const C = TTV.colors(o.slots);
    const visible = o.slots.filter((s) => TTV.inWeek(s, o.week) && s.day <= 5);
    const tIdx = TTV.todayIndex(o.today);
    const day = o.phone ? (o.day ?? (tIdx <= 5 ? tIdx : 0)) : o.day;
    const weekBtns = o.week ? ["A", "B"].map((w) => `<button data-ttweek="${w}" class="${o.week === w ? "on" : ""}">Week ${w}${w === o.week && o.weekLabel ? " · " + esc(o.weekLabel) : ""}</button>`).join("") : "";
    const dayBtns = (o.phone ? [] : [`<button data-ttday="" class="${day == null ? "on" : ""}">Week</button>`])
      .concat(TTV.SHORT.map((d, i) => `<button data-ttday="${i}" class="${day === i ? "on" : ""}">${d}</button>`)).join("");
    let body;
    if (day == null) {
      body = TTV.agenda(visible, [0, 1, 2, 3, 4, 5], o, C, false);
      if (o.mode === "section") body += [0, 1, 2, 3, 4, 5].filter((d) => new Set(visible.filter((s) => s.day === d && s.kind === "tp").map((s) => s.target)).size >= 2)
        .map((d) => `<div class="tt-print-only"><h3>${TT_DAYS[d]} · TP rotation</h3>${TTV.rotationTable(d, Object.assign({}, o, { canEdit: false }), C, [])}</div>`).join("");
    }
    else if (o.mode === "section" && !o.phone) body = TTV.dayLanes(visible, day, o, C);
    else body = TTV.agenda(visible, [day], o, C, o.phone);
    box.innerHTML = `<div class="tt-controls no-print">${weekBtns ? `<div class="seg tt-seg">${weekBtns}</div>` : ""}<div class="tt-days">${dayBtns}</div></div>${body}`;
    box.querySelectorAll("[data-ttweek]").forEach((b) => b.onclick = () => o.onChange({ week: b.dataset.ttweek, day: o.day }));
    box.querySelectorAll("[data-ttday]").forEach((b) => b.onclick = () => o.onChange({ week: o.week, day: b.dataset.ttday === "" ? null : Number(b.dataset.ttday) }));
    box.querySelectorAll("[data-ttslot]").forEach((b) => b.onclick = () => {
      const s = TTV._items[Number(b.dataset.ttslot)];
      if (s && o.canEdit && o.onEdit) o.onEdit(s); else if (s && o.onRoom) o.onRoom(s);
    });
    box.querySelectorAll("[data-ttrot]").forEach((b) => b.onclick = () => TTV.rotation(Number(b.dataset.ttrot), o, C));
    box.querySelectorAll("[data-ttadd]").forEach((b) => b.onclick = () => o.onAdd && o.onAdd(Number(b.dataset.ttadd)));
  },
  _items: [],
  slotRef(s) { TTV._items.push(s); return TTV._items.length - 1; },

  blockHtml(s, o, C, extraStyle, narrow) {
    const c = C[s.module] || { bg: "#EEF2F6", bd: "#8A9AAB", fg: "#33475B" };
    const clickable = (o.canEdit && o.onEdit) || o.onRoom;
    const inner = `<span class="tt-t">${TTV.hm(s.starts)}–${TTV.hm(s.ends)}</span><span class="tt-n">${esc(s.module)} · ${esc(TTV.kindLabel(s))}</span>
      <span class="tt-r">${o.showSection ? "Section " + esc(s.section) + " · " : ""}${esc(s.room || "room?")}${!o.students && s.teacher ? " · " + esc(s.teacher) : ""}</span>`;
    const style = `${extraStyle};background:${c.bg};border-color:${c.bd};color:${c.fg}`;
    const tip = esc(`${TTV.hm(s.starts)}–${TTV.hm(s.ends)} ${s.module_name || s.module}`), cls = narrow ? "ttb tt-narrow" : "ttb";
    return clickable ? `<button class="${cls}" style="${style}" data-ttslot="${TTV.slotRef(s)}" title="${tip}">${inner}</button>`
      : `<div class="${cls}" style="${style}" title="${tip}">${inner}</div>`;
  },

  // ------------------------------------------------------------------ agenda (columns = days, height = time)
  agenda(visible, days, o, C, phone) {
    TTV._items = [];
    const k = phone ? 1.0 : 0.9, H = (TTV.DAY_END - TTV.DAY_START) * k;
    const hours = []; for (let h = 8; h <= 18; h++) hours.push(h);
    const ruler = `<div class="tt-ruler" style="height:${H}px">${hours.map((h) => `<span style="top:${(h * 60 - TTV.DAY_START) * k}px">${String(h).padStart(2, "0")}:00</span>`).join("")}</div>`;
    const cols = days.map((d) => {
      const all = visible.filter((s) => s.day === d);
      let items = all.map((s) => ({ s: TTV.min(s.starts), e: TTV.min(s.ends), slot: s }));
      // whole-section view: the TP of a day become one summary block (who does what: click)
      const tp = all.filter((s) => s.kind === "tp");
      if (o.mode === "section" && new Set(tp.map((s) => s.target)).size >= 2) {
        items = items.filter((it) => it.slot.kind !== "tp");
        items.push({ s: Math.min(...tp.map((s) => TTV.min(s.starts))), e: Math.max(...tp.map((s) => TTV.min(s.ends))), summary: true,
          mods: [...new Set(tp.map((s) => s.module))], groups: new Set(tp.map((s) => s.target)).size });
      }
      TTV.lanes(items);
      const blocks = items.map((it) => {
        const top = (it.s - TTV.DAY_START) * k, h = Math.max(22, (it.e - it.s) * k - 3);
        const w = 100 / it.lanes, pos = `top:${top + 1}px;height:${h}px;left:calc(${it.lane * w}% + 3px);width:calc(${w}% - 6px)`;
        if (it.summary) return `<button class="ttb tt-sum" style="${pos}" data-ttrot="${d}"><span class="tt-t">${TTV.clock(it.s)}–${TTV.clock(it.e)}</span>
          <span class="tt-n">TP · ${it.groups} sub-groups in turn</span><span class="tt-r">${esc(it.mods.join(", "))}</span><span class="tt-r tt-open">Who does what ›</span></button>`;
        return TTV.blockHtml(it.slot, o, C, pos, it.lanes > 1 && !phone);
      });
      // free time between sessions (personal views, phone)
      const gaps = [];
      if (o.mode !== "section" && items.length) {
        const sorted = items.slice().sort((a, b) => a.s - b.s);
        let end = sorted[0].e;
        sorted.slice(1).forEach((it) => { if (it.s - end >= 30) gaps.push([end, it.s]); end = Math.max(end, it.e); });
      }
      const gapHtml = gaps.map(([a, b]) => `<div class="tt-gap" style="top:${(a - TTV.DAY_START) * k + 3}px;height:${(b - a) * k - 6}px">Free · ${TTV.dur(a, b)}</div>`).join("");
      let empty = "";
      if (!items.length) {
        const other = o.slots.filter((s) => s.day === d && !TTV.inWeek(s, o.week));
        empty = `<div class="tt-empty">${other.length ? `Nothing this week. ${o.mode === "section" ? "" : "The sessions of this day are in week " + esc(other[0].parity) + "."}` : "Nothing on this day."}</div>`;
      }
      let nowLine = "";
      if (d === TTV.todayIndex(o.today) && o.nowMin >= TTV.DAY_START && o.nowMin <= TTV.DAY_END) nowLine = `<div class="tt-now" style="top:${(o.nowMin - TTV.DAY_START) * k}px"></div>`;
      return `<div class="tt-day"><div class="tt-dh">${TT_DAYS[d]}${o.canEdit && o.onAdd ? ` <button class="small secondary no-print" data-ttadd="${d}" aria-label="Add a slot on ${TT_DAYS[d]}">+</button>` : ""}</div>
        <div class="tt-col" style="height:${H}px;--hh:${60 * k}px">${gapHtml}${blocks.join("")}${empty}${nowLine}</div></div>`;
    }).join("");
    let next = "";
    if (phone && days.length === 1 && days[0] === TTV.todayIndex(o.today)) {
      const n = visible.filter((s) => s.day === days[0] && TTV.min(s.starts) > o.nowMin).sort((a, b) => TTV.min(a.starts) - TTV.min(b.starts))[0];
      if (n) next = `<div class="tt-next"><small>Next</small><strong>${esc(n.module)} · ${esc(TTV.kindLabel(n))} · ${TTV.hm(n.starts)} · ${esc(n.room || "room?")}</strong></div>`;
    }
    const rulerCol = `<div class="tt-day tt-rcol"><div class="tt-dh">&nbsp;</div>${ruler}</div>`;
    return `${next}<div class="tt-agenda" style="grid-template-columns: 44px repeat(${days.length}, minmax(0, 1fr))">${rulerCol}${cols}</div>`;
  },

  // ------------------------------------------------------------------ one day, one lane per group (whole section)
  dayLanes(visible, d, o, C) {
    TTV._items = [];
    const items = visible.filter((s) => s.day === d);
    const order = (t) => (t === "" ? 0 : t.startsWith("G") ? 1000 + Number(t.slice(1)) : 2000 + Number(t.slice(2)));
    const targets = [...new Set(items.map((s) => s.target))].sort((a, b) => order(a) - order(b));
    const span = TTV.DAY_END - TTV.DAY_START, pct = (m) => ((m - TTV.DAY_START) / span) * 100;
    const head = [];
    for (let h = 8; h <= 18; h++) head.push(`<span style="left:${pct(h * 60)}%">${String(h).padStart(2, "0")}:00</span>`);
    const rows = targets.map((t) => {
      const list = items.filter((s) => s.target === t).map((s) => ({ s: TTV.min(s.starts), e: TTV.min(s.ends), slot: s }));
      TTV.lanes(list);
      return `<div class="tl-row"><div class="tl-name">${t || "Section"}</div><div class="tl-track">${list.map((it) =>
        TTV.blockHtml(it.slot, o, C, `left:calc(${pct(it.s)}% + 2px);width:calc(${pct(it.e) - pct(it.s)}% - 4px);top:${4 + (it.lane * 52) / it.lanes}px;height:${52 / it.lanes - 2}px`)).join("")}</div></div>`;
    }).join("");
    return `<div class="tl-wrap"><div class="tl-head"><div></div><div class="tl-hours">${head.join("")}</div></div>${rows || `<p class="muted">Nothing on ${TT_DAYS[d]}${o.week ? " in week " + esc(o.week) : ""}.</p>`}</div>`;
  },

  // ------------------------------------------------------------------ the TP rotation of a day (large table)
  rotationTable(d, o, C, refs) {
    const tp = o.slots.filter((s) => s.day === d && s.kind === "tp");
    const windows = [...new Set(tp.map((s) => TTV.hm(s.starts) + "–" + TTV.hm(s.ends)))].sort();
    const order = (t) => Number(String(t).replace(/\D/g, "")) || 0;
    const active = (t) => tp.some((s) => s.target === t && TTV.inWeek(s, o.week));
    const targets = [...new Set(tp.map((s) => s.target))].sort((a, b) => (active(b) - active(a)) || order(a) - order(b));
    const cell = (t, w) => {
      const list = tp.filter((s) => s.target === t && TTV.hm(s.starts) + "–" + TTV.hm(s.ends) === w);
      const s = list.find((x) => TTV.inWeek(x, o.week)) || list[0];
      if (!s) return `<td class="rt-empty">—</td>`;
      const on = TTV.inWeek(s, o.week), c = C[s.module] || {};
      const inner = `<strong>${esc(s.module)}</strong><small>${esc(s.room || "")}${!o.students && s.teacher ? " · " + esc(s.teacher) : ""}</small>`;
      const st = on ? `background:${c.bg};border-color:${c.bd};color:${c.fg}` : "";
      return `<td><${o.canEdit ? `button data-rtslot="${refs.push(s) - 1}"` : "div"} class="rt-cell ${on ? "" : "rt-off"}" style="${st}">${inner}</${o.canEdit ? "button" : "div"}></td>`;
    };
    return `<p class="muted" style="margin-top:0">${o.week ? `Week ${esc(o.week)} in colour; the other week in grey.` : ""} One line per sub-group.</p>
      <div class="table-scroll"><table class="rt"><thead><tr><th></th>${windows.map((w) => `<th>${w}</th>`).join("")}</tr></thead><tbody>
      ${targets.map((t) => `<tr class="${active(t) ? "" : "rt-offrow"}"><th>${esc(t)}${active(t) || !o.week ? "" : `<br><small>week ${o.week === "A" ? "B" : "A"}</small>`}</th>${windows.map((w) => cell(t, w)).join("")}</tr>`).join("")}
      </tbody></table></div>`;
  },
  rotation(d, o, C) {
    const refs = [], html = TTV.rotationTable(d, o, C, refs);
    TTV.ask({ title: `${TT_DAYS[d]} · TP rotation`, html, ok: false, cancel: "Back to the timetable", wide: true,
      onOpen: (wrap) => wrap.querySelectorAll("[data-rtslot]").forEach((b) => b.onclick = () => { const s = refs[Number(b.dataset.rtslot)]; wrap.close(false); o.onEdit(s); }) });
  },
  // A dialog inside the page: ask({ title, html, ok, cancel, danger, wide, onOpen(box), validate(box) }) -> Promise<boolean>
  ask(opts) {
    return new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.className = "tt-modal";
      wrap.innerHTML = `<div class="tt-modal-box${opts.wide ? " wide" : ""}" role="dialog" aria-modal="true">
        ${opts.title ? `<h3>${esc(opts.title)}</h3>` : ""}<div class="dlg-body">${opts.html || ""}</div>
        <div class="actions">${opts.cancel === false ? "" : `<button class="secondary" data-a="no">${esc(opts.cancel || "Cancel")}</button>`}
        ${opts.ok === false ? "" : `<button class="${opts.danger ? "red" : "green"}" data-a="yes">${esc(opts.ok || "OK")}</button>`}</div></div>`;
      document.body.appendChild(wrap);
      const close = (v) => { wrap.remove(); resolve(v); };
      wrap.querySelectorAll("[data-a]").forEach((b) => b.onclick = () => {
        if (b.dataset.a === "yes" && opts.validate && !opts.validate(wrap)) return;
        close(b.dataset.a === "yes");
      });
      wrap.addEventListener("click", (e) => { if (e.target === wrap) close(false); });
      wrap.close = close;
      if (opts.onOpen) opts.onOpen(wrap);
    });
  },
};
