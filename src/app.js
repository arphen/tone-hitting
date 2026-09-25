import { NoiseCalibrator } from './calibration.js';
import { MicrophoneError, openMicrophone } from './audio-session.js';
import { ToneGame } from './game-rules.js';
import { frequencyFromMidi, getRange, midiToY, noteNameFromMidi } from './music.js';
import { PitchTracker, decibelsForRms, rmsFor } from './pitch-tracker.js';

const canvas = document.querySelector('#game-canvas');
const ctx = canvas.getContext('2d');
const startButton = document.querySelector('#start-button');
const startLabel = document.querySelector('#start-label');
const demoButton = document.querySelector('#demo-button');
const demoLabel = document.querySelector('#demo-label');
const resetButton = document.querySelector('#reset-button');
const replayButton = document.querySelector('#replay-button');
const hearButton = document.querySelector('#hear-button');
const hearLabel = document.querySelector('#hear-label');
const rangeSelect = document.querySelector('#range-select');
const scoreEl = document.querySelector('#score');
const bestScoreEl = document.querySelector('#best-score');
const targetSolfegeEl = document.querySelector('#target-solfege');
const targetFrequencyEl = document.querySelector('#target-frequency');
const pitchReadoutEl = document.querySelector('#pitch-readout');
const centsReadoutEl = document.querySelector('#cents-readout');
const pitchNoteEl = document.querySelector('#pitch-note');
const meterMarker = document.querySelector('#meter-marker');
const meterFill = document.querySelector('#meter-fill');
const statusPill = document.querySelector('#status-pill');
const statusText = document.querySelector('#status-text');
const canvasHint = document.querySelector('#canvas-hint');
const connectionLabel = document.querySelector('#connection-label');
const supportNote = document.querySelector('#support-note');
const calibrationPanel = document.querySelector('#calibration-panel');
const calibrationTitle = document.querySelector('#calibration-title');
const calibrationMessage = document.querySelector('#calibration-message');
const calibrationFill = document.querySelector('#calibration-fill');
const completionPanel = document.querySelector('#completion-panel');
const micDevice = document.querySelector('#mic-device');
const clarityReadout = document.querySelector('#clarity-readout');
const noiseReadout = document.querySelector('#noise-readout');
const analysisReadout = document.querySelector('#analysis-readout');

const state = {
  rangeId: localStorage.getItem('tone-hitting-range') || 'lower',
  range: getRange(localStorage.getItem('tone-hitting-range') || 'lower'),
  mode: 'idle',
  running: false,
  sessionId: 0,
  mic: null,
  abortController: null,
  tracker: null,
  calibrator: null,
  calibrating: false,
  calibrationFailed: false,
  latestObservation: { current: false, midi: null, ageMs: Infinity, clarity: 0 },
  lastDisplayMidi: null,
  game: null,
  best: Number(localStorage.getItem('tone-hitting-best') || 0),
  lastTime: performance.now(),
  demoClock: 0,
  referencePlaying: false,
  referenceOscillator: null,
  referenceContext: null,
  referenceTimer: null,
  completedMode: null,
  animationFrame: null,
  lastStatus: '',
};

state.game = new ToneGame(state.range);
rangeSelect.value = state.rangeId;
bestScoreEl.textContent = state.best;

function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function lerp(a, b, amount) { return a + (b - a) * amount; }
function currentTarget() { return state.game.target; }
function currentTargetMidi() { return state.game.targetMidi; }

function setStatus(message, tone = '') {
  if (state.lastStatus === `${message}|${tone}`) return;
  state.lastStatus = `${message}|${tone}`;
  statusText.textContent = message;
  statusPill.className = `status-pill ${tone}`;
}

function updateTarget() {
  const target = currentTarget();
  targetSolfegeEl.textContent = target.solfege;
  targetFrequencyEl.textContent = `${target.note} · ${Math.round(target.hz)} Hz`;
}

function resizeCanvas() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  state.game.setViewport(rect.width);
}

function resetRound({ keepMic = true } = {}) {
  if (!keepMic) stopCapture();
  state.game.reset();
  state.game.setRange(state.range);
  state.game.setViewport(canvas.clientWidth);
  state.tracker?.reset?.();
  state.latestObservation = { current: false, midi: null, ageMs: Infinity, clarity: 0 };
  state.lastDisplayMidi = currentTargetMidi();
  state.demoClock = 0;
  state.calibrating = false;
  state.calibrationFailed = false;
  state.completedMode = null;
  calibrationPanel.hidden = true;
  completionPanel.hidden = true;
  scoreEl.textContent = '0';
  updateTarget();
  updatePitchReadout(state.latestObservation);
  if (state.mode === 'idle') {
    connectionLabel.textContent = 'MIC READY';
    startLabel.textContent = 'START WITH MICROPHONE';
    demoLabel.textContent = 'TRY DEMO MODE';
    supportNote.textContent = 'Sing the highlighted note and hold it through the gate.';
    canvasHint.style.opacity = '1';
    setStatus('WAITING FOR YOU');
  } else if (state.mode === 'mic') {
    startLabel.textContent = 'STOP MICROPHONE';
    demoLabel.textContent = 'TRY DEMO MODE';
    connectionLabel.textContent = 'LISTENING';
    canvasHint.style.opacity = '0';
  }
}

function showCalibration(visible) {
  calibrationPanel.hidden = !visible;
  if (!visible) return;
  calibrationTitle.textContent = 'QUIET ROOM CHECK';
  calibrationMessage.textContent = 'Stay quiet for two seconds so the game can hear your voice.';
  calibrationFill.style.width = '0%';
}

function failCalibration(reason) {
  state.calibrating = false;
  state.calibrationFailed = true;
  calibrationTitle.textContent = reason === 'voice-detected' ? 'TOO MUCH SOUND' : 'TRY CALIBRATION AGAIN';
  calibrationMessage.textContent = reason === 'voice-detected' ? 'Stay quiet while the room check runs, then press Start again.' : 'The room was too quiet to measure. Press Start to retry.';
  calibrationFill.style.width = '100%';
  setStatus('CALIBRATION PAUSED', 'warn');
}

function updateCalibration(frame) {
  const progress = state.calibrator.add(rmsFor(frame.samples), frame.timestampMs);
  calibrationFill.style.width = `${progress.progress * 100}%`;
  noiseReadout.textContent = `${Math.round(decibelsForRms(rmsFor(frame.samples)))} dB`;
  if (!progress.complete) return;
  const result = state.calibrator.finish();
  if (!result.ok) { failCalibration(result.reason); return; }
  state.tracker.setVoiceThresholds(result);
  state.tracker.reset();
  state.calibrating = false;
  calibrationPanel.hidden = true;
  connectionLabel.textContent = 'LISTENING';
  supportNote.textContent = 'Sing the highlighted note and hold it through the gate.';
  noiseReadout.textContent = `${Math.round(result.noiseDb)} dB`;
  setStatus(`FIND ${currentTarget().solfege}`, 'warn');
}

function handleMicFrame(frame, sessionId) {
  if (sessionId !== state.sessionId || state.mode !== 'mic') return;
  if (state.calibrating) { updateCalibration(frame); return; }
  if (state.calibrationFailed) return;
  const observation = state.tracker.process(frame.samples, frame.sampleRate, frame.timestampMs);
  state.latestObservation = observation;
  if (observation.midi !== null) state.lastDisplayMidi = observation.midi;
  updatePitchReadout(observation);
}

async function startMicrophone() {
  if (state.mode === 'mic') {
    const shouldRetry = !state.running || state.calibrationFailed;
    stopCapture();
    if (!shouldRetry) return;
  }
  if (state.mode === 'demo') stopDemo();
  stopCapture();
  const sessionId = ++state.sessionId;
  const controller = new AbortController();
  state.abortController = controller;
  state.mode = 'mic';
  state.completedMode = null;
  state.running = true;
  state.tracker = new PitchTracker();
  state.calibrator = new NoiseCalibrator(2000);
  state.calibrating = true;
  state.calibrationFailed = false;
  state.game.reset();
  state.game.setRange(state.range);
  state.game.setViewport(canvas.clientWidth);
  updateTarget();
  startLabel.textContent = 'STOP MICROPHONE';
  startButton.classList.add('active');
  demoLabel.textContent = 'TRY DEMO MODE';
  connectionLabel.textContent = 'QUIET CHECK';
  supportNote.textContent = 'Stay quiet for the room check, then sing normally.';
  canvasHint.style.opacity = '0';
  showCalibration(true);
  setStatus('QUIET CHECK', 'warn');
  try {
    state.mic = await openMicrophone({
      signal: controller.signal,
      onState: (event) => {
        if (sessionId !== state.sessionId) return;
        if (event.type === 'ready') {
          micDevice.textContent = event.deviceLabel || 'MacBook microphone';
          const settings = event.settings || {};
          micDevice.title = JSON.stringify(settings);
        }
        if (event.type === 'ended') {
          stopCapture();
          setStatus('MICROPHONE STOPPED', 'bad');
          supportNote.textContent = 'The microphone became unavailable. Click Start to try again.';
        }
      },
      onFrame: (frame) => handleMicFrame(frame, sessionId),
    });
  } catch (error) {
    if (sessionId !== state.sessionId || error?.code === 'cancelled') return;
    state.mode = 'idle'; state.running = false; state.calibrating = false; calibrationPanel.hidden = true;
    startButton.classList.remove('active'); startLabel.textContent = 'START WITH MICROPHONE'; connectionLabel.textContent = 'MIC READY';
    setStatus(error instanceof MicrophoneError ? error.message : 'MICROPHONE ERROR', 'bad');
    supportNote.textContent = 'Allow microphone access, then try again.';
  }
}

function stopCapture() {
  stopReference();
  state.sessionId += 1;
  state.abortController?.abort();
  state.abortController = null;
  state.mic?.stop?.();
  state.mic = null;
  state.tracker?.reset?.();
  state.tracker = null;
  if (state.mode === 'mic') state.mode = 'idle';
  state.calibrating = false;
  state.calibrationFailed = false;
  state.running = state.mode === 'demo';
  calibrationPanel.hidden = true;
  startButton.classList.remove('active');
  startLabel.textContent = 'START WITH MICROPHONE';
  connectionLabel.textContent = state.mode === 'demo' ? 'DEMO MODE' : 'MIC READY';
}

function startDemo() {
  if (state.mode === 'demo') { stopDemo(); return; }
  stopCapture();
  state.mode = 'demo'; state.running = true; state.demoClock = 0;
  state.completedMode = null;
  state.game.reset(); state.game.setRange(state.range); state.game.setViewport(canvas.clientWidth);
  state.latestObservation = { current: true, midi: state.game.targetMidi, clarity: 1, ageMs: 0, pitchHz: frequencyFromMidi(state.game.targetMidi) };
  state.lastDisplayMidi = state.game.targetMidi;
  startLabel.textContent = 'START WITH MICROPHONE'; demoLabel.textContent = 'STOP DEMO'; connectionLabel.textContent = 'DEMO MODE';
  supportNote.textContent = 'Demo traces the scale so you can learn the timing.';
  canvasHint.style.opacity = '0'; completionPanel.hidden = true;
  setStatus('DEMO PLAYING', 'good'); updateTarget();
}

function stopDemo() {
  if (state.mode !== 'demo') return;
  state.mode = 'idle'; state.running = false; demoLabel.textContent = 'TRY DEMO MODE'; connectionLabel.textContent = 'MIC READY';
  setStatus('PAUSED');
}

function handleRangeChange() {
  const previousMode = state.mode;
  state.rangeId = rangeSelect.value;
  state.range = getRange(state.rangeId);
  localStorage.setItem('tone-hitting-range', state.rangeId);
  if (previousMode === 'demo') state.mode = 'idle';
  resetRound();
  if (previousMode === 'mic') {
    state.calibrator = new NoiseCalibrator(2000);
    state.calibrating = true;
    state.calibrationFailed = false;
    connectionLabel.textContent = 'QUIET CHECK';
    setStatus('QUIET CHECK', 'warn');
    showCalibration(true);
  } else if (previousMode === 'demo') startDemo();
}

function updatePitchReadout(observation) {
  const displayMidi = Number.isFinite(observation.midi) ? observation.midi : state.lastDisplayMidi;
  if (Number.isFinite(displayMidi)) {
    const hz = frequencyFromMidi(displayMidi);
    pitchReadoutEl.textContent = `${Math.round(hz)} Hz · ${noteNameFromMidi(displayMidi)}`;
  } else pitchReadoutEl.textContent = '—';
  const cents = observation.current && Number.isFinite(observation.midi) ? Math.round((observation.midi - currentTargetMidi()) * 100) : null;
  centsReadoutEl.textContent = cents === null ? '—' : `${cents > 0 ? '+' : ''}${cents}¢`;
  pitchNoteEl.textContent = cents === null ? (observation.reason === 'dropout' ? 'Hold your vowel' : 'Sing to begin') : Math.abs(cents) <= 45 ? `Right on ${currentTarget().note}` : cents < 0 ? 'A little higher' : 'A little lower';
  const marker = cents === null ? 50 : clamp(50 + (cents / 160) * 50, 3, 97);
  meterMarker.style.left = `${marker}%`;
  meterFill.style.width = `${marker}%`;
  clarityReadout.textContent = observation.clarity ? observation.clarity.toFixed(2) : '—';
  analysisReadout.textContent = observation.analysisMs ? `${observation.analysisMs.toFixed(1)} ms` : '—';
}

function playReference() {
  if (state.referencePlaying) return;
  const context = state.mic?.context || new (window.AudioContext || window.webkitAudioContext)();
  state.referencePlaying = true;
  state.referenceContext = context;
  state.game.setPaused(true);
  state.tracker?.reset();
  hearButton.disabled = true; hearLabel.textContent = 'PLAYING NOTE'; setStatus('LISTEN TO NOTE', 'good');
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine'; oscillator.frequency.value = frequencyFromMidi(currentTargetMidi());
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.035);
  gain.gain.setValueAtTime(0.12, context.currentTime + 0.56);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.72);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(); oscillator.stop(context.currentTime + 0.76);
  state.referenceOscillator = oscillator;
  clearTimeout(state.referenceTimer);
  state.referenceTimer = setTimeout(() => {
    const referenceContext = state.referenceContext;
    state.referencePlaying = false; state.referenceOscillator = null; state.referenceContext = null; state.referenceTimer = null; hearButton.disabled = false; hearLabel.textContent = 'HEAR TARGET';
    state.tracker?.reset(); state.game.setPaused(false);
    setStatus(state.mode === 'demo' ? 'DEMO PLAYING' : `FIND ${currentTarget().solfege}`, state.mode === 'demo' ? 'good' : 'warn');
    if (!state.mic) referenceContext?.close?.();
  }, 1000);
}

function stopReference() {
  clearTimeout(state.referenceTimer);
  state.referenceTimer = null;
  try { state.referenceOscillator?.stop?.(); } catch {}
  state.referenceOscillator?.disconnect?.();
  const context = state.referenceContext;
  state.referenceOscillator = null;
  state.referenceContext = null;
  state.referencePlaying = false;
  hearButton.disabled = false;
  hearLabel.textContent = 'HEAR TARGET';
  state.game?.setPaused(false);
  if (context && !state.mic) context.close?.();
}

function updateGame(dtMs) {
  if (!state.running || state.referencePlaying || state.calibrating || state.calibrationFailed) return;
  if (state.mode === 'demo') {
    state.demoClock += dtMs;
    const wobble = Math.sin(state.demoClock / 500) * 0.02;
    state.latestObservation = { current: true, midi: state.game.targetMidi + wobble, clarity: 1, ageMs: 0, pitchHz: frequencyFromMidi(state.game.targetMidi + wobble) };
    state.lastDisplayMidi = state.latestObservation.midi;
    updatePitchReadout(state.latestObservation);
  }
  const snapshot = state.game.update(dtMs, state.latestObservation);
  scoreEl.textContent = snapshot.gatesCleared;
  state.best = Math.max(state.best, snapshot.gatesCleared);
  bestScoreEl.textContent = state.best;
  localStorage.setItem('tone-hitting-best', String(state.best));
  if (snapshot.complete) {
    const completedMode = state.mode;
    state.running = false;
    state.completedMode = completedMode;
    if (completedMode === 'demo') stopDemo();
    else stopCapture();
    completionPanel.hidden = false;
    setStatus('SCALE COMPLETE', 'good');
    supportNote.textContent = 'Nice work. Press Play Again or Start With Microphone for another run.';
  } else if (snapshot.phase === 'crossing') setStatus('GATE CLEARED', 'good');
  else if (snapshot.phase === 'holding' && snapshot.inTune) setStatus(`HOLD ${Math.round(snapshot.holdProgress * 100)}%`, 'good');
  else if (state.latestObservation.current && snapshot.cents !== null) {
    setStatus(snapshot.cents < -45 ? 'SING HIGHER' : snapshot.cents > 45 ? 'SING LOWER' : 'ON TARGET', Math.abs(snapshot.cents) <= 55 ? 'good' : 'warn');
  } else setStatus('SING TO FIND IT', 'warn');
}

function drawGame(timestamp) {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  const dt = Math.min(80, Math.max(0, timestamp - state.lastTime));
  state.lastTime = timestamp;
  if (!width || !height) { state.animationFrame = requestAnimationFrame(drawGame); return; }
  updateGame(dt);
  drawBackground(width, height);
  drawLanes(width, height);
  drawGate(width, height);
  drawBall(width, height);
  drawTargetMarker(width, height);
  state.animationFrame = requestAnimationFrame(drawGame);
}

function drawBackground(width, height) {
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#192441'); gradient.addColorStop(0.65, '#141d37'); gradient.addColorStop(1, '#10172b');
  ctx.fillStyle = gradient; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(139,163,255,.05)';
  for (let x = 22; x < width; x += 42) ctx.fillRect(x, 0, 1, height);
  for (let y = 19; y < height; y += 42) ctx.fillRect(0, y, width, 1);
  const glow = ctx.createRadialGradient(width * .7, height * .2, 0, width * .7, height * .2, width * .6);
  glow.addColorStop(0, 'rgba(118,137,255,.11)'); glow.addColorStop(1, 'rgba(118,137,255,0)');
  ctx.fillStyle = glow; ctx.fillRect(0, 0, width, height);
}

function drawLanes(width, height) {
  const top = height * 0.12; const bottom = height * 0.88;
  ctx.lineWidth = 1; ctx.font = '10px DM Mono, monospace';
  for (let i = 0; i < 8; i += 1) {
    const midi = state.range.rootMidi + [0, 2, 4, 5, 7, 9, 11, 12][i];
    const y = midiToY(midi, height, state.range);
    ctx.strokeStyle = i === 0 || i === 7 ? 'rgba(241,244,255,.13)' : 'rgba(241,244,255,.08)';
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    ctx.fillStyle = 'rgba(241,244,255,.36)'; ctx.fillText(['DO', 'RE', 'MI', 'FA', 'SO', 'LA', 'TI', 'DO'][i], 20, y - 8);
  }
  void top; void bottom;
}

function drawRoundedRect(x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + width, y, x + width, y + height, r); ctx.arcTo(x + width, y + height, x, y + height, r); ctx.arcTo(x, y + height, x, y, r); ctx.arcTo(x, y, x + width, y, r); ctx.closePath();
}

function drawGate(width, height) {
  const snapshot = state.game.snapshot(state.latestObservation);
  const x = snapshot.gateX || width * 0.82;
  const holeY = midiToY(snapshot.targetMidi, height, state.range);
  const usableHeight = height * 0.76;
  const holeHeight = Math.max(72, usableHeight * (1.5 / (state.range.maxMidi - state.range.minMidi)) + 34);
  const boardTop = 30; const boardBottom = height - 30; const boardWidth = 48;
  const holeTop = holeY - holeHeight / 2; const holeBottom = holeY + holeHeight / 2;
  ctx.save();
  ctx.fillStyle = snapshot.phase === 'crossing' ? '#70e3c1' : '#70e3c1'; ctx.shadowColor = 'rgba(112,227,193,.3)'; ctx.shadowBlur = 13;
  drawRoundedRect(x, boardTop, boardWidth, Math.max(0, holeTop - boardTop), 8); ctx.fill();
  drawRoundedRect(x, holeBottom, boardWidth, Math.max(0, boardBottom - holeBottom), 8); ctx.fill(); ctx.shadowBlur = 0;
  ctx.fillStyle = snapshot.inTune ? 'rgba(255,207,90,.18)' : 'rgba(112,227,193,.15)'; ctx.fillRect(x - 12, holeTop, boardWidth + 24, holeHeight);
  ctx.strokeStyle = snapshot.inTune ? 'rgba(255,207,90,.75)' : 'rgba(112,227,193,.55)'; ctx.setLineDash([4, 6]); ctx.strokeRect(x - 5, holeTop, boardWidth + 10, holeHeight); ctx.setLineDash([]);
  ctx.fillStyle = '#70e3c1'; ctx.font = '500 10px DM Mono, monospace'; ctx.fillText(`${snapshot.target.solfege} / ${snapshot.target.note}`, x - 13, boardTop - 11);
  if (snapshot.phase === 'holding' && snapshot.holdProgress > 0) { ctx.fillStyle = '#ffcf5a'; ctx.fillRect(x, holeBottom + 8, boardWidth * snapshot.holdProgress, 3); }
  ctx.restore();
}

function drawBall(width, height) {
  const x = width * 0.2;
  const midi = Number.isFinite(state.lastDisplayMidi) ? state.lastDisplayMidi : currentTargetMidi();
  const y = midiToY(midi, height, state.range);
  const radius = 15;
  const glow = ctx.createRadialGradient(x, y, 0, x, y, 52); glow.addColorStop(0, 'rgba(255,207,90,.42)'); glow.addColorStop(1, 'rgba(255,207,90,0)');
  ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(x, y, 52, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#ffcf5a'; ctx.shadowColor = '#ffcf5a'; ctx.shadowBlur = 16; ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  ctx.fillStyle = '#fff2b9'; ctx.beginPath(); ctx.arc(x - 5, y - 5, 4, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = 'rgba(255,207,90,.5)'; ctx.setLineDash([2, 8]); ctx.beginPath(); ctx.moveTo(x + 23, y); ctx.lineTo(state.game.gateX - 14, y); ctx.stroke(); ctx.setLineDash([]);
}

function drawTargetMarker(width, height) {
  const y = midiToY(currentTargetMidi(), height, state.range);
  ctx.strokeStyle = 'rgba(255,207,90,.55)'; ctx.lineWidth = 2; ctx.setLineDash([2, 7]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = '#ffcf5a'; ctx.beginPath(); ctx.arc(8, y, 3, 0, Math.PI * 2); ctx.fill();
}

function closeOnPageExit() { stopReference(); state.mic?.stop?.(); }

startButton.addEventListener('click', startMicrophone);
demoButton.addEventListener('click', startDemo);
resetButton.addEventListener('click', () => { stopDemo(); resetRound(); });
replayButton.addEventListener('click', () => {
  const replayMode = state.completedMode;
  resetRound();
  if (replayMode === 'demo') startDemo();
  else if (state.mode === 'idle') startMicrophone();
  else state.running = true;
});
hearButton.addEventListener('click', playReference);
rangeSelect.addEventListener('change', handleRangeChange);
window.addEventListener('resize', resizeCanvas);
window.addEventListener('pagehide', closeOnPageExit);

resizeCanvas();
resetRound();
state.animationFrame = requestAnimationFrame(drawGame);
