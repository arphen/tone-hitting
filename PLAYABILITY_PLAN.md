# Make Tone Hitting playable on a MacBook

Status: implementation pass complete in the local project; a real MacBook microphone playtest is still the final validation step.

Project: `/Users/arphen/projectc/tone-hitting`  
Baseline inspected: `bc69795`  
Date: 2026-09-23

## Implementation update

The plan has now been implemented in the source tree: musical mapping and gate progression were rewritten, Pitchy-based tracking and calibration were added, microphone ownership is explicit, brief dropouts are tolerated without earning progress, and the UI has range selection, target playback, diagnostics, demo mode, and replay. `npm test` and `npm run build` pass. The remaining validation item is singing into the published app on the actual MacBook and tuning thresholds if that specific environment needs it.

## Outcome

Two people should be able to take turns singing **do re mi fa so la ti do** into the built-in microphone. A held note should produce a steady ball; changing notes should feel responsive; breathing should not cause sudden losses. The ball must visibly fit through the hole when the app says the pitch is right.

Keep the existing canvas game and visual style. This is a focused repair of audio input, pitch tracking, and gate progression. No accounts, server, recording, multiplayer, or framework rewrite. Audio stays in the browser. One singer at a time: overlapping voices are outside scope.

## What is actually wrong

These are verified code defects, not evidence that the MacBook microphone is faulty. Line references refer to the baseline `app.js` and may move during implementation.

| Finding | Evidence | Effect |
| --- | --- | --- |
| Detector selects incorrect periods | `autoCorrelate`, lines 285–305: unrestricted lag search, tiny overlaps at long lags, no reliable periodicity confidence | Octave jumps, wrong notes, and intermittent “Listening” |
| Perfect pitch fails | `evaluateGate`, line 243: `state.cents || 999` turns **0 cents** into 999 | A perfectly tuned note is rejected |
| Ball and hole disagree | `applyPitch` uses `(midi - 60) / 16`; `targetY` uses `noteIndex % 8 / 7` | At C5 the ball is at 0.75 while its hole is at 1.0; Fa and higher can fail despite correct pitch |
| Scale progression disagrees | Ten entries in `NOTES`, eight visual positions; lane labels run top-to-bottom in ascending order | Wrong heights/labels and broken progression after the first octave |
| One frame decides the result | `evaluateGate` judges on first overlap; `stableTime` is never used | A transient dropout or wobble becomes a miss |
| Current gate changes before it clears | `noteIndex` advances during overlap; gate drawing reads the new target immediately | The same board's hole jumps while crossing the ball |
| Stop does not stop the mic | Stream is only a local variable in `startMicrophone`; Stop/Reset/Demo never stop its tracks | Repeated starts leave audio resources alive |
| Feedback uses raw measurements | Cents and status update each animation frame, although ball position is interpolated | Flickering instructions and conflicting feedback |

A read-only Node check exercised the existing detector with 2,048-sample, 48 kHz sine buffers at amplitude 0.12:

| Actual tone | Existing detector output |
| --- | --- |
| C4, 261.626 Hz | 130.791 Hz — an octave too low |
| E4, 329.628 Hz | 25.357 Hz — subsequently rejected by `readPitch` |
| A4, 440 Hz | 40 Hz — subsequently rejected by `readPitch` |
| C5, 523.251 Hz | 34.884 Hz — subsequently rejected by `readPitch` |

The previous demo fed ideal frequencies directly to `applyPitch`; it never tested the microphone detector. The planning pass did not capture live microphone audio. Browser/OS processing may contribute, but it is an unverified contributor, not the established cause.

## Implementation order

Complete the following checkpoints in order. Keep each independently testable. Do not try to hide detector errors with extra animation smoothing.

### 1. Fix musical coordinates and gate identity

- [ ] Define the eight scale offsets once: `[0, 2, 4, 5, 7, 9, 11, 12]`, with solfege `Do Re Mi Fa So La Ti Do`.
- [ ] Use a selected root MIDI note; derive every note frequency with `440 * 2 ** ((midi - 69) / 12)`.
- [ ] Create one `midiToY(midi, viewport, range)` function for the ball, lane labels, target line, and hole centers. Higher MIDI means higher on screen. Use semitone spacing, not degree index spacing.
- [ ] Reserve room above/below the octave so the first and last holes fit entirely inside the board. Clamp only rendering at the scene edges, never pitch values used for scoring.
- [ ] Make a gate an object with its own immutable target MIDI, ID, position, and phase. Keep its target unchanged until the board has fully passed. Advance exactly once, then show the next gate.
- [ ] After the eighth gate, show “Scale complete” and a replay action. Remove the accidental extra D5/E5 and modulo mismatch.
- [ ] Treat zero cents as valid. Explicitly reject null, NaN, infinity, and stale measurements.

Checkpoint: injecting each exact target frequency puts the ball at that gate's center, including Fa through high Do. One crossing awards one point, and the hole never teleports mid-crossing.

### 2. Replace the detector and make builds reproducible

- [ ] Use **Pitchy** instead of repairing the current custom correlation routine. Its documented API is `PitchDetector.forFloat32Array(frameSize)` and `findPitch(samples, actualSampleRate)`, returning frequency and clarity. Clarity is a periodicity measure, not a probability that the singer is correct. [Upstream documentation](https://github.com/ianprime0509/pitchy#usage)
- [ ] Add a minimal npm setup with exact pinned versions and a lockfile: Pitchy as a dependency, Vite as a development dependency. Keep vanilla JavaScript and the current HTML/canvas; change the entry script to an ES module. Bundle dependencies locally, without runtime CDN imports.
- [ ] Configure `npm run dev`, `npm test` using Node's test runner, `npm run build` targeting `build/` with relative asset paths, and `npm run preview`. Verify installed Node compatibility with the chosen package versions.
- [ ] Root source is authoritative. Existing `build/` files are generated duplicates: regenerate through the build command rather than editing them separately. Preserve `.openai/hosting.json` and its `build` directory setting. Do not ship this plan or tests as public build assets.
- [ ] Start with a reusable 4,096-sample buffer and one detector instance per audio session. Pass `AudioContext.sampleRate`; do not assume 44.1 or 48 kHz. Accept plausible frequencies in 70–1,000 Hz, independently of the current target.
- [ ] Run analysis at approximately 40 Hz and rendering with `requestAnimationFrame`. Keep separate monotonic timestamps. Do not run the detector at 120 Hz just because the display refreshes faster, or allocate buffers per frame.

Suggested small modules: `music.js` for note math, `pitch-tracker.js` for detection/filtering, `microphone.js` for capture lifecycle, `game.js` for progression, and the existing `app.js` for DOM/canvas wiring. Put shared tuning constants in one file. No generic engine or plugin architecture.

Checkpoint: clean sine and harmonic-rich synthetic tones produce accurate fundamental estimates at 44.1 and 48 kHz. Profile in the browser; introduce a worker only if measured analysis cost causes frame stalls.

### 3. Make microphone capture predictable

- [ ] Start/resume the audio context from the user's Start click. Request mono input and prefer `echoCancellation: false`, `noiseSuppression: false`, and `autoGainControl: false` using non-mandatory constraints. Inspect `track.getSettings()` for what the browser actually applies; missing properties mean unknown. Unsupported preferences should not prevent basic capture. [Media Capture specification](https://www.w3.org/TR/mediacapture-streams/#dom-mediatrackconstraintset)
- [ ] Keep `stream`, source node, context, and pending request/session ID in an explicit owner. Stop all tracks, disconnect nodes, cancel analysis, and close the context on Stop, Reset, switching to Demo, and page exit. Stop late-arriving streams from canceled requests. Prevent double-clicks from opening duplicate sessions.
- [ ] Distinguish permission denied, no input device, device unavailable, unsupported/insecure browser, and suspended audio. Show a useful recovery action instead of reporting every error as a permission problem.
- [ ] After permission, show the selected microphone and allow choosing another input when multiple exist. Switching input cancels the current session and reruns calibration.
- [ ] Pause on hidden tabs or interrupted audio. Require an explicit resume with fresh pitch acquisition; do not accumulate hold time while hidden. Release capture on page exit.
- [ ] Never connect the microphone source to speakers. Reference-note audio uses its own oscillator/gain path.

Checkpoint: Stop really releases this app's microphone track. Ten Start/Stop cycles and Start→Demo leave no duplicate tracks or analysis loops. Late permission responses cannot restart a stopped game.

### 4. Calibrate noise and stabilize the pitch signal

- [ ] Add a short “Stay quiet for 2 seconds” calibration with a simple input-level meter. Estimate the room noise floor using a robust percentile of RMS levels. Reject calibration dominated by a sustained pitched signal; offer retry. Do not keep adapting the noise floor upward while the user sings.
- [ ] Start the voice gate roughly 10 dB above the measured noise floor, with a small absolute floor for near-silent rooms; close about 4 dB below the opening threshold. These are tuning starting points. If ordinary singing cannot open it, surface a retry/sensitivity adjustment instead of silently failing forever.
- [ ] Require adequate level **and** periodicity. Begin with clarity ≥0.90 to acquire and ≥0.85 to continue. Reject non-finite/out-of-range output. Verify thresholds against quiet singing, room noise, and harmonic-rich samples before finalizing.
- [ ] Convert accepted frequency to continuous MIDI. Apply a median over the last three recent valid samples, followed by a time-based exponential filter with an initial time constant of 80–120 ms. Clear history on long gaps and session/range changes.
- [ ] Require about 100–150 ms of consistent evidence before accepting a jump of more than seven semitones. A single octave spike must not move the ball; a genuine sustained octave change must still be accepted. Do not fold pitches toward the target or snap the ball to the correct note.
- [ ] Separate **visible hold** from **valid evidence**. For a brief dropout, keep the ball in place for up to 150 ms without earning progress. After that, fade it/show “Sing a steady vowel”; never send it suddenly to the floor. Clear stale cents and pending hold progress after a sustained gap.
- [ ] Use the same filtered pitch for ball position, cents, and eligibility. Update text around 8–10 Hz and debounce status transitions. Add no more than about 40 ms of visual easing; excessive layers create lag.

`AnalyserNode.smoothingTimeConstant` affects frequency-spectrum analysis; it does not stabilize the time-domain pitch estimates used here. Implement filtering explicitly. [Web Audio specification](https://www.w3.org/TR/webaudio/#dom-analysernode-smoothingtimeconstant)

Checkpoint: a sustained tone stays steady, a brief dropout is visually gentle and earns no score, and a real new note is acquired quickly. All thresholds live in the shared constants file so tuning is straightforward.

### 5. Make the gate forgiving enough to practice

- [ ] Use a guided practice flow as the default: approach → wait for a steady note → cross → next note → complete. Preserve the forward-flight illusion by scrolling the board past the ball.
- [ ] Give each board roughly 4 seconds to approach, independent of viewport width. If the note is not ready, stop it just ahead of the ball and allow unlimited practice. No automatic collision loss while finding a note or taking a breath.
- [ ] Enter the in-tune state within ±50 cents; remain in it until error exceeds ±75 cents. Require 300 ms of qualified voiced evidence. A dropout ≤100 ms freezes the hold timer; longer dropouts or leaving the outer tolerance reset it. Release requires a current valid observation, not merely a held display.
- [ ] Start hold accumulation when the gate is at its waiting point. Show a small “Hold…” progress indicator. When the hold completes, latch a pass, animate the crossing, and score once after the board fully clears. Allow breathing during this committed crossing; do not rejudge it frame by frame.
- [ ] Derive aperture size from the same pitch scale and outer tolerance, including the ball's radius and a small visual margin. At release the ball must visibly fit. If needed, freeze its accepted height just for the short crossing animation, then reacquire for the next note.
- [ ] Keep “Gate cleared” visible for about 600 ms so pitch status updates cannot immediately overwrite it. The count is gates cleared, not a score that decreases after a missed attempt.
- [ ] Replay and Demo use the same progression and mapping code. Demo may inject simulated observations but must be visibly labeled; it does not substitute for detector tests.

Checkpoint: silence cannot earn progress; an isolated matching frame cannot clear a gate; a steady matching note can clear every gate. Behavior is consistent at 30/60/120 render frames per second.

### 6. Make it singable for both players

- [ ] Add a simple range choice: **Lower: C3–C4** and **Higher: C4–C5**, plus an optional small semitone transpose control. Default to Lower and remember the last device-local choice. Neither range is guaranteed comfortable for everyone; changing it must be easy and reset the current round.
- [ ] Add “Hear note” using a gentle oscillator with short attack/release ramps. The user can replay the target before singing. Pause gate motion and ignore mic observations for scoring during playback and an initial 250 ms tail; clear filter/hold history afterward. Headphones help prevent speaker bleed; calibrate the tail with the MacBook speakers too.
- [ ] Keep the main guidance simple: “Sing higher,” “Sing lower,” “Hold,” and “Take a breath.” Put raw Hz, clarity, noise level, actual input settings, and analysis time in a collapsed diagnostic panel for tuning.
- [ ] Keep Start/Stop, Hear note, range choice, and the full board accessible on a laptop and narrow viewport. Reduce the oversized introductory heading if necessary so playing does not require scrolling past it.

Checkpoint: either player can choose a comfortable range, hear a reference, and finish one octave without changing browser or OS settings.

## Tests and acceptance

Use small deterministic tests around the new pure modules; do not build a large testing framework. Add regression tests alongside each repair.

| Check | Acceptance target |
| --- | --- |
| Pitch accuracy | Every target in both default octaves, clean sine and harmonic-rich fixtures, at 44.1/48 kHz: error within 10 cents after acquisition |
| Detector realism | Vary starting phase, amplitude, modest seeded noise, and harmonic strengths; no persistent octave mistakes in these fixtures |
| Silence/noise | Silence, fan-like/seeded noise, clicks, and low-confidence samples never accumulate gate progress in controlled fixtures |
| Stability | A fixture with ±15-cent jitter stays visually steady; a one-sample octave spike is suppressed |
| Note changes | A genuine adjacent-note step settles within about 35 cents in 350 ms; a sustained octave change is not rejected forever |
| Dropouts | A 100 ms gap holds the display, adds no valid hold time, and cannot release a gate using stale pitch |
| Gate correctness | Zero cents passes; all eight exact notes align; one pass per gate; immutable target until fully clear; explicit completion after eight |
| Timing | Equivalent timestamped input yields the same results with 30/60/120 Hz rendering and after a pause/resume |
| Audio lifecycle | Mocked late permission response is disposed; Stop/Reset/Demo stop owned tracks; browser checks confirm the real lifecycle |
| Production output | `npm test` and `npm run build` pass; preview of `build/` loads all local assets and supports the same flow as development |

The timings above are design targets, not measurements of current hardware. Instrument and adjust them together; do not improve stability by adding noticeable half-second input lag.

### Actual MacBook playtest — required before claiming it is playable

1. Use the built-in microphone in Chrome, with the selected input visible. Start with no external mic or special OS changes.
2. Calibrate in the room where the users will play. Stay silent for 10 seconds: no false gate clears or ball teleporting.
3. Hold three comfortable notes for about 5 seconds each; sing softly and normally. Check for octave flips, frequent “Listening,” and flickering instructions.
4. Sing the complete scale in the chosen range, take a breath between notes, and deliberately sing one wrong note. Wrong notes should provide stable guidance and wait; correct notes should reliably clear.
5. Have the second player choose their range and repeat. Test “Hear note” through speakers once: the app must not clear its own gate.
6. Test Start/Stop, Reset, Demo, tab switching, and a fresh permission-denied session. Confirm no lingering capture owned by this app after Stop.
7. Run the same basic checks in Safari if available. Record browser versions, selected input, final constants, and any remaining failures in the README.

An agent can verify synthetic audio and browser controls, but must not claim a human vocal playtest was performed unless someone actually sang into the app. If that check remains, finish all automated/local verification and clearly leave this specific acceptance item for the users.

## Handoff and execution scope

This plan's implementation deliverable is the repaired local app, reproducible build, focused regression tests, and updated running/playtest instructions. Keep the current Sites identity; deployment and the unfinished GitHub publication are separate from proving playability. Do not expose diagnostics or audio as telemetry.

When starting development, check the process serving port 4173. Reuse or stop only the Tone Hitting server; if the port belongs to another app, select another port and report its URL. Validate both development and the generated production preview before handoff.

### Prompt to give Luna

> Work in `/Users/arphen/projectc/tone-hitting`. Read `PLAYABILITY_PLAN.md` and implement its six checkpoints in order. Preserve the existing vanilla JavaScript/canvas game and visual style. Start with the verified detector, zero-cents, coordinate-mapping, and gate-identity defects. Then implement microphone cleanup, calibration, stable pitch tracking, forgiving gate progression, range selection, and reference tones. Add the focused regression tests and reproducible build described in the plan. Run the tests/build, inspect the browser preview, and leave it running for us to try. Report what you verified and any remaining live-MacBook vocal checks honestly. This execution is local; do not publish or work on GitHub as part of this repair.
