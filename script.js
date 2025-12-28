// ====================
// GLOBAL STATE
// ====================
let isShiftPressed = false;
let isCtrlPressed = false;

let airPressure = 0;
let lastZ = null;

let performanceMode = false;

// ====================
// ELEMENTS
// ====================
const videoElement = document.getElementById("video");
const canvasElement = document.getElementById("canvas");
const canvasCtx = canvasElement.getContext("2d");
const airText = document.getElementById("airValue");
const bellowsBar = document.getElementById("bellows-bar");

// ====================
// AUDIO
// ====================
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
const activeNotes = {};
const soundCache = {};

// ====================
// NOTE MAP
// ====================
const notes = {
  a: "sa",
  s: "re",
  d: "ga",
  f: "ma",
  g: "pa",
  h: "dha",
  j: "ni",
  k: "sa2"
};

const harmoniumKeys = Object.keys(notes);

// ====================
// PLAY NOTE (WITH OCTAVE)
// ====================
async function playNote(noteName) {
  if (activeNotes[noteName]) return;

  if (!soundCache[noteName]) {
    const res = await fetch(`sounds/${noteName}.wav`);
    const buf = await res.arrayBuffer();
    soundCache[noteName] = await audioCtx.decodeAudioData(buf);
  }

  const source = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();

  let octave = 0;
  if (isShiftPressed) octave = 1;
  else if (isCtrlPressed) octave = -1;

  source.buffer = soundCache[noteName];
  source.loop = true;
  source.playbackRate.value = Math.pow(2, octave);

  gain.gain.value = airPressure / 100;

  source.connect(gain);
  gain.connect(audioCtx.destination);
  source.start();

  activeNotes[noteName] = { source, gain };
}

// ====================
// STOP NOTE
// ====================
function stopNote(noteName) {
  const note = activeNotes[noteName];
  if (!note) return;

  const now = audioCtx.currentTime;

  note.gain.gain.cancelScheduledValues(now);
  note.gain.gain.setValueAtTime(note.gain.gain.value, now);
  note.gain.gain.linearRampToValueAtTime(0, now + 0.08);

  setTimeout(() => {
    try { note.source.stop(); } catch {}
  }, 100);

  delete activeNotes[noteName];
}

// ====================
// KEYBOARD (PLAYING)
// ====================
document.addEventListener("keydown", (e) => {
  if (audioCtx.state === "suspended") audioCtx.resume();

  if (e.key === "Shift") isShiftPressed = true;
  if (e.key === "Control") isCtrlPressed = true;

  const note = notes[e.key];
  if (note && airPressure > 2) {
    playNote(note);
  }
});

document.addEventListener("keyup", (e) => {
  if (e.key === "Shift") isShiftPressed = false;
  if (e.key === "Control") isCtrlPressed = false;

  const note = notes[e.key];
  if (note) stopNote(note);
});

// ====================
// HARD SHORTCUT BLOCK (MAX POSSIBLE)
// ====================
window.addEventListener(
  "keydown",
  (e) => {
    if (!performanceMode) return;

    if (e.ctrlKey || e.shiftKey) {
      if (
        harmoniumKeys.includes(e.key) ||
        e.key === "Shift" ||
        e.key === "Control"
      ) {
        return;
      }

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  },
  true // CAPTURE PHASE
);

window.addEventListener(
  "keyup",
  (e) => {
    if (!performanceMode) return;

    if (e.ctrlKey || e.shiftKey) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    }
  },
  true
);

// ====================
// HAND TRACKING (AIR)
// ====================
const hands = new Hands({
  locateFile: (f) =>
    `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${f}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 1,
  minDetectionConfidence: 0.7,
  minTrackingConfidence: 0.7
});

hands.onResults((results) => {
  canvasElement.width = videoElement.videoWidth;
  canvasElement.height = videoElement.videoHeight;
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

  if (results.multiHandLandmarks.length > 0) {
    const hand = results.multiHandLandmarks[0];
    const palm = [0, 5, 9, 13, 17];

    let z = 0;
    palm.forEach(i => z += hand[i].z);
    z /= palm.length;

    if (lastZ !== null) {
      const delta = lastZ - z;
      if (Math.abs(delta) > 0.002) {
        airPressure += delta * 8000;
      }
    }
    lastZ = z;
  }

  airPressure -= 0.15;
  airPressure = Math.max(0, Math.min(100, airPressure));

  if (airPressure < 1) {
    Object.keys(activeNotes).forEach(stopNote);
  }

  airText.textContent = Math.round(airPressure);
  bellowsBar.style.width = `${airPressure}%`;

  Object.values(activeNotes).forEach(n => {
    n.gain.gain.value = airPressure / 100;
  });
});

// ====================
// CAMERA
// ====================
const camera = new Camera(videoElement, {
  onFrame: async () => {
    await hands.send({ image: videoElement });
  },
  width: 640,
  height: 480
});

camera.start();

// ====================
// PERFORMANCE MODE
// ====================
document.body.addEventListener("click", () => {
  if (performanceMode) return;

  performanceMode = true;

  if (document.documentElement.requestFullscreen) {
    document.documentElement.requestFullscreen();
  }

  audioCtx.resume();
});

// ====================
// SAFETY
// ====================
window.addEventListener("blur", () => {
  Object.keys(activeNotes).forEach(stopNote);
});
