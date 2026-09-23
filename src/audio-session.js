export class MicrophoneError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'MicrophoneError';
    this.code = code;
    this.cause = cause;
  }
}

export async function openMicrophone({ onFrame, onState, signal } = {}) {
  if (!navigator.mediaDevices?.getUserMedia) throw new MicrophoneError('unsupported', 'This browser cannot provide microphone input.');
  let stream;
  let context;
  let source;
  let analyser;
  let frameId = 0;
  let stopped = false;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: { ideal: 1 }, echoCancellation: { ideal: false }, noiseSuppression: { ideal: false }, autoGainControl: { ideal: false }, latency: { ideal: 0.02 } } });
    if (signal?.aborted) { stopTracks(stream); throw new MicrophoneError('cancelled', 'Microphone request was cancelled.'); }
    context = new (window.AudioContext || window.webkitAudioContext)();
    await context.resume();
    source = context.createMediaStreamSource(stream);
    analyser = context.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const track = stream.getAudioTracks()[0];
    const settings = track?.getSettings?.() || {};
    onState?.({ type: 'ready', deviceLabel: track?.label || 'MacBook microphone', settings, contextState: context.state });
    let lastAnalysisAt = -Infinity;
    const frame = (timestamp) => {
      if (stopped) return;
      if (timestamp - lastAnalysisAt >= 25 && context.state === 'running') {
        analyser.getFloatTimeDomainData(samples);
        lastAnalysisAt = timestamp;
        onFrame?.({ samples, sampleRate: context.sampleRate, timestampMs: timestamp, settings });
      }
      frameId = requestAnimationFrame(frame);
    };
    frameId = requestAnimationFrame(frame);
    return { stream, context, analyser, settings, stop };
  } catch (error) {
    if (stream) stopTracks(stream);
    await context?.close?.();
    if (error instanceof MicrophoneError) throw error;
    const code = error?.name === 'NotAllowedError' ? 'permission' : error?.name === 'NotFoundError' ? 'device' : error?.name === 'NotReadableError' ? 'busy' : 'unknown';
    throw new MicrophoneError(code, microphoneMessage(code), error);
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(frameId);
    source?.disconnect();
    analyser?.disconnect?.();
    stopTracks(stream);
    context?.close?.();
    onState?.({ type: 'stopped' });
  }
}

function stopTracks(stream) { stream?.getTracks?.().forEach((track) => track.stop()); }

function microphoneMessage(code) {
  return { permission: 'Microphone access was blocked. Allow it for this site, then try again.', device: 'No microphone was found. Check the MacBook input in System Settings.', busy: 'The microphone is already in use by another app.', unknown: 'The microphone could not be started. Try again.' }[code] || 'The microphone could not be started.';
}
