// ====================
// GLOBAL STATE
// ====================
let isShiftPressed = false;
let isCtrlPressed = false;
let airPressure = 0;
let lastZ = null;

// prevents repeated keydown bug
const pressedKeys = new Set();

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

// ====================
// LOAD SOUND
// ====================
async function loadSound(note) {
  if (soundCache[note]) return soundCache[note];

  const res = await fetch(`sounds/${note}.wav`);
  const buf = await res.arrayBuffer();
  const audioBuf = await audioCtx.decodeAudioData(buf);
  soundCache[note] = audioBuf;
  return audioBuf;
}

// ====================
// PLAY NOTE (SAFE)
// ====================
async function playNote(noteName) {
  if (activeNotes[noteName]) return; // already playing

  const buffer = await loadSound(noteName);
  const source = audioCtx.createBufferSource();
  const gain = audioCtx.createGain();

  let octave = 0;
  if (isShiftPressed) octave = 1;
  if (isCtrlPressed) octave = -1;

  source.buffer = buffer;
  source.loop = true;
  source.playbackRate.value = Math.pow(2, octave);
  gain.gain.value = airPressure / 100;

  source.connect(gain);
  gain.connect(audioCtx.destination);
  source.start();

  activeNotes[noteName] = { source, gain };
}

// ====================
// STOP NOTE (HARD SAFE)
// ====================
function stopNote(noteName) {
  const note = activeNotes[noteName];
  if (!note) return;

  try {
    note.source.stop();
  } catch {}

  delete activeNotes[noteName];
}

// ====================
// STOP ALL NOTES (PANIC KILL)
// ====================
function stopAllNotes() {
  Object.keys(activeNotes).forEach(stopNote);
  pressedKeys.clear();
}

// ====================
// KEYBOARD CONTROL
// ====================
document.addEventListener("keydown", (e) => {
  e.preventDefault();

  if (audioCtx.state === "suspended") audioCtx.resume();

  if (pressedKeys.has(e.key)) return; // BLOCK REPEAT
  pressedKeys.add(e.key);

  if (e.key === "Shift") isShiftPressed = true;
  if (e.key === "Control") isCtrlPressed = true;

  const note = notes[e.key];
  if (note && airPressure > 2) {
    playNote(note);
  }
}, { passive: false });

document.addEventListener("keyup", (e) => {
  e.preventDefault();
  pressedKeys.delete(e.key);

  if (e.key === "Shift") isShiftPressed = false;
  if (e.key === "Control") isCtrlPressed = false;

  const note = notes[e.key];
  if (note) stopNote(note);
}, { passive: false });

// ====================
// HAND TRACKING
// ====================
const hands = new Hands({
  locateFile: f =>
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

  airPressure -= 0.2;
  airPressure = Math.max(0, Math.min(100, airPressure));

  // auto stop if no air
  if (airPressure < 1) stopAllNotes();

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
// SAFETY NETS
// ====================
window.addEventListener("blur", stopAllNotes);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopAllNotes();
});
