// Lecteur de partition : affiche le MusicXML, joue un métronome et fait avancer un curseur
// en colorant en rouge les notes déjà jouées.
(() => {
  const $ = (id) => document.getElementById(id);
  const DEFAULT_BPM = 80;
  const LOOKAHEAD = 0.12; // secondes d'avance pour programmer les clics

  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
  };

  const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay($("score"), {
    backend: "svg",
    autoResize: false,
    drawTitle: true,
    drawPartNames: false,
    followCursor: false,
    cursorsOptions: [{ type: 0, color: "#2563eb", alpha: 0.35, follow: false }],
  });

  const state = {
    file: null,
    zoom: store.get("zoom", 1),
    bpm: DEFAULT_BPM,
    countIn: store.get("countIn", true),
    sound: store.get("sound", true),
    steps: [],     // positions du curseur : { rel, seg, time, els }
    segments: [],  // mesures dans l'ordre de lecture (reprises déroulées)
    beats: [],     // clics du métronome : { time, accent }
    cursorIdx: 0,  // position actuelle du curseur OSMD dans steps
    playedIdx: 0,  // nombre d'étapes déjà colorées
    posSec: 0,     // position musicale (s) quand on est à l'arrêt
    playing: false,
  };

  // ---------- Audio ----------
  let ctx = null;
  function audio() {
    if (!ctx) {
      // Sur iPad, joue même si le bouton silencieux est activé (Safari 16.4+).
      if (navigator.audioSession) try { navigator.audioSession.type = "playback"; } catch {}
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state !== "running") ctx.resume();
    return ctx;
  }

  function click(at, accent) {
    if (!state.sound) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = accent ? 1760 : 1100;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.9 : 0.55, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    osc.connect(gain).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.06);
  }

  // ---------- Analyse de la partition ----------
  function buildSteps() {
    const c = osmd.cursor;
    c.reset();
    const steps = [], segments = [];
    let lastMeasure = -1, lastRel = -1;
    while (!c.Iterator.EndReached) {
      const it = c.Iterator;
      const rel = it.CurrentRelativeInMeasureTimestamp.RealValue;
      const mIdx = it.CurrentMeasureIndex;
      if (mIdx !== lastMeasure || rel <= lastRel) {
        const m = it.CurrentMeasure;
        const ts = m.ActiveTimeSignature;
        segments.push({
          measure: mIdx,
          duration: m.Duration.RealValue,
          num: ts ? ts.Numerator : 4,
          den: ts ? ts.Denominator : 4,
        });
      }
      lastMeasure = mIdx;
      lastRel = rel;
      const els = new Set();
      for (const g of c.GNotesUnderCursor()) {
        if (g.sourceNote.isRest()) continue;
        const el = g.getSVGGElement && g.getSVGGElement();
        if (el) els.add(el);
      }
      steps.push({ rel, seg: segments.length - 1, time: 0, els: [...els] });
      c.next();
    }
    c.reset();
    state.steps = steps;
    state.segments = segments;
    state.cursorIdx = 0;
    computeTimes();
  }

  // Le BPM compte l'unité du chiffrage (noire en 4/4, croche en 6/8).
  function computeTimes() {
    const beatSec = 60 / state.bpm;
    let t = 0;
    state.beats = [];
    for (const s of state.segments) {
      s.start = t;
      s.secPerWhole = beatSec * s.den;
      const n = Math.max(1, Math.round(s.duration * s.den));
      for (let k = 0; k < n; k++) state.beats.push({ time: t + k * beatSec, accent: k === 0 });
      t += s.duration * s.secPerWhole;
    }
    state.total = t;
    for (const st of state.steps) {
      const s = state.segments[st.seg];
      st.time = s.start + st.rel * s.secPerWhole;
    }
  }

  // ---------- Curseur & couleurs ----------
  function moveCursor(idx) {
    const c = osmd.cursor;
    if (idx < state.cursorIdx) { c.reset(); state.cursorIdx = 0; }
    while (state.cursorIdx < idx && !c.Iterator.EndReached) { c.next(); state.cursorIdx++; }
    followCursor();
  }

  let lastCursorTop = null;
  function followCursor(force) {
    const el = osmd.cursor.cursorElement;
    if (!el) return;
    const top = el.offsetTop;
    if (!force && top === lastCursorTop) return;
    lastCursorTop = top;
    const scroller = $("scroller");
    const r = el.getBoundingClientRect(), sr = scroller.getBoundingClientRect();
    // Garde la ligne en cours dans le tiers supérieur de l'écran.
    const target = scroller.scrollTop + (r.top - sr.top) - sr.height * 0.18;
    scroller.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  }

  const measureOf = (i) => state.segments[state.steps[i].seg].measure;

  // Colore les n premières étapes ; à chaque reprise, les mesures rejouées redeviennent noires.
  function colorUpTo(n) {
    const set = (i, on) => { for (const el of state.steps[i].els) el.classList.toggle("played", on); };
    for (let i = 0; i < Math.max(n, state.playedIdx); i++) set(i, false);
    for (let i = 0; i < n; i++) {
      if (i > 0 && measureOf(i) < measureOf(i - 1)) {
        const from = measureOf(i);
        for (let j = 0; j < i; j++) if (measureOf(j) >= from) set(j, false);
      }
      set(i, true);
    }
    state.playedIdx = n;
  }

  function stepAt(sec) {
    let i = 0;
    while (i < state.steps.length && state.steps[i].time <= sec + 1e-6) i++;
    return i; // nombre d'étapes commencées avant sec
  }

  function seekTo(sec) {
    state.posSec = Math.max(0, Math.min(sec, state.total));
    const started = stepAt(state.posSec);
    moveCursor(Math.max(0, started - 1));
    colorUpTo(Math.max(0, started - 1));
  }

  // ---------- Lecture ----------
  let t0 = 0, nextBeat = 0, timer = null, raf = null;

  function play(withCountIn = state.countIn) {
    if (!state.steps.length) return;
    audio();
    if (state.posSec >= state.total - 1e-3) seekTo(0);
    state.playing = true;
    updateTransport();

    const beatSec = 60 / state.bpm;
    const startStep = state.steps[Math.min(stepAt(state.posSec), state.steps.length - 1)];
    const seg = state.segments[startStep ? startStep.seg : 0];
    const lead = withCountIn ? seg.num * beatSec : 0;
    const startAt = ctx.currentTime + 0.15;
    t0 = startAt + lead - state.posSec;

    // Décompte
    for (let k = 0; k * beatSec < lead - 1e-6; k++) {
      const at = startAt + k * beatSec;
      click(at, k === 0);
      scheduleVisual(at, k === 0, seg.num - k);
    }

    nextBeat = state.beats.findIndex((b) => b.time >= state.posSec - 1e-6);
    if (nextBeat < 0) nextBeat = state.beats.length;
    // Positionne le curseur sur la note de départ et la colore dès le premier temps.
    colorUpTo(Math.max(0, stepAt(state.posSec) - 1));
    timer = setInterval(schedule, 25);
    schedule();
    raf = requestAnimationFrame(tick);
    requestWakeLock();
  }

  function schedule() {
    while (nextBeat < state.beats.length && t0 + state.beats[nextBeat].time < ctx.currentTime + LOOKAHEAD) {
      const b = state.beats[nextBeat++];
      click(t0 + b.time, b.accent);
      scheduleVisual(t0 + b.time, b.accent);
    }
  }

  function scheduleVisual(at, accent, countLabel) {
    const delay = Math.max(0, (at - ctx.currentTime + (ctx.outputLatency || 0)) * 1000);
    setTimeout(() => {
      if (!state.playing) return;
      const beat = $("beat");
      beat.classList.toggle("accent", accent);
      beat.classList.add("flash");
      setTimeout(() => beat.classList.remove("flash"), 90);
      const ci = $("countIn");
      if (countLabel !== undefined) { ci.textContent = countLabel; ci.hidden = false; }
      else ci.hidden = true;
    }, delay);
  }

  function tick() {
    if (!state.playing) return;
    const now = ctx.currentTime - t0 - (ctx.outputLatency || 0);
    if (now >= 0) {
      const started = stepAt(now);
      if (started > 0 && started - 1 !== state.cursorIdx) moveCursor(started - 1);
      if (started > state.playedIdx) colorUpTo(started);
      state.posSec = now;
      if (now >= state.total) {
        pause();
        state.posSec = state.total;
        return;
      }
    }
    raf = requestAnimationFrame(tick);
  }

  function pause() {
    state.playing = false;
    clearInterval(timer);
    cancelAnimationFrame(raf);
    $("countIn").hidden = true;
    if (ctx) state.posSec = Math.max(0, Math.min(state.total, ctx.currentTime - t0));
    // Reprend sur la note en cours plutôt qu'au milieu.
    const started = stepAt(state.posSec);
    if (started > 0) state.posSec = state.steps[started - 1].time;
    updateTransport();
    releaseWakeLock();
  }

  function rewind() {
    const wasPlaying = state.playing;
    if (wasPlaying) pause();
    colorUpTo(0);
    seekTo(0);
    followCursor(true);
    if (wasPlaying) play();
  }

  function setBpm(v) {
    v = Math.round(Math.max(20, Math.min(240, Number(v) || DEFAULT_BPM)));
    if (v === state.bpm) { $("bpm").value = v; return; }
    const wasPlaying = state.playing;
    if (wasPlaying) pause();
    const ratio = state.bpm / v;
    state.bpm = v;
    $("bpm").value = v;
    computeTimes();
    state.posSec *= ratio;
    if (state.file) store.set("bpm:" + state.file, v);
    if (wasPlaying) play(false);
  }

  // Empêche l'écran de se verrouiller pendant la lecture (si le navigateur le permet).
  let wakeLock = null;
  async function requestWakeLock() { try { wakeLock = await navigator.wakeLock?.request("screen"); } catch {} }
  function releaseWakeLock() { try { wakeLock?.release(); } catch {} wakeLock = null; }

  // ---------- Rendu ----------
  async function render() {
    const keepIdx = state.playedIdx;
    const keepPos = state.posSec;
    osmd.Zoom = state.zoom;
    osmd.render();
    osmd.cursor.show();
    state.playedIdx = 0;
    buildSteps();
    state.posSec = keepPos;
    colorUpTo(Math.min(keepIdx, state.steps.length));
    moveCursor(Math.max(0, stepAt(keepPos) - 1));
    lastCursorTop = null;
  }

  async function rerender() {
    if (!state.file) return;
    const wasPlaying = state.playing;
    if (wasPlaying) pause();
    await render();
    if (wasPlaying) play(false);
  }

  async function loadScore(file) {
    if (state.playing) pause();
    $("scoreTitle").textContent = "Chargement…";
    const res = await fetch("scores/" + encodeURIComponent(file));
    const buf = new Uint8Array(await res.arrayBuffer());
    let content;
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      // .mxl (zip) : OSMD attend une chaîne binaire
      let s = "";
      for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
      content = s;
    } else {
      content = new TextDecoder().decode(buf);
    }
    try {
      await osmd.load(content);
    } catch (e) {
      $("scoreTitle").textContent = "Impossible de lire cette partition";
      throw e;
    }
    state.file = file;
    store.set("lastScore", file);
    state.playedIdx = 0;
    state.posSec = 0;
    state.bpm = store.get("bpm:" + file, DEFAULT_BPM);
    $("bpm").value = state.bpm;
    $("empty").hidden = true;
    $("scoreTitle").textContent = osmd.Sheet.TitleString || file.replace(/\.[^.]+$/, "").replace(/_/g, " ");
    await render();
    $("scroller").scrollTop = 0;
    updateTransport();
    refreshLibrary();
  }

  // Toucher une note : démarre à cet endroit.
  $("score").addEventListener("click", (e) => {
    if (!state.steps.length) return;
    let best = -1, bestDist = Infinity;
    state.steps.forEach((st, i) => {
      for (const el of st.els) {
        const r = el.getBoundingClientRect();
        if (!r.width && !r.height) continue;
        const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
        const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
        const d = dx + dy * 3; // privilégie la portée touchée
        if (d < bestDist) { bestDist = d; best = i; }
      }
    });
    if (best < 0 || bestDist > 120) return;
    const wasPlaying = state.playing;
    if (wasPlaying) pause();
    state.posSec = state.steps[best].time;
    colorUpTo(best);
    moveCursor(best);
    if (wasPlaying) play();
  });

  // ---------- Interface ----------
  function updateTransport() {
    const has = state.steps.length > 0;
    $("btnPlay").disabled = !has;
    $("btnStop").disabled = !has;
    $("btnPlay").textContent = state.playing ? "❚❚" : "▶";
    $("btnPlay").classList.toggle("playing", state.playing);
    $("btnPlay").setAttribute("aria-label", state.playing ? "Pause" : "Lecture");
  }

  $("btnPlay").onclick = () => (state.playing ? pause() : play());
  $("btnStop").onclick = rewind;
  $("btnSlower").onclick = () => setBpm(state.bpm - 4);
  $("btnFaster").onclick = () => setBpm(state.bpm + 4);
  $("bpm").onchange = (e) => setBpm(e.target.value);
  $("bpm").onkeydown = (e) => { if (e.key === "Enter") e.target.blur(); };

  function syncToggles() {
    $("btnCountIn").classList.toggle("on", state.countIn);
    $("btnSound").classList.toggle("on", state.sound);
    $("btnSound").textContent = state.sound ? "🔊" : "🔇";
  }
  $("btnCountIn").onclick = () => { state.countIn = !state.countIn; store.set("countIn", state.countIn); syncToggles(); };
  $("btnSound").onclick = () => { state.sound = !state.sound; store.set("sound", state.sound); syncToggles(); };
  $("btnZoomIn").onclick = () => { state.zoom = Math.min(2.5, +(state.zoom + 0.1).toFixed(2)); store.set("zoom", state.zoom); rerender(); };
  $("btnZoomOut").onclick = () => { state.zoom = Math.max(0.4, +(state.zoom - 0.1).toFixed(2)); store.set("zoom", state.zoom); rerender(); };

  document.addEventListener("keydown", (e) => {
    if (e.code === "Space" && e.target.tagName !== "INPUT") { e.preventDefault(); $("btnPlay").click(); }
  });

  let resizeTimer, lastWidth = window.innerWidth;
  window.addEventListener("resize", () => {
    if (window.innerWidth === lastWidth) return;
    lastWidth = window.innerWidth;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(rerender, 300);
  });

  // ---------- Bibliothèque ----------
  const openLibrary = () => { $("library").hidden = false; refreshLibrary(); };
  const closeLibrary = () => { $("library").hidden = true; };
  $("btnLibrary").onclick = openLibrary;
  $("btnCloseLibrary").onclick = closeLibrary;
  $("library").onclick = (e) => { if (e.target === $("library")) closeLibrary(); };

  async function refreshLibrary() {
    const files = await (await fetch("api/scores")).json();
    const ul = $("scoreList");
    ul.innerHTML = "";
    for (const f of files) {
      const li = document.createElement("li");
      li.classList.toggle("current", f === state.file);
      const open = document.createElement("button");
      open.className = "open";
      open.textContent = f.replace(/\.[^.]+$/, "").replace(/_/g, " ");
      open.onclick = async () => { closeLibrary(); await loadScore(f); };
      const del = document.createElement("button");
      del.className = "delete icon small";
      del.textContent = "🗑";
      del.setAttribute("aria-label", "Supprimer " + f);
      let armed = false;
      del.onclick = async () => {
        if (!armed) { armed = true; del.textContent = "Supprimer ?"; setTimeout(() => { armed = false; del.textContent = "🗑"; }, 3000); return; }
        await fetch("api/scores/" + encodeURIComponent(f), { method: "DELETE" });
        refreshLibrary();
      };
      li.append(open, del);
      ul.append(li);
    }
    if (!files.length) ul.innerHTML = '<li style="color:var(--muted);padding:12px 4px">Aucune partition pour l’instant.</li>';
  }

  function showStatus(text, isError) {
    const s = $("uploadStatus");
    s.hidden = !text;
    s.textContent = text || "";
    s.classList.toggle("error", !!isError);
  }

  $("fileInput").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    const isPdf = /\.pdf$/i.test(file.name) || file.type === "application/pdf";
    showStatus(isPdf ? "Reconnaissance de la partition en cours…\nCela peut prendre 1 à 3 minutes." : "Import en cours…");
    $("fileInput").parentElement.classList.add("busy");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("api/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Erreur inconnue");
      showStatus("");
      closeLibrary();
      await loadScore(data.files[0]);
    } catch (err) {
      showStatus(err.message, true);
    } finally {
      $("fileInput").parentElement.classList.remove("busy");
    }
  };

  // ---------- Démarrage ----------
  syncToggles();
  updateTransport();
  fetch("api/status").then((r) => r.json()).then((s) => { $("audiverisWarning").hidden = s.audiveris; }).catch(() => {});
  const last = store.get("lastScore", null);
  (async () => {
    const files = await (await fetch("api/scores")).json().catch(() => []);
    if (last && files.includes(last)) loadScore(last).catch(console.error);
    else if (!files.length) openLibrary();
  })();
})();
