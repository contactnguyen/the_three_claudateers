/* Deal Desk Color: a 160x144 pixel game that visualises the real swarm events.
   delegate event -> orchestrator walks to the specialist and briefs them
   reply event    -> specialist raises "!", orchestrator walks over and collects the answer
   All art is drawn procedurally with the BTS-Synthetic palette only. */
(() => {
  "use strict";

  const W = 160, H = 144, HUD = 10, BOX_Y = 108;
  const C = {
    dark: "#141413", light: "#faf9f5", mid: "#b0aea5", lgray: "#e8e6dc",
    orange: "#d97757", blue: "#6a9bcc", green: "#788c5d",
  };
  const FONT = '8px "Press Start 2P", monospace';
  const HOME = { x: 80, y: 62 };
  const SPEED = 38; // px per second

  const SPECIALISTS = [
    { key: "pricing", match: "pricing", name: "Pricing Specialist", short: "PRICING", color: C.orange, icon: "$",
      x: 24, y: 36, stand: { x: 42, y: 36 },
      brief: "Pricing: recommend terms. Give me a discount band and red lines.",
      work: ["Crunching discount bands...", "Checking past wins..."],
      reply: "Terms are ready! Discount band and red lines are in." },
    { key: "legal", match: "legal", name: "Legal Reviewer", short: "LEGAL", color: C.blue, icon: "#",
      x: 136, y: 36, stand: { x: 118, y: 36 },
      brief: "Legal: flag the risky clauses and give me counter-positions.",
      work: ["Marking up the clauses...", "Ranking blockers..."],
      reply: "Clauses reviewed. Blockers and counters are listed." },
    { key: "tech", match: "technical", name: "Technical Fit Specialist", short: "TECH FIT", color: C.green, icon: "<>",
      x: 24, y: 88, stand: { x: 42, y: 88 },
      brief: "Tech: map every requirement to our product. Be honest on gaps.",
      work: ["Mapping requirements...", "Testing the fit..."],
      reply: "Fit assessment done. Gaps are marked honestly." },
    { key: "comp", match: "competitive", name: "Competitive Intel Analyst", short: "INTEL", color: C.mid, icon: "?",
      x: 136, y: 88, stand: { x: 118, y: 88 },
      brief: "Intel: who else is in this deal, and how do we position?",
      work: ["Scouting the field...", "Drafting positioning..."],
      reply: "Landscape mapped. Positioning notes are ready." },
  ];
  const AMBIENT = {
    reading: ["Reading the RFP...", "Highlighting the must-haves...", "Checking the deadline..."],
    waiting: ["Waiting for the team...", "Coffee break? No time!", "The deadline is real."],
    writing: ["Writing the Word doc...", "Applying the brand...", "Almost there..."],
  };

  const $ = (s) => document.querySelector(s);
  const canvas = $("#screen"), ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  /* ---------------------------------------------------------------- state */
  let G = null; // current game; null while idle
  const hooks = { team: () => {}, finished: () => {} };

  function newGame() {
    return {
      t: 0, startedAt: performance.now(),
      phase: "reading",
      orch: { x: HOME.x, y: HOME.y, dir: "down", walking: false, typing: false, cheer: false },
      spec: Object.fromEntries(SPECIALISTS.map((s) => [s.key, { state: "idle", alert: false }])),
      queue: [], cur: null,
      dlg: null,           // active dialogue
      ambientAt: 0, ambientI: 0, ambientText: AMBIENT.reading[0],
      replies: 0, finishing: false, finished: false,
      confetti: [],
    };
  }
  const find = (name) => SPECIALISTS.find((s) => name.toLowerCase().includes(s.match));

  /* ----------------------------------------------------------- event input */
  function handle(ev) {
    if (!G) return;
    const q = (a) => G.queue.push(a);
    if (ev.type === "delegate") {
      const s = find(ev.agent); if (!s) return;
      q({ k: "walk", to: s.stand });
      q({ k: "say", who: "SENIOR PARTNER", color: C.dark, text: s.brief });
      q({ k: "do", fn: () => { G.spec[s.key].state = "working"; hooks.team(s.key, "working"); G.phase = "waiting"; } });
      q({ k: "say", who: s.short, color: s.color, text: "On it, boss!" });
    } else if (ev.type === "reply") {
      const s = find(ev.agent); if (!s) return;
      q({ k: "do", fn: () => { G.spec[s.key].alert = true; } });
      q({ k: "walk", to: s.stand });
      q({ k: "say", who: s.short, color: s.color, text: s.reply });
      q({ k: "do", fn: () => {
        G.spec[s.key].alert = false; G.spec[s.key].state = "done";
        hooks.team(s.key, "done"); G.replies++;
      } });
      q({ k: "wait", ms: 300 });
    } else if (ev.type === "status" && /synthes/i.test(ev.msg)) {
      startWriting();
    } else if (ev.type === "tool" && G.replies >= SPECIALISTS.length) {
      startWriting();
    } else if (ev.type === "done") {
      G.finishing = true;
      startWriting();
      q({ k: "walk", to: HOME });
      q({ k: "do", fn: () => { G.orch.typing = false; G.orch.cheer = true; burst(); } });
      q({ k: "say", who: "SENIOR PARTNER", color: C.orange, text: "LEVEL CLEAR! Proposal is ready." });
      q({ k: "do", fn: () => { G.finished = true; hooks.finished(); } });
    } else if (ev.type === "error") {
      G.queue.length = 0; G.cur = null;
      q({ k: "say", who: "SENIOR PARTNER", color: C.dark, text: "Game over. Something broke." });
      q({ k: "do", fn: () => { G.finished = true; } });
    }
  }
  function startWriting() {
    if (G.phase === "writing") return;
    G.phase = "writing";
    G.queue.push({ k: "walk", to: HOME });
    G.queue.push({ k: "do", fn: () => { G.orch.typing = true; } });
    G.queue.push({ k: "say", who: "SENIOR PARTNER", color: C.dark, text: "All reports in. Time to write the proposal." });
  }

  /* --------------------------------------------------------------- actions */
  function wrap(text, n = 18) {
    const lines = []; let line = "";
    for (const w of text.split(/\s+/)) {
      if (w.length > n) { if (line) lines.push(line); lines.push(w.slice(0, n)); line = ""; continue; }
      if ((line + " " + w).trim().length > n) { lines.push(line); line = w; } else line = (line + " " + w).trim();
    }
    if (line) lines.push(line);
    return lines;
  }
  function makeDlg(a) {
    const lines = wrap(a.text), pages = [];
    for (let i = 0; i < lines.length; i += 2) pages.push(lines.slice(i, i + 2));
    return { who: a.who, color: a.color, pages, page: 0, chars: 0, hold: 0 };
  }
  const pageLen = (d) => d.pages[d.page].join("").length;

  function startAction(a) {
    G.cur = a;
    if (a.k === "walk") {
      // vertical first, then horizontal: keeps the walk clear of the desks
      a.path = [{ x: G.orch.x, y: a.to.y }, { x: a.to.x, y: a.to.y }];
    } else if (a.k === "say") {
      G.dlg = makeDlg(a);
    } else if (a.k === "wait") {
      a.left = a.ms / 1000;
    } else if (a.k === "do") {
      a.fn(); G.cur = null;
    }
  }

  function stepAction(dt) {
    const a = G.cur, o = G.orch;
    if (a.k === "walk") {
      let budget = SPEED * dt;
      o.walking = false;
      while (budget > 0 && a.path.length) {
        const p = a.path[0], dx = p.x - o.x, dy = p.y - o.y, d = Math.hypot(dx, dy);
        if (d < 0.01) { a.path.shift(); continue; }
        const m = Math.min(budget, d);
        o.x += (dx / d) * m; o.y += (dy / d) * m; budget -= m; o.walking = true;
        o.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
      }
      if (!a.path.length) { o.walking = false; G.cur = null; }
    } else if (a.k === "say") {
      const d = G.dlg;
      if (d.chars < pageLen(d)) { d.chars = Math.min(pageLen(d), d.chars + 30 * dt); }
      else {
        d.hold += dt;
        if (d.hold > 1.0) {
          if (d.page < d.pages.length - 1) { d.page++; d.chars = 0; d.hold = 0; }
          else { G.dlg = null; G.cur = null; G.ambientAt = G.t; }
        }
      }
    } else if (a.k === "wait") {
      a.left -= dt; if (a.left <= 0) G.cur = null;
    }
  }

  /* Idle filler so the screen never sits still during the long waits. */
  function idleBehaviour() {
    if (G.finished || G.finishing || G.t - G.ambientAt < 3.2) return;
    G.ambientAt = G.t;
    const lines = AMBIENT[G.phase] || AMBIENT.waiting;
    G.ambientText = lines[G.ambientI++ % lines.length];
    if (G.phase === "waiting") {
      const busy = SPECIALISTS.filter((s) => G.spec[s.key].state === "working");
      if (busy.length && G.ambientI % 2 === 0) { // check in on someone still working
        const s = busy[Math.floor(Math.random() * busy.length)];
        G.queue.push({ k: "walk", to: s.stand });
        G.queue.push({ k: "say", who: "SENIOR PARTNER", color: C.dark, text: "How is it going?" });
        G.queue.push({ k: "say", who: s.short, color: s.color, text: s.work[G.ambientI % s.work.length] });
      }
    } else if (G.phase === "reading") {
      G.orch.dir = ["down", "left", "right"][G.ambientI % 3];
    }
  }

  function burst() {
    for (let i = 0; i < 60; i++) {
      G.confetti.push({
        x: HOME.x, y: HOME.y - 10, vx: (Math.random() - 0.5) * 90, vy: -30 - Math.random() * 70,
        c: [C.orange, C.blue, C.green, C.dark][i % 4],
      });
    }
  }

  /* ----------------------------------------------------------------- update */
  function update(dt) {
    G.t += dt;
    if (!G.cur && G.queue.length) startAction(G.queue.shift());
    if (!G.cur && G.queue.length) startAction(G.queue.shift()); // allow instant 'do' chains
    if (G.cur) stepAction(dt); else { G.orch.walking = false; idleBehaviour(); }
    for (const p of G.confetti) { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 90 * dt; }
    G.confetti = G.confetti.filter((p) => p.y < BOX_Y);
  }

  /* ------------------------------------------------------------------ draw */
  const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), w, h); };
  function text(str, x, y, color) { ctx.font = FONT; ctx.textBaseline = "top"; ctx.fillStyle = color; ctx.fillText(str, Math.round(x), Math.round(y)); }

  function drawFloor() {
    R(0, HUD, W, BOX_Y - HUD, C.light);
    for (let y = HUD; y < BOX_Y; y += 8) for (let x = 0; x < W; x += 8) {
      if (((x + y) / 8) % 2 === 0) R(x, y, 8, 8, C.lgray);
    }
    // rug at the orchestrator's home
    R(HOME.x - 20, HOME.y - 14, 40, 26, C.dark);
    R(HOME.x - 19, HOME.y - 13, 38, 24, C.light);
    R(HOME.x - 17, HOME.y - 11, 34, 20, C.orange);
    R(HOME.x - 15, HOME.y - 9, 30, 16, C.light);
  }

  function drawDesk(s) {
    const st = G.spec[s.key], x = s.x, y = s.y;
    R(x - 11, y + 1, 22, 9, C.dark);
    R(x - 10, y + 2, 20, 6, s.color);
    // monitor
    R(x - 4, y - 1, 9, 6, C.dark);
    const on = st.state === "working" && Math.floor(G.t * 4) % 2 === 0;
    R(x - 3, y, 7, 4, st.state === "done" ? C.green : on ? C.blue : C.mid);
  }

  function person(x, y, shirt, dir, step, extra) {
    const bob = step ? (step % 2) : 0;
    R(x - 3, y - 2, 2, 2 + (step === 1 ? -1 : 0), C.dark);
    R(x + 1, y - 2, 2, 2 + (step === 3 ? -1 : 0), C.dark);
    R(x - 3, y - 7 - bob, 6, 5, shirt);
    if (extra === "tie") R(x, y - 7 - bob, 1, 3, C.orange);
    R(x - 3, y - 12 - bob, 6, 5, C.lgray);        // face
    R(x - 3, y - 13 - bob, 6, 2, C.dark);          // hair
    if (dir !== "up") {
      const ex = dir === "left" ? -2 : dir === "right" ? 1 : 0;
      R(x - 2 + ex, y - 10 - bob, 1, 1, C.dark); R(x + 1 + ex, y - 10 - bob, 1, 1, C.dark);
    }
  }

  function bubble(cx, y, str, color) {
    const w = str.length * 8 + 4;
    R(cx - w / 2 - 1, y - 1, w + 2, 12, C.dark);
    R(cx - w / 2, y, w, 10, C.light);
    text(str, cx - w / 2 + 2, y + 1, color);
    R(cx - 1, y + 10, 3, 2, C.dark);
  }

  function drawSpec(s) {
    const st = G.spec[s.key];
    person(s.x, s.y, s.color, "down", 0);
    if (st.alert) bubble(s.x, s.y - 28, Math.floor(G.t * 5) % 2 ? "!" : "!!", C.orange);
    else if (st.state === "working") {
      const dots = ".".repeat(1 + (Math.floor(G.t * 2.5) % 3));
      bubble(s.x, s.y - 28, Math.floor(G.t) % 2 ? s.icon : dots, C.dark);
    } else if (st.state === "done") bubble(s.x, s.y - 28, "OK", C.green);
  }

  function drawOrch() {
    const o = G.orch, step = o.walking ? 1 + (Math.floor(G.t * 8) % 4) : 0;
    const cheer = o.cheer ? Math.floor(G.t * 6) % 2 : 0;
    person(o.x, o.y - cheer * 2, C.dark, o.dir, step, "tie");
    if (o.cheer) { R(o.x - 5, o.y - 16 - cheer * 2, 2, 4, C.lgray); R(o.x + 3, o.y - 16 - cheer * 2, 2, 4, C.lgray); }
    if (o.typing) { // laptop with sparks
      R(o.x + 5, o.y - 4, 9, 6, C.dark); R(o.x + 6, o.y - 3, 7, 4, Math.floor(G.t * 6) % 2 ? C.blue : C.light);
      const k = Math.floor(G.t * 8) % 3;
      R(o.x + 6 + k * 3, o.y - 8 - (k % 2) * 2, 2, 2, C.orange);
    }
    if (G.phase === "reading" && !o.walking) { // holds the RFP
      R(o.x + 4, o.y - 8, 6, 8, C.dark); R(o.x + 5, o.y - 7, 4, 6, C.light);
      R(o.x + 6, o.y - 5, 2, 1, C.orange);
    }
  }

  function drawHUD() {
    R(0, 0, W, HUD, C.dark);
    const s = Math.floor((performance.now() - G.startedAt) / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0"), ss = String(s % 60).padStart(2, "0");
    text(`TIME ${mm}:${ss}`, 3, 1, C.light);
    text(`TEAM ${G.replies}/${SPECIALISTS.length}`, W - 8 * 8 - 3, 1, C.orange);
  }

  function drawBox() {
    R(0, BOX_Y, W, H - BOX_Y, C.dark);
    R(2, BOX_Y + 2, W - 4, H - BOX_Y - 4, C.light);
    R(3, BOX_Y + 3, W - 6, H - BOX_Y - 6, C.dark);
    R(4, BOX_Y + 4, W - 8, H - BOX_Y - 8, C.light);
    const d = G.dlg;
    if (d) {
      text(d.who + ":", 8, BOX_Y + 7, d.color === C.mid ? C.dark : d.color);
      let left = Math.floor(d.chars);
      d.pages[d.page].forEach((line, i) => {
        const part = line.slice(0, Math.max(0, left)); left -= line.length;
        text(part, 8, BOX_Y + 17 + i * 10, C.dark);
      });
      if (d.chars >= pageLen(d) && Math.floor(G.t * 3) % 2) R(W - 12, H - 11, 4, 3, C.orange);
    } else {
      text("SENIOR PARTNER:", 8, BOX_Y + 7, C.orange);
      wrap(G.ambientText).slice(0, 2).forEach((l, i) => text(l, 8, BOX_Y + 17 + i * 10, C.dark));
    }
  }

  function draw() {
    drawFloor();
    const actors = [
      ...SPECIALISTS.map((s) => ({ y: s.y, f: () => { drawDesk(s); drawSpec(s); } })),
      { y: G.orch.y, f: drawOrch },
    ].sort((a, b) => a.y - b.y);
    actors.forEach((a) => a.f());
    for (const p of G.confetti) R(p.x, p.y, 2, 2, p.c);
    drawHUD(); drawBox();
  }

  function drawTitle() {
    R(0, 0, W, H, C.light);
    for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 8) if (((x + y) / 8) % 2 === 0) R(x, y, 8, 8, C.lgray);
    R(10, 22, 140, 64, C.dark); R(12, 24, 136, 60, C.light); R(14, 26, 132, 56, C.dark);
    text("DEAL DESK", 44, 36, C.orange);
    text("COLOR", 60, 50, C.light);
    text("BTS-SYNTHETIC", 28, 68, C.mid);
    if (Math.floor(performance.now() / 500) % 2) text("PRESS START", 36, 104, C.dark);
    // lineup of the team
    SPECIALISTS.forEach((s, i) => person(30 + i * 34, 130, s.color, "down", 0));
  }

  /* ------------------------------------------------------------------ loop */
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now;
    if (G) { update(dt); draw(); } else drawTitle();
    requestAnimationFrame(frame);
  }

  /* A button: finish typing, or skip to the next page. */
  function pressA() {
    const d = G && G.dlg; if (!d) return;
    if (d.chars < pageLen(d)) d.chars = pageLen(d); else d.hold = 99;
  }

  window.DealDeskGame = {
    start() { G = newGame(); $("#led").classList.add("on"); },
    handle, pressA,
    onTeam(fn) { hooks.team = fn; }, onFinished(fn) { hooks.finished = fn; },
    stop() { $("#led").classList.remove("on"); },
  };
  (document.fonts ? document.fonts.load(FONT) : Promise.resolve()).finally(() => requestAnimationFrame(frame));
})();

/* ===================================================================== UI */
(() => {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const TEAM = [
    ["pricing", "Pricing Specialist"], ["legal", "Legal Reviewer"],
    ["tech", "Technical Fit Specialist"], ["comp", "Competitive Intel Analyst"],
  ];
  const LABEL = { waiting: "Waiting", working: "Working", done: "Reported" };
  let es = null, jobId = null, t0 = 0, timer = null;

  function renderTeam() {
    $("#team").innerHTML = TEAM.map(([k, n]) =>
      `<li><span>${n}</span><span class="chip waiting" id="chip-${k}">${LABEL.waiting}</span></li>`).join("");
  }
  function setChip(k, state) {
    const el = $("#chip-" + k); if (!el) return;
    el.className = "chip " + state; el.textContent = LABEL[state];
  }
  function logLine(msg) {
    const s = Math.floor((Date.now() - t0) / 1000);
    const li = document.createElement("li");
    const tm = document.createElement("time");
    tm.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
    li.append(tm, msg);
    const ol = $("#log"); ol.append(li); ol.scrollTop = ol.scrollHeight;
  }
  function showError(msg) { const e = $("#error"); e.textContent = msg; e.hidden = false; }
  function finishUI() {
    clearInterval(timer); $("#generate").disabled = false; DealDeskGame.stop();
  }

  async function generate() {
    if (es) es.close();
    $("#error").hidden = true; $("#result").hidden = true; $("#log").innerHTML = "";
    document.dispatchEvent(new CustomEvent("dealdesk:reset"));
    renderTeam();
    $("#generate").disabled = true;
    t0 = Date.now();
    timer = setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000);
      $("#elapsed").textContent = `Running for ${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
    }, 1000);
    DealDeskGame.start();
    $("#stage").scrollIntoView({ behavior: "smooth", block: "start" });

    let res;
    try {
      res = await fetch("/api/generate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rfp: $("#rfp").value }),
      });
      if (!res.ok) throw new Error(await res.text());
    } catch (e) { showError("Could not start the run: " + e.message); finishUI(); return; }
    jobId = (await res.json()).job;

    es = new EventSource("/api/events/" + jobId);
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data);
      DealDeskGame.handle(ev);
      if (ev.type === "status") logLine(ev.msg);
      else if (ev.type === "delegate") logLine("Briefed " + ev.agent);
      else if (ev.type === "reply") logLine(ev.agent + " reported back");
      else if (ev.type === "done") { logLine("Proposal ready"); es.close(); }
      else if (ev.type === "error") { logLine("Error"); showError(ev.msg); es.close(); finishUI(); }
    };
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) return;
      es.close(); showError("Lost the connection to the server."); finishUI();
    };
  }

  async function showResult() {
    finishUI();
    const r = await (await fetch("/api/result/" + jobId)).json();
    const paper = $("#tab-doc");
    paper.innerHTML = r.html || "<p><em>The swarm did not produce a Word document. See the specialist briefings.</em></p>";
    const toc = $("#toc"); toc.innerHTML = "";
    paper.querySelectorAll("h1").forEach((h, i) => {
      h.id = "sec-" + i;
      const a = document.createElement("a"); a.href = "#sec-" + i; a.textContent = h.textContent; toc.append(a);
    });
    $("#downloads").innerHTML = r.files.map((f) => `<a href="${f.url}" download>Download ${f.name}</a>`).join(" ");
    const specs = $("#tab-spec"); specs.innerHTML = "";
    if (!r.specialists.length) specs.innerHTML = "<p class='caption'>No specialist replies were captured.</p>";
    r.specialists.forEach((s) => {
      const d = document.createElement("div"); d.className = "spec";
      const h = document.createElement("h3"); h.textContent = s.agent;
      const p = document.createElement("pre"); p.textContent = s.text || "(reply text not available in the event stream)";
      d.append(h, p); specs.append(d);
    });
    $("#result").hidden = false;
    $("#result").scrollIntoView({ behavior: "smooth" });
    // The voice agent (voice.js) only wakes up once there is a document to talk about.
    document.dispatchEvent(new CustomEvent("dealdesk:result", { detail: { jobId, hasDocument: !!r.html } }));
  }

  document.querySelectorAll(".tabs button").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll(".tabs button").forEach((x) => x.setAttribute("aria-selected", x === b));
    $("#tab-doc").hidden = b.dataset.tab !== "doc"; $("#toc").hidden = b.dataset.tab !== "doc";
    $("#tab-spec").hidden = b.dataset.tab !== "spec";
  }));

  DealDeskGame.onTeam(setChip);
  DealDeskGame.onFinished(showResult);
  const start = () => { if (!$("#generate").disabled) generate(); };
  $("#generate").addEventListener("click", start);
  $("#btn-start").addEventListener("click", start);
  $("#btn-a").addEventListener("click", () => DealDeskGame.pressA());
  document.addEventListener("keydown", (e) => {
    if (e.target.matches("select, button")) return;
    if (e.key === "z" || e.key === "Enter") DealDeskGame.pressA();
  });

  renderTeam();
  fetch("/api/config").then((r) => r.json()).then((c) => {
    $("#rfp").innerHTML = c.rfps.map((r) => `<option value="${r.id}">${r.label}</option>`).join("");
    if (c.demo) $("#demo-flag").hidden = false;
  });
})();
