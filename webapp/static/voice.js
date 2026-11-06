/* Voice agent for the finished proposal.
   Hidden until game.js reports a result that has a Word document ("dealdesk:result").
   Mic -> AudioWorklet -> PCM16 24 kHz -> /api/voice/<job> (Flask relays to OCI gpt-realtime)
   OCI audio deltas -> scheduled AudioBufferSources; user speech cancels playback (barge-in). */
(() => {
  "use strict";

  const RATE = 24000;
  const $ = (s) => document.querySelector(s);
  const panel = $("#voice");
  if (!panel) return;

  let jobId = null, ws = null, ctx = null, stream = null, worklet = null, source = null;
  let playHead = 0, playing = [], muted = false, active = false;
  let current = { itemId: null, startedAt: 0 };
  let liveAgentLine = null;

  // ---------------------------------------------------------------- UI helpers
  function setState(state, label) {
    panel.dataset.state = state;
    $("#voice-state").textContent = label;
  }
  function line(who, text) {
    const li = document.createElement("li");
    li.className = who;
    const b = document.createElement("b"); b.textContent = who === "you" ? "You" : "Assistant";
    const span = document.createElement("span"); span.textContent = text;
    li.append(b, span);
    const ol = $("#voice-log"); ol.append(li); ol.scrollTop = ol.scrollHeight;
    return span;
  }
  function setButtons() {
    $("#voice-start").hidden = active;
    $("#voice-mute").hidden = !active;
    $("#voice-stop").hidden = !active;
    $("#voice-mute").textContent = muted ? "Unmute" : "Mute";
    $("#voice-mute").setAttribute("aria-pressed", String(muted));
  }

  // ---------------------------------------------------------------- audio out
  function b64ToInt16(b64) {
    const bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Int16Array(bytes.buffer);
  }
  function play(b64) {
    const pcm = b64ToInt16(b64);
    const buf = ctx.createBuffer(1, pcm.length, RATE);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(ctx.destination);
    const now = ctx.currentTime;
    if (playHead < now) playHead = now + 0.03;
    if (!current.startedAt) current.startedAt = playHead;
    src.start(playHead);
    playHead += buf.duration;
    playing.push(src);
    src.onended = () => {
      playing = playing.filter((s) => s !== src);
      if (!playing.length && active) setState("listening", "Listening");
    };
    setState("speaking", "Speaking");
  }
  function stopPlayback() {
    // Tell the model how much of its answer was actually heard, so it does not
    // assume the user heard the rest.
    if (playing.length && current.itemId && ws && ws.readyState === 1) {
      const ms = Math.max(0, Math.floor((ctx.currentTime - current.startedAt) * 1000));
      ws.send(JSON.stringify({ type: "conversation.item.truncate", item_id: current.itemId, content_index: 0, audio_end_ms: ms }));
    }
    playing.forEach((s) => { try { s.stop(); } catch (_) { /* already ended */ } });
    playing = []; playHead = 0; current.startedAt = 0;
  }

  // ---------------------------------------------------------------- audio in
  const WORKLET = `
    class Pcm16 extends AudioWorkletProcessor {
      constructor() { super(); this.buf = new Int16Array(2400); this.n = 0; }
      process(inputs) {
        const ch = inputs[0] && inputs[0][0];
        if (ch) for (let i = 0; i < ch.length; i++) {
          const v = Math.max(-1, Math.min(1, ch[i]));
          this.buf[this.n++] = v < 0 ? v * 0x8000 : v * 0x7fff;
          if (this.n === this.buf.length) { this.port.postMessage(this.buf.slice(0).buffer); this.n = 0; }
        }
        return true;
      }
    }
    registerProcessor("pcm16", Pcm16);`;

  function int16ToB64(buf) {
    const bytes = new Uint8Array(buf); let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  async function startMic() {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    source = ctx.createMediaStreamSource(stream);
    worklet = new AudioWorkletNode(ctx, "pcm16");
    // 100 ms chunks; sending is gated on the socket being open and the mic unmuted.
    worklet.port.onmessage = (e) => {
      if (muted || !ws || ws.readyState !== 1) return;
      ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: int16ToB64(e.data) }));
    };
    source.connect(worklet);
  }

  // ---------------------------------------------------------------- session
  function onMessage(m) {
    const ev = JSON.parse(m.data);
    switch (ev.type) {
      case "bridge.ready":
        setState("listening", "Listening");
        $("#voice-meta").textContent = `OCI Generative AI · ${ev.model} · voice ${ev.voice}`;
        break;
      case "bridge.error":
        $("#voice-error").textContent = ev.message; $("#voice-error").hidden = false;
        stop();
        break;
      case "error":
        console.warn("voice service error", ev.error);
        break;
      case "input_audio_buffer.speech_started":
        stopPlayback();
        setState("hearing", "Hearing you");
        break;
      case "input_audio_buffer.speech_stopped":
        setState("thinking", "Thinking");
        break;
      case "conversation.item.input_audio_transcription.completed":
        if ((ev.transcript || "").trim()) line("you", ev.transcript.trim());
        break;
      case "response.output_item.added":
        current = { itemId: ev.item && ev.item.id, startedAt: 0 };
        liveAgentLine = null;
        break;
      case "response.output_audio.delta":
        play(ev.delta);
        break;
      case "response.output_audio_transcript.delta":
        if (!liveAgentLine) liveAgentLine = line("agent", "");
        liveAgentLine.textContent += ev.delta;
        break;
      case "response.output_audio_transcript.done":
        if (liveAgentLine) liveAgentLine.textContent = ev.transcript;
        else line("agent", ev.transcript);
        liveAgentLine = null;
        break;
      case "response.done":
        if (!playing.length) setState("listening", "Listening");
        break;
    }
  }

  async function start() {
    if (active || !jobId) return;
    $("#voice-error").hidden = true;
    active = true; muted = false; setButtons();
    setState("connecting", "Connecting");
    try {
      ctx = new AudioContext({ sampleRate: RATE });
      await ctx.resume();
      await startMic();
    } catch (e) {
      $("#voice-error").textContent = "Microphone unavailable: " + e.message; $("#voice-error").hidden = false;
      stop(); return;
    }
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(`${proto}//${location.host}/api/voice/${jobId}`);
    ws.onmessage = onMessage;
    ws.onclose = () => { if (active) stop(); };
    ws.onerror = () => {
      $("#voice-error").textContent = "Lost the connection to the voice agent."; $("#voice-error").hidden = false;
    };
  }

  function stop() {
    active = false;
    if (ws) { ws.onclose = null; try { ws.close(); } catch (_) { /* closed */ } ws = null; }
    if (ctx) stopPlayback();
    if (source) source.disconnect();
    if (worklet) { worklet.port.onmessage = null; worklet.disconnect(); }
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx) ctx.close();
    ctx = stream = worklet = source = null;
    setButtons();
    setState("idle", "Ready");
  }

  function toggleMute() {
    muted = !muted;
    if (stream) stream.getAudioTracks().forEach((t) => { t.enabled = !muted; });
    setButtons();
    setState(muted ? "muted" : "listening", muted ? "Muted" : "Listening");
  }

  // ---------------------------------------------------------------- lifecycle
  document.addEventListener("dealdesk:result", async (e) => {
    stop();
    jobId = null; panel.hidden = true;
    if (!e.detail.hasDocument) return;
    try {
      const s = await (await fetch("/api/voice/status/" + e.detail.jobId)).json();
      if (!s.available) return; // no document on the server, or voice not configured
      jobId = e.detail.jobId;
      $("#voice-doc").textContent = s.document;
      $("#voice-log").innerHTML = "";
      setState("idle", "Ready");
      panel.hidden = false;
    } catch (_) { /* leave hidden */ }
  });
  document.addEventListener("dealdesk:reset", () => { stop(); jobId = null; panel.hidden = true; });
  window.addEventListener("pagehide", stop);

  $("#voice-start").addEventListener("click", start);
  $("#voice-stop").addEventListener("click", stop);
  $("#voice-mute").addEventListener("click", toggleMute);
  setButtons();
})();
