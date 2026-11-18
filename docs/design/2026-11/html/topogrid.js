// Prototype of the topology layout engine: a topology definition plus an optional run
// state in, a character grid of cells {ch, k} out. One grid, two renderers: HTML for the
// web (classes mapped to the lab's tokens) and ANSI for a terminal. k is a meaning, never
// a colour: ln, ink, dim, faint, b, run, pass, fail, you.
(function (G) {
  const W = 15, GAP = 4;

  class Grid {
    constructor(w, h) { this.w = w; this.h = h; this.c = Array.from({ length: h }, () => Array.from({ length: w }, () => ({ ch: " ", k: "" }))); }
    put(x, y, s, k = "") { [...String(s)].forEach((ch, i) => { if (y >= 0 && y < this.h && x + i >= 0 && x + i < this.w) this.c[y][x + i] = { ch, k }; }); }
    get(x, y) { return this.c[y] && this.c[y][x] ? this.c[y][x].ch : " "; }
    box(x, y, w, h, k = "ln") {
      this.put(x, y, "┌" + "─".repeat(w - 2) + "┐", k);
      for (let r = 1; r < h - 1; r++) { this.put(x, y + r, "│", k); this.put(x + w - 1, y + r, "│", k); }
      this.put(x, y + h - 1, "└" + "─".repeat(w - 2) + "┘", k);
    }
    trim() { let last = 0; this.c.forEach((row, y) => { if (row.some((c) => c.ch !== " ")) last = y; }); this.c = this.c.slice(0, last + 1); this.h = this.c.length; return this; }
  }

  const fit = (s, n) => ([...s].length > n ? [...s].slice(0, n - 1).join("") + "…" : s);

  // Horizontal layout: roles left to right, loop-backs as arcs above, "also" edges below,
  // a consulted role hanging under its caller, and the sight matrix as the walls.
  function horizontal(def, st = {}) {
    const LW = def.gutter ?? 24, n = def.roles.length;
    const idx = Object.fromEntries(def.roles.map((r, i) => [r.id, i]));
    const bx = (i) => LW + i * (W + GAP);
    const back = [...(def.back || [])].sort((a, b) => (idx[a.from] - idx[a.to]) - (idx[b.from] - idx[b.to]));
    const R0 = 2 + 2 * back.length, BH = 5, Rb = R0 + BH - 1;
    const also = [...(def.also || [])].sort((a, b) => (idx[a.from] - idx[a.to]) - (idx[b.from] - idx[b.to])), consult = def.consult || [];
    const matrixTop = Rb + 3 + (also.length ? 2 * also.length + 1 : 0) + (consult.length ? 7 : 0);
    const rows = def.sight ? def.sight.rows.length + 2 : 0;
    const statusLen = st.status ? [...st.status.lead + " " + st.status.text].length : [...(def.restLine || "")].length;
    const noteLen = Math.max(0, ...consult.map((c) => bx(idx[c.from]) + W + 2 + [...(c.role.note || "")].length));
    const width = Math.max(bx(n - 1) + W + 17, LW + statusLen + 2, noteLen, LW + 60);
    const g = new Grid(width, matrixTop + rows + (st.timeline ? 5 : 0) + 2);
    const active = st.active, done = new Set(st.done || []);

    // status line
    if (st.running || st.replay) {
      const s = st.status;
      g.put(LW, 0, s.lead, s.leadK || (st.replay ? "b" : "run"));
      g.put(LW + [...s.lead].length + 1, 0, s.text, "dim");
    } else g.put(LW, 0, def.restLine || "", "faint");

    // gutter: name and summary
    g.put(0, R0 + 1, def.title, "b");
    (def.summary || []).forEach((l, i) => g.put(0, R0 + 2 + i, l, "dim"));

    // loop-back arcs above
    const exitUsed = {}, entryUsed = {};
    back.forEach((a, j) => {
      const s = idx[a.from], t = idx[a.to], lane = R0 - 2 - 2 * j;
      const ei = (exitUsed[s] = (exitUsed[s] ?? -1) + 1), ni = (entryUsed[t] = (entryUsed[t] ?? -1) + 1);
      const self = s === t;
      const xs = self ? bx(s) + 11 : bx(s) + 6 + 3 * ei, xt = self ? bx(t) + 3 : bx(t) + 9 - 3 * ni;
      const k = a.live ? "run" : "ln";
      for (let y = lane + 1; y < R0; y++) g.put(xs, y, "│", k);
      g.put(xs, lane, "╮", k);
      for (let x = xt + 1; x < xs; x++) g.put(x, lane, "─", k);
      g.put(xt, lane, "╭", k);
      for (let y = lane + 1; y < R0 - 1; y++) g.put(xt, y, "│", k);
      g.put(xt, R0 - 1, "▼", k);
      a._xs = xs;
      let lx = self ? xs + 2 : xt + 2;
      const label = ` ↺ ${a.label} `;
      g.put(lx, lane, label, a.live ? "run" : "ink");
      lx += [...label].length;
      if (a.counter) { g.put(lx, lane, "· ", "dim"); lx += 2; }
      if (a.rounds) {
        g.put(lx, lane, " ", "");
        lx += 1;
        for (let r = 1; r <= a.rounds; r++) {
          const rs = (st.rounds || [])[r - 1];
          const ch = !rs ? "○" : rs.state === "now" ? "◉" : "●";
          const kk = !rs ? "faint" : rs.state === "now" ? "run" : rs.state === "fail" ? "fail" : "ink";
          g.put(lx, lane, ch, kk); lx += 1;
          if (rs && rs.flag) { g.put(lx, lane, "⚑", "b"); lx += 1; }
          g.put(lx, lane, " ", ""); lx += 1;
        }
        g.put(lx, lane, a.max + " ", "dim");
      }
      if (a.counter) g.put(lx, lane, (st.counter ? st.counter + " · " : "") + a.max, st.counter ? "run" : "dim");
    });

    // boxes
    def.roles.forEach((r, i) => {
      const x = bx(i), isA = r.id === active, isF = r.id === st.focus, res = (st.results || {})[r.id];
      const k = isA ? "run" : isF ? "b" : res && res.k === "fail" ? "fail" : "ln";
      g.box(x, R0, W, BH, k);
      g.put(x + 2, R0 + 1, fit(`${r.icon} ${r.name}`, W - 3), isA ? "run" : "b");
      g.put(x + 2, R0 + 2, fit(r.engine, W - 3), "faint");
      if (isF) g.put(x + 2, R0 + 3, fit(st.focusText || "▸ this step", W - 3), "b");
      else if (res) g.put(x + 2, R0 + 3, fit(res.txt, W - 3), res.k);
      else if (isA) g.put(x + 2, R0 + 3, fit(`${st.spin || "⠹"} ${st.doing || "working"}`, W - 3), "run");
      else if (st.running || st.replay) g.put(x + 2, R0 + 3, done.has(r.id) ? fit(`· done ${(st.perRole || {})[r.id] || ""}`, W - 3) : "· waiting", "faint");
      else g.put(x + 2, R0 + 3, fit(r.model || "", W - 3), "dim");
      if (r.lint) g.put(x + W - 3, R0 + 1, "!" + r.lint, "b");
      back.forEach((a) => { if (idx[a.from] === i) g.put(a._xs, R0, "┴", a.live ? "run" : k); });
      if (i < n - 1) {
        const ax = x + W;
        const tok = st.token === r.id;
        g.put(ax, R0 + 1, "─".repeat(GAP - 1) + "▶", "ln");
        if (tok) g.put(ax + 1, R0 + 1, "▣", "run");
      }
    });

    // exit
    const ex = bx(n - 1) + W;
    g.put(ex, R0 + 1, "──▶ ", "ln");
    g.put(ex + 4, R0 + 1, def.exit.label, st.final ? st.final.k : "b");
    (def.exit.when || []).forEach((l, i) => g.put(ex + 1, R0 + 2 + i, l, "dim"));

    // "also" edges below, dotted
    also.forEach((a, j) => {
      const s = idx[a.from], t = idx[a.to], lane = Rb + 2 + 2 * j;
      const xs = bx(s) + 5 + 2 * j, xt = bx(t) + 3 + 2 * j;
      g.put(xs, Rb, "┬", "faint");
      for (let y = Rb + 1; y < lane; y++) g.put(xs, y, "┆", "faint");
      g.put(xs, lane, "╯", "faint");
      for (let x = xt + 1; x < xs; x++) g.put(x, lane, "┄", "faint");
      g.put(xt, lane, "╰", "faint");
      for (let y = Rb + 2; y < lane; y++) g.put(xt, y, "┆", "faint");
      g.put(xt, Rb + 1, "▲", "faint");
      g.put(xt + 2, lane, ` ${a.label} `, "faint");
    });

    // consulted roles hang under their caller
    consult.forEach((c) => {
      const i = idx[c.from], x = bx(i), cx = x + 7, live = st.consultLive;
      const k = live ? "run" : "dim";
      g.put(cx, Rb, "┬", k);
      g.put(cx, Rb + 1, live ? "┃" : "┆", k);
      g.put(cx, Rb + 2, "⇅", k);
      g.put(cx + 2, Rb + 2, live ? `${st.spin || "⠹"} ${c.liveLabel}` : c.label, live ? "run" : "dim");
      g.put(cx, Rb + 3, live ? "┃" : "┆", k);
      g.box(x, Rb + 4, W, 3, live ? "run" : "ln");
      g.put(cx, Rb + 4, "┴", k);
      g.put(x + 2, Rb + 5, fit(`${c.role.icon} ${c.role.name}`, W - 3), live ? "run" : "b");
      g.put(x + W + 1, Rb + 5, c.role.note || "", "dim");
    });

    // sight matrix: one column per role, walls between columns
    if (def.sight) {
      const y0 = matrixTop;
      g.put(0, y0, "what each role sees", "faint");
      def.roles.forEach((r, i) => g.put(bx(i) + 2, y0, r.name, r.id === active ? "run" : "faint"));
      def.sight.rows.forEach((row, ri) => {
        const y = y0 + 1 + ri;
        g.put(0, y, row.mark + " ", "ink");
        g.put(2, y, fit(row.label, LW - 3), "dim");
        row.cells.forEach((cell, i) => {
          const cx = bx(i) + 2;
          const v = cell === 1 ? "●" : cell === 0 ? "·" : cell;
          g.put(cx, y, v, cell === 1 || (typeof cell === "string" && cell.startsWith("●")) ? "ink" : "faint");
          if (i < n - 1) g.put(bx(i) + W + 1, y, "┊", "faint");
        });
      });
      g.put(0, y0 + 1 + def.sight.rows.length, def.sight.legend || "■ measured by the lab   “ written by a model   › from you", "faint");
    }

    // replay timeline
    if (st.timeline) {
      const t = st.timeline, y = g.h - 5;
      g.put(0, y, "timeline", "faint");
      let x = LW;
      t.steps.forEach((s, i) => {
        if (s === "|") { g.put(x, y, "│", "faint"); x += 2; return; }
        const k = i === t.at ? t.atK || "b" : s.k || "dim";
        g.put(x, y, s.ch, k);
        if (i === t.at) g.put(x, y + 1, "▲", t.atK || "b");
        x += 2;
      });
      g.put(LW, y + 2, t.caption, "dim");
      g.put(0, y + 1, t.left || "", "faint");
    }
    return g.trim();
  }

  // Vertical layout for narrow screens: roles top to bottom, loop-backs on the right margin.
  function vertical(def, st = {}) {
    const n = def.roles.length, BW = def.bw || 26;
    const idx = Object.fromEntries(def.roles.map((r, i) => [r.id, i]));
    const back = [...(def.back || [])].sort((a, b) => (idx[a.from] - idx[a.to]) - (idx[b.from] - idx[b.to]));
    const exits = {}; back.forEach((a) => (exits[a.from] = (exits[a.from] || 0) + 1));
    const BH = 2 + Math.max(1, ...Object.values(exits)), STEP = BH + 2;
    const top = 2, by = (i) => top + i * STEP;
    const width = BW + 4 + 3 * back.length + 2;
    const g = new Grid(width + 2, top + n * STEP + 4 + back.length * 2 + (def.sightShort ? n : 0));
    if (st.running) { g.put(0, 0, st.status.lead, "run"); g.put([...st.status.lead].length + 1, 0, st.status.short || "", "dim"); }
    else g.put(0, 0, def.restShort || "", "faint");
    def.roles.forEach((r, i) => {
      const y = by(i), isA = r.id === st.active, res = (st.results || {})[r.id];
      const k = isA ? "run" : res && res.k === "fail" ? "fail" : "ln";
      g.box(0, y, BW, BH, k);
      g.put(2, y + 1, `${r.icon} ${r.name}`, isA ? "run" : "b");
      const right = res ? res.txt : isA ? `${st.spin || "⠹"} ${st.doing || ""}` : (st.running ? ((st.done || []).includes(r.id) ? "· done" : "· waiting") : "");
      if (right) g.put(BW - 2 - [...right].length, y + 1, right, res ? res.k : isA ? "run" : "faint");
      if (i < n - 1) { g.put(Math.floor(BW / 2), y + BH, "│", "ln"); g.put(Math.floor(BW / 2), y + BH + 1, st.token === r.id ? "▣" : "▼", st.token === r.id ? "run" : "ln"); }
    });
    const used = {};
    back.forEach((a, j) => {
      const ei = (used[a.from] = (used[a.from] ?? -1) + 1);
      const yt = by(idx[a.to]) + 1, x = BW + 2 + 3 * j;
      const k = a.live ? "run" : "ln";
      const yS = by(idx[a.from]) + 1 + ei;
      g.put(BW - 1, yS, "├", k);
      for (let xx = BW; xx < x; xx++) g.put(xx, yS, "─", k);
      g.put(x, yS, "╯", k);
      for (let y = yt + 1; y < yS; y++) g.put(x, y, "│", k);
      g.put(x, yt, "╮", k);
      for (let xx = BW; xx < x; xx++) g.put(xx, yt, "─", k);
      g.put(BW, yt, "◀", k);
      g.put(x, Math.floor((yt + yS) / 2), String(j + 1), a.live ? "run" : "b");
    });
    let y = top + n * STEP - 1;
    back.forEach((a, j) => {
      let line = `${j + 1} ↺ ${a.label}`;
      g.put(0, y, line, a.live ? "run" : "ink");
      if (a.rounds) {
        let x = 2, yy = y + 1;
        for (let r = 1; r <= a.rounds; r++) {
          const rs = (st.rounds || [])[r - 1];
          g.put(x, yy, !rs ? "○" : rs.state === "now" ? "◉" : "●", !rs ? "faint" : rs.state === "now" ? "run" : "ink"); x += 1;
          if (rs && rs.flag) { g.put(x, yy, "⚑", "b"); x += 1; }
          x += 1;
        }
        g.put(x, yy, a.max, "dim");
        y += 1;
      }
      y += 1;
    });
    return g.trim();
  }

  // One line per arm: the roles in order, what the variant changed in bold, the way back.
  function strip(def, opts = {}) {
    const parts = [];
    def.roles.forEach((r, i) => {
      if (i) parts.push(["─▶", "ln"]);
      const changed = (opts.changed || []).includes(r.id);
      parts.push(["[", "ln"], [`${r.icon} ${r.name}${opts.notes && opts.notes[r.id] ? " " + opts.notes[r.id] : ""}`, changed ? "b" : "dim"], ["]", "ln"]);
    });
    if (def.back && def.back.length) parts.push(["  ↺" + (opts.rounds || ""), "dim"]);
    const len = parts.reduce((a, [t]) => a + [...t].length, 0);
    const g = new Grid(len, 1);
    let x = 0;
    parts.forEach(([t, k]) => { g.put(x, 0, t, k); x += [...t].length; });
    return g;
  }

  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  // Every non-ASCII cell is pinned to one character width, so a glyph the font lacks can't
  // push the grid out of line.
  function toHTML(g) {
    return g.c.map((row) => row.map((c) => {
      const cls = c.k ? ` class="g-${c.k}"` : "";
      const ch = c.ch.charCodeAt(0) > 126 ? `<b class="w">${esc(c.ch)}</b>` : esc(c.ch);
      return c.k ? `<span${cls}>${ch}</span>` : ch;
    }).join("")).join("\n");
  }

  const SGR = { ln: "2", ink: "", dim: "2", faint: "90", b: "1", run: "1;32", pass: "1", fail: "31", you: "33" };
  function toANSI(g) {
    return g.c.map((row) => {
      let out = "", cur = null;
      for (const c of row) {
        const code = c.ch === " " ? "" : SGR[c.k] || "";
        if (code !== cur) { out += "\x1b[0m" + (code ? `\x1b[${code}m` : ""); cur = code; }
        out += c.ch;
      }
      return out.replace(/\s+$/, "") + "\x1b[0m";
    }).join("\n");
  }

  // Reads real escape codes back, the way a terminal would, for the terminal panels.
  function ansiToHTML(s) {
    const cls = { "1": "a-b", "2": "a-dim", "3": "a-it", "31": "a-red", "32": "a-green", "33": "a-yellow", "90": "a-grey" };
    let open = "", out = "";
    const re = /\x1b\[([0-9;]*)m/g;
    let last = 0, m;
    const emit = (txt) => { for (const ch of txt) { const t = ch.charCodeAt(0) > 126 ? `<b class="w">${esc(ch)}</b>` : esc(ch); out += t; } };
    while ((m = re.exec(s))) {
      emit(s.slice(last, m.index));
      last = re.lastIndex;
      if (open) { out += "</span>"; open = ""; }
      const codes = m[1].split(";").filter((c) => c && c !== "0");
      if (codes.length) { open = codes.map((c) => cls[c] || "").join(" "); out += `<span class="${open}">`; }
    }
    emit(s.slice(last));
    if (open) out += "</span>";
    return out;
  }

  G.TopoGrid = { horizontal, vertical, strip, toHTML, toANSI, ansiToHTML };
})(globalThis);
