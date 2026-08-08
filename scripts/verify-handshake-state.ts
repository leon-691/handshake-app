import { initialHandshakeState, stepHandshakeState, STILLNESS_WINDOW_MS } from '../src/core/HandshakeStateMachine';

let failures = 0;
function check(label: string, cond: boolean) {
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${label}`);
  if (!cond) failures++;
}

const stillPose = Array.from({ length: 21 }, (_, i) => ({ x: i * 0.01, y: 0, z: 0 }));
const movedPose = stillPose.map((p) => ({ ...p, x: p.x + 0.05 })); // large, deliberate movement

// --- Scenario 1: idle with no hand ---
let t = 0;
let state = initialHandshakeState(t);
let r = stepHandshakeState(state, { handsDetected: false, worldLandmarks: null, nowMs: t });
check('no hand -> stays idle', r.next.interactionState === 'idle');

// --- Scenario 2: hand appears -> engaged ---
state = r.next;
t += 16;
r = stepHandshakeState(state, { handsDetected: true, worldLandmarks: stillPose, nowMs: t });
check('hand appears -> engaged', r.next.interactionState === 'engaged');
check('progress resets to 0 on fresh engage', r.progress === 0);

// --- Scenario 3: holds still for the full window -> completed ---
state = r.next;
let completed = false;
for (let frame = 0; frame < 400; frame++) {
  t += 16; // ~60fps
  r = stepHandshakeState(state, { handsDetected: true, worldLandmarks: stillPose, nowMs: t });
  state = r.next;
  if (state.interactionState === 'completed') {
    completed = true;
    break;
  }
}
check(`holding still triggers completion by ~${STILLNESS_WINDOW_MS}ms (took ${t}ms)`, completed);
check('completion happens close to the 3000ms window (within one frame budget)', Math.abs(t - STILLNESS_WINDOW_MS) < 50);

// --- Scenario 4: movement resets the stillness clock (should NOT complete early) ---
t = 0;
state = initialHandshakeState(t);
r = stepHandshakeState(state, { handsDetected: true, worldLandmarks: stillPose, nowMs: t });
state = r.next;
let completedEarly = false;
for (let frame = 0; frame < 150; frame++) { // ~2.4s of held-still time
  t += 16;
  r = stepHandshakeState(state, { handsDetected: true, worldLandmarks: stillPose, nowMs: t });
  state = r.next;
  if (state.interactionState === 'completed') completedEarly = true;
}
// now inject a big movement right before the 3s mark would have hit
r = stepHandshakeState(state, { handsDetected: true, worldLandmarks: movedPose, nowMs: t + 16 });
state = r.next;
t += 16;
check('did not complete before movement was injected', !completedEarly);
check('state is still engaged right after a fresh movement', state.interactionState === 'engaged');
// run another ~2s -- should NOT have completed yet since the clock reset
let completedTooSoonAfterMove = false;
for (let frame = 0; frame < 120; frame++) {
  t += 16;
  r = stepHandshakeState(state, { handsDetected: true, worldLandmarks: movedPose, nowMs: t });
  state = r.next;
  if (state.interactionState === 'completed') completedTooSoonAfterMove = true;
}
check('movement correctly reset the stillness clock (not completed ~2s after the reset)', !completedTooSoonAfterMove);

// --- Scenario 5: tracking lost mid-handshake -> immediate completion ---
t = 0;
state = initialHandshakeState(t);
r = stepHandshakeState(state, { handsDetected: true, worldLandmarks: stillPose, nowMs: t });
state = r.next;
t += 16;
r = stepHandshakeState(state, { handsDetected: false, worldLandmarks: null, nowMs: t });
check('tracking lost while engaged -> immediate completed (condition a)', r.next.interactionState === 'completed');

console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
