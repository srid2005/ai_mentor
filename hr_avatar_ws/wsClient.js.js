/**
 * wsClient.js  –  WebSocket · STT · TTS · Wave Visualization · Jaw-Sync
 *
 * Communicates with the p5.js avatar through:
 *   window.emotionController.playEmotion(tone, ms)
 *   window.emotionController.startSpeaking()
 *   window.emotionController.stopSpeaking()
 *   window.emotionController.externalSpeakValue   (0..1, jaw amplitude)
 */

window.addEventListener('load', function () {

  // ─── Config ────────────────────────────────────────────────────────────────
  const WS_URL     = 'ws://localhost:8000/ws';
  const BAR_COUNT  = 28;
  const USER_COLOR = '#4a9eff';          // blue  – user mic
  const AVTR_COLOR = '#f09060';          // warm orange – avatar speech
  const LERP_USER  = 0.22;              // how fast user bars follow FFT
  const LERP_AVTR  = 0.13;              // how fluid avatar bars animate

  // ─── DOM refs ──────────────────────────────────────────────────────────────
  const micBtn       = document.getElementById('mic-btn');
  const statusEl     = document.getElementById('status-text');
  const transcriptEl = document.getElementById('transcript-overlay');
  const userCvs      = document.getElementById('user-wave');
  const avtrCvs      = document.getElementById('avatar-wave');
  const userCtx      = userCvs.getContext('2d');
  const avtrCtx      = avtrCvs.getContext('2d');

  // ─── App state ─────────────────────────────────────────────────────────────
  //   idle | listening | processing | avatar-speaking
  let appState = 'idle';

  // ─── Smoothed bar values (Float32Array for perf) ───────────────────────────
  const userBars = new Float32Array(BAR_COUNT).fill(0);
  const avtrBars = new Float32Array(BAR_COUNT).fill(0);

  // Avatar wave amplitude (still used to fade the visualizer bars in/out)
  let avtrAmpTarget  = 0;   // 0 or 1
  let avtrAmpCurrent = 0;   // smoothly lerped

  // ── Keyframe lip-sync engine state ──────────────────────────────────────
  let speechSchedule   = [];   // [{start,end,peak,press}, ...] in ms, relative to speech start
  let wordBoundaries    = [];  // [{charIndex, expectedTime}, ...] for onboundary resync
  let speechStartTime   = 0;   // performance.now() at synth.speak()
  let scheduleOffset    = 0;   // ms drift correction applied by onboundary events
  let scheduleTotalMs   = 0;   // predicted total duration (fallback if TTS never ends cleanly)

  // ─────────────────────────────────────────────────────────────────────────────
  //  WebSocket
  // ─────────────────────────────────────────────────────────────────────────────
  let ws = null;

  function connectWS() {
    try { ws = new WebSocket(WS_URL); }
    catch (e) { scheduleReconnect(); return; }

    ws.onopen = () => {
      console.log('[WS] connected');
      if (appState === 'idle') setStatus('Click mic to speak');
    };

    ws.onmessage = e => {
      try { handleResponse(JSON.parse(e.data)); }
      catch (err) { console.error('[WS] bad JSON', err); }
    };

    ws.onclose = () => {
      console.warn('[WS] closed');
      setStatus('Reconnecting…');
      scheduleReconnect();
    };

    ws.onerror = () => ws.close();
  }

  function scheduleReconnect() { setTimeout(connectWS, 2000); }

  function sendText(text) {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ text }));
    } else {
      setStatus('No connection — retrying…');
      setState('idle');
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  Response handler  →  emotion + TTS
  // ─────────────────────────────────────────────────────────────────────────────
  function handleResponse({ text, tone }) {
    // 1. Trigger avatar emotion
    if (window.emotionController) emotionController.playEmotion(tone, 600);

    // 2. Show interviewer text above wave bar
    showTranscript(text, false, true);

    // 3. TTS  →  jaw sync
    speakAsAvatar(text);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  TTS (Web Speech SpeechSynthesis)
  // ─────────────────────────────────────────────────────────────────────────────
  const synth = window.speechSynthesis;

  function speakAsAvatar(text) {
    if (synth.speaking) synth.cancel();
    setState('avatar-speaking');
    avtrAmpTarget = 1;
    if (window.emotionController) emotionController.startSpeaking();

    const utter      = new SpeechSynthesisUtterance(text);
    utter.rate       = 0.92;
    utter.pitch      = 1.05;
    utter.volume     = 1.0;

    // Build the keyframe schedule up front, timed to this utterance's rate
    const built = buildSpeechSchedule(text, utter.rate);
    speechSchedule  = built.schedule;
    wordBoundaries  = built.wordBoundaries;
    scheduleTotalMs = built.totalDuration;
    scheduleOffset  = 0;
    speechStartTime = performance.now();

    // Chrome/Edge fire 'boundary' events per word with real charIndex timing.
    // Use them to correct drift between our syllable estimate and actual TTS pace.
    utter.onboundary = (e) => {
      if (e.name && e.name !== 'word') return;
      const actualElapsed = performance.now() - speechStartTime;
      const wb = wordBoundaries.find(w => w.charIndex === e.charIndex);
      if (wb) scheduleOffset = actualElapsed - wb.expectedTime;
    };

    utter.onend      = avatarDone;
    utter.onerror    = avatarDone;
    synth.speak(utter);
  }

  function avatarDone() {
    avtrAmpTarget   = 0;
    speechSchedule  = [];
    wordBoundaries  = [];
    scheduleOffset  = 0;
    scheduleTotalMs = 0;
    if (window.emotionController) {
      emotionController.externalSpeakValue = -1; // restore internal noise
      emotionController.stopSpeaking();
      emotionController.playEmotion('neutral', 800);
    }
    setState('idle');
    fadeOutTranscript();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  Keyframe lip-sync engine
  //  Text → per-syllable jaw-open arcs, with bilabial (b/p/m/w) lip-press dips
  // ─────────────────────────────────────────────────────────────────────────────

  /** Crude but effective vowel-group syllable counter */
  function countSyllables(word) {
    const w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return 0;
    const groups = w.match(/[aeiouy]+/g);
    let count = groups ? groups.length : 1;
    if (w.length > 2 && w.endsWith('e') && !w.endsWith('le')) count--;
    return Math.max(1, count);
  }

  /** Bilabial onset → lips must press fully closed before releasing */
  function isBilabialOnset(word) {
    return /^[bpmw]/i.test(word);
  }

  /**
   * Turns text into a millisecond-timed schedule of jaw-open arcs.
   * Each syllable becomes one hump (0 → peak → 0); bilabial-onset syllables
   * get a closed "press" phase first, then a quick release into the vowel.
   */
  function buildSpeechSchedule(text, rate) {
    const words          = text.trim().split(/\s+/).filter(Boolean);
    const msPerSyllable  = 235 / rate;   // baseline pace at rate=1
    const wordGapMs      = 55  / rate;

    const schedule       = [];
    const wordBoundaries = [];
    let   t = 0;
    let   charIndex = 0;

    for (const raw of words) {
      const clean = raw.replace(/[^a-zA-Z']/g, '');
      wordBoundaries.push({ charIndex, expectedTime: t });
      charIndex += raw.length + 1; // +1 for the space consumed by indexOf-style boundaries

      if (!clean) { t += wordGapMs; continue; }

      const syllables    = countSyllables(clean);
      const bilabial     = isBilabialOnset(clean);
      const syllableDur  = msPerSyllable;

      for (let s = 0; s < syllables; s++) {
        const segStart = t + s * syllableDur;
        const segEnd   = segStart + syllableDur;
        const press    = (s === 0 && bilabial);
        schedule.push({
          start: segStart,
          end:   segEnd,
          peak:  press ? 0.7 : (0.55 + Math.random() * 0.3),
          press
        });
      }
      t += syllables * syllableDur + wordGapMs;
    }

    return { schedule, wordBoundaries, totalDuration: t };
  }

  /** Sample the schedule at a given elapsed time → jaw-open value 0..1 */
  function getJawValueAtTime(elapsedMs) {
    for (const seg of speechSchedule) {
      if (elapsedMs >= seg.start && elapsedMs <= seg.end) {
        const localT = (seg.end === seg.start) ? 0 : (elapsedMs - seg.start) / (seg.end - seg.start);
        if (seg.press) {
          // Lips sealed for the first ~35% of the syllable, then a fast release
          if (localT < 0.35) return 0.02;
          const openT = Math.min(1, (localT - 0.35) / 0.65);
          return Math.sin(openT * Math.PI) * seg.peak;
        }
        return Math.sin(localT * Math.PI) * seg.peak;
      }
    }
    return 0;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  STT  (Web Speech API SpeechRecognition)
  // ─────────────────────────────────────────────────────────────────────────────
  let recognition = null;

  function initSTT() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setStatus('Speech recognition unavailable'); return false; }

    recognition               = new SR();
    recognition.continuous    = false;
    recognition.interimResults= true;
    recognition.lang          = 'en-US';

    recognition.onstart  = () => setState('listening');

    recognition.onresult = e => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) final   += t;
        else                       interim += t;
      }
      showTranscript(final || interim, !final, false);
      if (final) {
        recognition.stop();
        setState('processing');
        sendText(final.trim());
      }
    };

    recognition.onerror = e => {
      console.error('[STT]', e.error);
      setState('idle');
    };

    recognition.onend = () => {
      // If still in listening state (no result), go idle
      if (appState === 'listening') setState('idle');
    };

    return true;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  Microphone  →  AudioContext  (for real-time FFT)
  // ─────────────────────────────────────────────────────────────────────────────
  let audioCtx = null;
  let analyser = null;

  async function initMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 128;
      audioCtx.createMediaStreamSource(stream).connect(analyser);
      return true;
    } catch (e) {
      console.warn('[Mic] access denied:', e.message);
      setStatus('Mic access denied');
      return false;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  Mic button
  // ─────────────────────────────────────────────────────────────────────────────
  micBtn.addEventListener('click', async () => {

    // While avatar speaks → click interrupts
    if (appState === 'avatar-speaking') {
      synth.cancel();
      avatarDone();
      return;
    }

    // While listening → click stops
    if (appState === 'listening') {
      recognition && recognition.stop();
      setState('idle');
      return;
    }

    if (appState !== 'idle') return;

    // First use: init mic + STT
    if (!audioCtx) {
      const ok = await initMic();
      if (!ok) return;
    }
    if (!recognition) {
      const ok = initSTT();
      if (!ok) return;
    }

    try { recognition.start(); }
    catch (e) { /* already started race condition */ }
  });

  // ─────────────────────────────────────────────────────────────────────────────
  //  UI helpers
  // ─────────────────────────────────────────────────────────────────────────────
  function setState(s) {
    appState = s;
    micBtn.className = '';
    switch (s) {
      case 'idle':
        micBtn.innerHTML = '🎤';
        setStatus('Click mic to speak');
        break;
      case 'listening':
        micBtn.innerHTML = '⏹';
        micBtn.classList.add('listening');
        setStatus('Listening…');
        break;
      case 'processing':
        micBtn.innerHTML = '⏳';
        micBtn.classList.add('processing');
        setStatus('Processing…');
        break;
      case 'avatar-speaking':
        micBtn.innerHTML = '🔊';
        micBtn.classList.add('speaking');
        setStatus('Interviewer speaking…');
        break;
    }
  }

  function setStatus(t) { statusEl.textContent = t; }

  let transcriptFadeTimer = null;

  function showTranscript(text, interim, isAvatar) {
    clearTimeout(transcriptFadeTimer);
    transcriptEl.style.display  = 'block';
    transcriptEl.style.opacity  = interim ? '0.6' : '1';
    transcriptEl.style.color    = isAvatar ? '#a8d4f5' : '#ffffff';
    transcriptEl.textContent    = text;
  }

  function fadeOutTranscript() {
    transcriptFadeTimer = setTimeout(() => {
      transcriptEl.style.opacity = '0';
      setTimeout(() => { transcriptEl.style.display = 'none'; }, 450);
    }, 2200);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  Wave canvas helpers
  // ─────────────────────────────────────────────────────────────────────────────

  /** Manual rounded-rect path (avoids ctx.roundRect browser compat issues) */
  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y,     x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x,     y + h, r);
    ctx.arcTo(x,     y + h, x,     y,     r);
    ctx.arcTo(x,     y,     x + w, y,     r);
    ctx.closePath();
  }

  function drawBars(ctx, w, h, bars, hexColor, active) {
    ctx.clearRect(0, 0, w, h);
    const barW = Math.floor((w * 0.55) / BAR_COUNT);
    const slot = w / BAR_COUNT;
    const cy   = h / 2;

    for (let i = 0; i < BAR_COUNT; i++) {
      const bh = Math.max(2, bars[i] * (h - 2));
      const x  = i * slot + (slot - barW) / 2;
      const y  = cy - bh / 2;

      if (active) {
        const grad = ctx.createLinearGradient(0, y, 0, y + bh);
        grad.addColorStop(0,    hexColor + '44');
        grad.addColorStop(0.35, hexColor + 'bb');
        grad.addColorStop(0.5,  hexColor);
        grad.addColorStop(0.65, hexColor + 'bb');
        grad.addColorStop(1,    hexColor + '44');
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
      }

      roundRect(ctx, x, y, barW, bh, 2);
      ctx.fill();
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  Per-frame bar target generators
  // ─────────────────────────────────────────────────────────────────────────────

  /** Real FFT data while listening, tiny idle ripple otherwise */
  function getUserTargets() {
    const targets = new Float32Array(BAR_COUNT);
    if (analyser && appState === 'listening') {
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(data);
      const step = Math.floor(data.length / BAR_COUNT);
      for (let i = 0; i < BAR_COUNT; i++) {
        targets[i] = data[i * step] / 255;
      }
    } else {
      // Ghost-level idle ripple so bars aren't completely flat
      const t = performance.now() * 0.001;
      for (let i = 0; i < BAR_COUNT; i++) {
        targets[i] = (Math.sin(t * 1.1 + i * 0.45) * 0.5 + 0.5) * 0.035;
      }
    }
    return targets;
  }

  /**
   * Speech-driven waveform:
   *   - Jaw value comes from the real keyframe schedule (getCurrentJawValue), not a blind oscillator
   *   - Bell-curve envelope → center bars tallest, scaled by the current jaw openness
   *   - A little per-bar jitter keeps it from looking like a single flat pulse
   */
  function getAvatarTargets() {
    avtrAmpCurrent += (avtrAmpTarget - avtrAmpCurrent) * 0.07;
    const jaw = getCurrentJawValue(); // 0..1, from the keyframe schedule

    const targets = new Float32Array(BAR_COUNT);
    for (let i = 0; i < BAR_COUNT; i++) {
      const pos    = i / (BAR_COUNT - 1);                        // 0..1
      const bell   = Math.exp(-Math.pow((pos - 0.5) * 3.4, 2)); // bell envelope
      const jitter = 0.9 + Math.sin(performance.now() * 0.01 + i * 1.3) * 0.1;

      targets[i] = jaw * bell * jitter * avtrAmpCurrent;
    }
    return targets;
  }

  /** Elapsed time into the current utterance, corrected for onboundary drift */
  function getCurrentJawValue() {
    if (!speechSchedule.length) return 0;
    const elapsed = (performance.now() - speechStartTime) - scheduleOffset;
    return getJawValueAtTime(elapsed);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  Main animation loop
  // ─────────────────────────────────────────────────────────────────────────────
  function animLoop() {
    // ── User wave ──
    const ut = getUserTargets();
    for (let i = 0; i < BAR_COUNT; i++) {
      userBars[i] += (ut[i] - userBars[i]) * LERP_USER;
    }
    drawBars(userCtx, userCvs.width, userCvs.height,
             userBars, USER_COLOR, appState === 'listening');

    // ── Avatar wave ──
    const at = getAvatarTargets();
    for (let i = 0; i < BAR_COUNT; i++) {
      avtrBars[i] += (at[i] - avtrBars[i]) * LERP_AVTR;
    }
    drawBars(avtrCtx, avtrCvs.width, avtrCvs.height,
             avtrBars, AVTR_COLOR, appState === 'avatar-speaking');

    // ── Jaw sync: read straight off the keyframe schedule, resynced by onboundary ──
    if (appState === 'avatar-speaking' && window.emotionController) {
      emotionController.externalSpeakValue = getCurrentJawValue();
    }

    requestAnimationFrame(animLoop);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  Boot
  // ─────────────────────────────────────────────────────────────────────────────
  connectWS();
  animLoop();
  setState('idle');
  setStatus('Connecting…');
});