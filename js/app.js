
if (screen.orientation && screen.orientation.lock) {
  screen.orientation.lock('portrait').catch(() => {});
}

//import devicemotion from '@ircam/devicemotion';

//import "../js/lib/guardrails.js";

//import { Scheduler } from '@ircam/sc-scheduling'; 
//import loadAudioBuffer from '../js/lib/load-audio-buffer.js';
//import LoopSampler from '../js/lib/LoopSampler.js';

//import pluginPlatformInit from '@soundworks/plugin-platform-init/client.js'; 
//import pluginSync from '@soundworks/plugin-sync/client.js'; 
//import pluginCheckin from '@soundworks/plugin-checkin/client.js'; 
//import { start } from 'repl';
//import { send } from 'process';

//import FeedbackDelay from '../lib/FeedbackDelay.js';

// - General documentation: https://soundworks.dev/
// - API documentation:     https://soundworks.dev/api
// - Issue Tracker:         https://github.com/collective-soundworks/soundworks/issues
// - Wizard & Tools:        `npx soundworks`

/**
 * Attempts to request full-screen mode for the document.
 * Logs a warning if the API is not supported or if the request fails.
 */


let oscilloscopeStarted = false;
let backgroundRAF = null;
let backgroundState = { mode: 'idle' };
//let currentHarsh = 0;
//let currentPenalty = 0;

// Create the device
async function main(audioContext) {

  // Create gain node and connect it to audio output
  const outputNode = audioContext.createGain();
  outputNode.connect(audioContext.destination);

  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  analyser.smoothingTimeConstant = 0.3;
  analyser.connect(outputNode)
  const baseColor = '#000000';

  // Reverb (synthetic impulse response)
  const reverbConvolver = audioContext.createConvolver();
  const reverbGain = audioContext.createGain();
  reverbGain.gain.value = 0.5;
  const irLength = audioContext.sampleRate * 0.8;
  const irBuffer = audioContext.createBuffer(2, irLength, audioContext.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = irBuffer.getChannelData(ch);
    for (let i = 0; i < irLength; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLength, 2);
    }
  }
  reverbConvolver.buffer = irBuffer;
  reverbConvolver.connect(reverbGain);
  reverbGain.connect(outputNode);


  // Newest export first, previous export name as fallback
  const patchExportURLs = ["export/BH1.export.json", "export/patch.export.json"];
  let response, patcher;
  try {
      for (const url of patchExportURLs) {
        response = await fetch(url);
        if (response.ok) break;
        console.warn(`RNBO export not found at ${url}`);
      }
      patcher = await response.json();
  
      if (!window.RNBO) {
          // Load RNBO script dynamically
          await loadRNBOScript(patcher.desc.meta.rnboversion);
      }
  } catch (err) {
      // Your existing error handling logic here...
      console.error("Failed to load patcher or RNBO script:", err);
      return;
  }

  // Presets are no longer stored in the RNBO device: they are read from a
  // text file and laid out as points in the pad (see createPresetSpace)
  let presets = [];
  try {
      presets = parsePresets(await (await fetch(PRESETS_URL)).text());
      console.log(`Found ${presets.length} presets in ${PRESETS_URL}`);
  } catch (err) {
      console.error("Failed to load presets file:", err);
  }


  let device;
  console.log("Attempting to create RNBO device...");
  console.log("audioContext:", audioContext);
  console.log("patcher:", patcher);
  
  try {
      // RNBO is loaded into the window object, so we use RNBO.createDevice()
      // Also, the audio context variable is `audioContext`, not `context`
      device = await RNBO.createDevice({ context: audioContext, patcher });
  } catch (err) {
      // Your existing error handling logic here...
      console.error("Failed to create RNBO device:", err);
      return;
  }
  //console.log("device:", device)

  async function loadAudioBuffer(pathname, sampleRate = 48000) {
  if (!contexts.has(sampleRate)) {
    const context = new OfflineAudioContext(1, 1, sampleRate);
    contexts.set(sampleRate, context);
  }

  const response = await fetch(pathname);
  const arrayBuffer = await response.arrayBuffer();

  const context = contexts.get(sampleRate);
  const audioBuffer = await context.decodeAudioData(arrayBuffer);

  return audioBuffer;
}

  // Connect the device to the web audio graph (dry + reverb send)
  device.node.connect(analyser);
  device.node.connect(reverbConvolver);

  const inports = getInports(device);
  console.log("Inports:")
  console.log(inports);
  function stopBackground() {
    if (backgroundRAF) {
      cancelAnimationFrame(backgroundRAF);
      backgroundRAF = null;
    }
    backgroundState = { mode: 'idle' };
    document.body.style.background = baseColor;
    document.body.style.backgroundColor = baseColor;
  }

  function startBackgroundLoop() {
    if (backgroundRAF) return;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      if (backgroundState.mode !== 'harsh') {
        stopBackground();
        return;
      }

      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < bufferLength; i++) {
        sum += Math.abs(dataArray[i] - 128);
      }
      const amplitude = sum / bufferLength;
      const brightness = Math.max(20, Math.min(255, Math.floor((amplitude / 128) * 255 * 0.8)));
      const val = `rgb(${brightness}, ${brightness}, ${brightness})`;
      document.body.style.background = val;
      document.body.style.backgroundColor = val;

      backgroundRAF = requestAnimationFrame(render);
    };

    backgroundRAF = requestAnimationFrame(render);
  }

  function applyBackgroundMode(harshness) {
    if (harshness > 0) {
      backgroundState = { mode: 'harsh' };
      startBackgroundLoop();
    } else {
      stopBackground();
    }
  }

  // initial goal message
  const goal = [30, 30, 90];
  sendMessageToInport(device, 'goal', goal);

  const presetSpace = createPresetSpace(device, presets);

  // Penalty counter state
  let penaltyCounter = 10.0;
  let penaltyInterval = null;
  let setGameoverOverlay = () => {};

  function updatePenaltyDisplay() {
    const el = document.getElementById('penalty-counter-value');
    const fill = document.getElementById('life-fill');
    const pct = Math.max(0, Math.min(100, (penaltyCounter / 10) * 100));
    if (el) el.textContent = penaltyCounter.toFixed(1);
    if (fill) fill.style.width = `${pct}%`;
  }

  function updateHarshnessDisplay(value) {
    const el = document.getElementById('harshness-value');
    if (!el) return;
    const v = Number(value);
    el.textContent = Number.isFinite(v) ? v.toFixed(2) : '0.00';
  }

  function updateSharpnessDisplay(value) {
    const el = document.getElementById('sharpness-value');
    if (!el) return;
    const v = Number(value);
    el.textContent = Number.isFinite(v) ? v.toFixed(2) : '0.00';
  }

  function updateRoughnessDisplay(value) {
    const el = document.getElementById('roughness-value');
    if (!el) return;
    const v = Number(value);
    el.textContent = Number.isFinite(v) ? v.toFixed(2) : '0.00';
  }
  
  function updateEnergyDisplay(energyValue) {
    const el = document.getElementById('energy-counter-value');
    const fill = document.getElementById('energy-fill');
    const normalized = Math.max(0, Math.min(1, energyValue));
    if (el) el.textContent = normalized.toFixed(2);
    if (fill) fill.style.width = `${normalized * 100}%`;
  }

  function startPenaltyCounter() {
    if (penaltyInterval) return; // already running
    // ensure display shows current counter
    updatePenaltyDisplay();
    penaltyInterval = setInterval(() => {
      penaltyCounter = Math.max(0, +(penaltyCounter - 0.1).toFixed(1));
      updatePenaltyDisplay();
      if (penaltyCounter <= 0) {
        clearInterval(penaltyInterval);
        penaltyInterval = null;
        //user.set({ life: false });
        console.log('you loose :(');
        sendMessageToInport(device, 'start', 0);
      }
    }, 200);
  }

  function stopPenaltyCounter(reset = true) {
    if (penaltyInterval) {
      clearInterval(penaltyInterval);
      penaltyInterval = null;
    }
    if (reset) {
      penaltyCounter = 10.0;
      updatePenaltyDisplay();
    }
  }

  // Listen for messages from RNBO device
  device.messageEvent.subscribe((ev) => {
    if (ev.tag === "out2") {
      const sharpness = ev.payload;
      const el = document.getElementById('sharpness-value');
      if (el) el.textContent = typeof sharpness === 'number' ? sharpness.toFixed(2) : sharpness;
    }
    if (ev.tag === "out3") {
      // loudness — received but not displayed
    }
    if (ev.tag === "out4") {
      applyBackgroundMode(ev.payload);
    }
    if (ev.tag === "out5") {
      const distance = ev.payload;
      const d = Math.max(0, Math.min(1, distance));
      const el = document.getElementById('distance-value');
      if (el) el.textContent = d.toFixed(2);
      reverbGain.gain.setTargetAtTime(0.33 + 0.42 * d, audioContext.currentTime, 0.05);
    }
  });


  // -------------------------------------------------------------------
  // RENDER FUNCTION AND GRID SETUP
  // -------------------------------------------------------------------
    //setupStartStop(device, audioContext);
    setGameoverOverlay = (visible) => {
      const overlay = document.getElementById('gameover-overlay');
      if (overlay) overlay.style.display = visible ? 'flex' : 'none';
    };
    setGameoverOverlay(false);
    setupUI(device, presetSpace, audioContext);
    startOscilloscope(analyser);
  }

document.addEventListener("DOMContentLoaded", () => {
  const enterButton = document.getElementById("enter-button");
  const enterOverlay = document.getElementById("enter-overlay");
  const enterText = document.getElementById("enter-text");

  const enterTexts = [
    [
      'B3-H4RSH_S0L0_1NSTR',
      'Welcome to B3-H4RSH,here you can test the instrument',
      'Tap and hold the pad to generate the sound. Drag around to shape it.', 
      'Try to reach the target point for making the sound harsh!',
      'Turn up the volume and the brightness on your device.',
      'Lock the orientation in portrait.',
      'Enjoy!',
    ],
  ];
  let enterTextIndex = 0;

  const renderEnterText = (index) => {
    if (!enterText) return;
    const lines = enterTexts[index] || [];
    const nodes = lines.map((line) => {
      const p = document.createElement('p');
      const em = document.createElement('em');
      em.textContent = line;
      p.appendChild(em);
      return p;
    });
    enterText.replaceChildren(...nodes);
    if (enterButton) {
      enterButton.style.display = 'flex';
    }
  };

  if (enterText) renderEnterText(enterTextIndex);

  enterButton.onclick = async () => {
    enterTextIndex++;
    if (enterTextIndex < enterTexts.length) {
      renderEnterText(enterTextIndex);
      return;
    }

    enterOverlay.style.display = "none";

    const WAContext = window.AudioContext || window.webkitAudioContext;
    const context = new WAContext();
    console.log("AudioContext created:", context);
    await context.resume();
    console.log("AudioContext resumed");

    await main(context);
  };
});

// load RNBO script dynamically
function loadRNBOScript(version) {
  return new Promise((resolve, reject) => {
    if (/^\d+\.\d+\.\d+-dev$/.test(version)) {
      throw new Error("Patcher exported with a Debug Version! Please specify the correct RNBO version to use in the code.");
    }

    // Try same-origin local copy first to avoid COEP/CORS issues.
    const localSrc = `assets/rnbo/${encodeURIComponent(version)}/rnbo.min.js`;
    const cdnSrc = `https://c74-public.nyc3.digitaloceanspaces.com/rnbo/${encodeURIComponent(version)}/rnbo.min.js`;

    function appendScript(src, useCrossOrigin) {
      const el = document.createElement('script');
      if (useCrossOrigin) {
        // when requesting cross-origin script, set crossorigin so proper CORS flow
        // can occur if the CDN returns Access-Control-Allow-Origin.
        el.crossOrigin = 'anonymous';
      }
      el.src = src;
      el.onload = () => resolve();
      el.onerror = (err) => {
        // If the local copy failed, try the CDN as a fallback. If CDN fails too, reject.
        if (src === localSrc) {
          console.warn(`Local RNBO not found at ${localSrc}, falling back to CDN`);
          // try CDN (may still be blocked by COEP if the CDN doesn't provide proper headers)
          appendScript(cdnSrc, true);
        } else {
          console.error(err);
          reject(new Error("Failed to load rnbo.js v" + version));
        }
      };
      document.body.append(el);
    }

    appendScript(localSrc, false);
  });
}
// helper functions
function getInports(device) {
  const messages = device.messages;
  const inports = messages.filter(
    (message) => message.type === RNBO.MessagePortType.Inport
  );
  return inports;
}
function getParameters(device) {
  const parameters = device.parameters;
  return parameters;
}
function getParameter(device, parameterName) {
  const parameters = device.parameters;
  const parameter = parameters.find((param) => param.name === parameterName);
  return parameter;
}

// ---------------------------------------------------------------------
// PRESET SPACE
// ---------------------------------------------------------------------
const PRESETS_URL = 'BH1-presets.txt';

// Kernel width of the regression, in pad units (0-1). Small values make each
// preset a distinct plateau, large values blur all presets together.
const PRESET_KERNEL_WIDTH = 0.1;

// Speed (pad widths per second) at which navigation of the preset space is
// halved. Slower than this, the preset cursor follows the finger almost 1:1;
// faster, the cursor covers less and less ground.
const NAV_REF_SPEED = 0.35;
// How sharply the navigation gain falls off above NAV_REF_SPEED. With values
// > 1, a faster gesture covers *less* preset space than a slower one.
const NAV_FALLOFF = 2;

// When the finger holds still for DRIFT_DELAY ms, the preset cursor slowly
// drifts toward it at DRIFT_SPEED pad widths per second, until it moves again.
const DRIFT_DELAY = 1000;
const DRIFT_SPEED = 0.03;
// Finger movement (pad widths) tolerated as "still", to absorb touch jitter
const DRIFT_STILL_TOLERANCE = 0.01;

// Parse the coll-style presets file: "index, v1 v2 ... v7;" where the values
// are style (1-3), fb_gain (4), fb_trim (5), fade (6) and mod (7).
function parsePresets(text) {
  return text
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const comma = entry.indexOf(',');
      const values = entry
        .slice(comma + 1)
        .trim()
        .split(/\s+/)
        .map(Number);
      if (comma < 0 || values.length < 7 || values.some((v) => !Number.isFinite(v))) {
        console.warn('Ignoring malformed preset:', entry);
        return null;
      }
      return { index: Number(entry.slice(0, comma)), values: values.slice(0, 7) };
    })
    .filter(Boolean);
}

// Distribute the presets on a regular grid covering the pad (0-1 coordinates).
function layoutPresets(count) {
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const points = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    points.push({ x: (col + 0.5) / cols, y: (row + 0.5) / rows });
  }
  return points;
}

// The presets become points of the pad; any position of the pad is mapped to
// a full set of parameters by a kernel regression (Nadaraya-Watson, gaussian
// kernel) fitted on those points. The output is always a weighted average of
// the presets, so the morph is continuous and never leaves the range of
// values the presets were tuned in.
function createPresetSpace(device, presets) {
  const positions = layoutPresets(presets.length);
  const points = presets.map((preset, i) => ({ ...positions[i], preset }));

  const inportTags = new Set(getInports(device).map((inport) => inport.tag));
  const setParam = (name, value) => {
    const param = getParameter(device, name);
    if (!param) return false;
    param.value = Math.max(param.min, Math.min(param.max, value));
    return true;
  };
  let lastSent = null;

  function weightsAt(x, y) {
    const k = 1 / (2 * PRESET_KERNEL_WIDTH * PRESET_KERNEL_WIDTH);
    // subtract the smallest distance before exp() so that at least one
    // weight is 1 and the sum can never underflow to 0
    const d2 = points.map((p) => (p.x - x) ** 2 + (p.y - y) ** 2);
    const d2min = Math.min(...d2);
    const w = d2.map((d) => Math.exp(-(d - d2min) * k));
    const sum = w.reduce((a, b) => a + b, 0);
    return w.map((v) => v / sum);
  }

  function valuesAt(x, y) {
    const w = weightsAt(x, y);
    const out = new Array(7).fill(0);
    points.forEach((p, i) => {
      for (let j = 0; j < 7; j++) out[j] += w[i] * p.preset.values[j];
    });
    return out;
  }

  // Morph the device to the given position of the preset space (0-1 coords)
  function apply(x, y) {
    if (points.length === 0) return null;
    const v = valuesAt(x, y);
    const changed = (from, to) =>
      !lastSent || v.slice(from, to).some((val, j) => val !== lastSent[from + j]);

    if (changed(0, 3)) {
      const style = v.slice(0, 3);
      if (inportTags.has('style')) sendMessageToInport(device, 'style', style);
      // older exports expose the style values as parameters
      ['del', 'phase', 'bp'].forEach((name, j) => setParam(name, style[j]));
    }
    if (changed(3, 4)) setParam('fb_gain', v[3]);
    if (changed(4, 5)) setParam('fb_trim', v[4]);
    if (changed(5, 6) && !setParam('fade', v[5]) && inportTags.has('fade')) {
      sendMessageToInport(device, 'fade', [v[5]]);
    }
    if (changed(6, 7) && !setParam('mod', v[6]) && inportTags.has('mod')) {
      sendMessageToInport(device, 'mod', [v[6]]);
    }
    lastSent = v;
    return v;
  }

  // Randomly re-assign the presets to the points of the space
  function shuffle() {
    for (let i = points.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [points[i].preset, points[j].preset] = [points[j].preset, points[i].preset];
    }
  }

  return { points, weightsAt, valuesAt, apply, shuffle };
}

// Share of the finger movement transferred to the preset cursor, given the
// finger speed in pad widths per second.
function navigationGain(speed) {
  return 1 / (1 + Math.pow(speed / NAV_REF_SPEED, NAV_FALLOFF));
}

function sendMessageToInport(device, inportTag, values) {
  //Turn the text into a list of numbers (RNBO messages must be numbers, not text)
  //const messsageValues = values.split(/\s+/).map((s) => parseFloat(s));

  // Send the message event to the RNBO device
  let messageEvent = new RNBO.MessageEvent(
    RNBO.TimeNow,
    inportTag,
    values
  );
  device.scheduleEvent(messageEvent);
}

function startOscilloscope(analyser) {
  if (!analyser || oscilloscopeStarted) return;
  const canvas = document.getElementById('oscilloscope');
  if (!canvas) {
    // retry once the UI is rendered
    requestAnimationFrame(() => startOscilloscope(analyser));
    return;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  oscilloscopeStarted = true;

  // ensure consistent pixel size in case CSS resizes the canvas
  const width = canvas.width;
  const height = canvas.height;
  const bufferLength = analyser.fftSize;
  const dataArray = new Uint8Array(bufferLength);

  const draw = () => {
    analyser.getByteTimeDomainData(dataArray);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.fillRect(0, 0, width, height);

    // midline for reference
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, height / 2);
    ctx.lineTo(width, height / 2);
    ctx.stroke();

    ctx.lineWidth = 1;
    ctx.strokeStyle = '#f4f4f4';
    ctx.beginPath();

    const sliceWidth = width / bufferLength;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
      const v = dataArray[i] / 128.0; // 128 is midline
      const y = (v * height) / 2;

      if (i === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }

      x += sliceWidth;
    }

    ctx.stroke();
    requestAnimationFrame(draw);
  };

  draw();
}

function setupUI(device, presetSpace, audioContext) {
  const canvas = document.getElementById('xy-pad');
  const ctx = canvas.getContext('2d');
  const touchDebug = document.getElementById('touch-debug');
  const accentColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--sw-accent-color').trim() || '#ff44b4';

  let padSize = canvas.width;
  const dotRadius = 10;
  let dotX = padSize / 2;
  let dotY = padSize / 2;
  let dragging = false;
  let activePointerId = null;

  // Position in the preset space (0-1). It is driven by the finger movement
  // but scaled by navigationGain(): the faster the finger, the less it moves.
  let cursorX = 0.5;
  let cursorY = 0.5;
  let lastX = dotX;
  let lastY = dotY;
  let lastMoveTime = 0;
  let speed = 0; // smoothed finger speed, pad widths per second

  // immobility tracking for the drift of the preset cursor toward the finger
  let stillX = dotX;
  let stillY = dotY;
  let stillSince = 0;
  let driftRAF = null;
  let driftLastTime = 0;

  let goalX = 30;
  let goalY = 30;
  const goalRadius = 5;
  let showGoal = false;
  let autoGoal = false;
  let autoGoalRAF = null;
  let autoGoalTargetX = 70;
  let autoGoalTargetY = 70;

  function resizePad() {
    const container = canvas.parentElement;
    const rect = container.getBoundingClientRect();
    const cs = getComputedStyle(container);
    const innerW = rect.width
      - parseFloat(cs.paddingLeft || '0')
      - parseFloat(cs.paddingRight || '0');
    const size = Math.max(150, Math.floor(innerW || window.innerWidth * 0.9));
    padSize = size;
    canvas.width = size;
    canvas.height = size;
    canvas.style.width = '100%';
    canvas.style.height = `${size}px`;
    dotX = Math.max(dotRadius, Math.min(padSize - dotRadius, dotX));
    dotY = Math.max(dotRadius, Math.min(padSize - dotRadius, dotY));
    drawPad();
  }

  function getXY(e) {
    const rect = canvas.getBoundingClientRect();
    let x, y;
    if (e.touches && e.touches.length > 0) {
      x = e.touches[0].clientX - rect.left;
      y = e.touches[0].clientY - rect.top;
    } else if (e.clientX !== undefined && e.clientY !== undefined) {
      x = e.clientX - rect.left;
      y = e.clientY - rect.top;
    }
    x = Math.max(dotRadius, Math.min(padSize - dotRadius, x));
    y = Math.max(dotRadius, Math.min(padSize - dotRadius, y));
    return { x, y };
  }

  function drawPad() {
    ctx.clearRect(0, 0, padSize, padSize);

    // preset points, lit by their current weight in the morph
    const weights = presetSpace.weightsAt(cursorX, cursorY);
    presetSpace.points.forEach((p, i) => {
      const w = weights[i];
      ctx.beginPath();
      ctx.arc(p.x * padSize, p.y * padSize, 2 + 4 * w, 0, 2 * Math.PI);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.25 + 0.75 * w})`;
      ctx.fill();
    });

    if (showGoal) {
      const gPixX = (goalX / 100) * padSize;
      const gPixY = (goalY / 100) * padSize;
      const s = (3 / 100) * padSize;
      ctx.strokeStyle = accentColor || '#f4f4f4';
      ctx.lineWidth = 1;
      ctx.strokeRect(gPixX - s / 2, gPixY - s / 2, s, s);
    }

    // preset cursor: where the sound actually is in the preset space
    const cPixX = cursorX * padSize;
    const cPixY = cursorY * padSize;
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(dotX, dotY);
    ctx.lineTo(cPixX, cPixY);
    ctx.stroke();
    ctx.strokeStyle = '#f4f4f4';
    ctx.beginPath();
    ctx.arc(cPixX, cPixY, dotRadius * 0.7, 0, 2 * Math.PI);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(dotX, dotY, dotRadius, 0, 2 * Math.PI);
    ctx.fillStyle = accentColor || '#ff44b4';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  resizePad();
  // start with the finger dot on the preset cursor, at the centre of the pad
  dotX = lastX = cursorX * padSize;
  dotY = lastY = cursorY * padSize;
  drawPad();
  window.addEventListener('resize', resizePad);

  const initTouchX = Math.round((dotX / padSize) * 100);
  const initTouchY = Math.round((dotY / padSize) * 100);
  sendMessageToInport(device, 'touch', [initTouchX, initTouchY]);

  presetSpace.apply(cursorX, cursorY);

  // Restart the immobility timer with the finger at (x, y) pixels
  function markStill(x, y, time) {
    stillX = x;
    stillY = y;
    stillSince = time;
  }

  // While the finger is held still, pull the preset cursor slowly toward it
  function driftLoop(time) {
    if (!dragging) { driftRAF = null; return; }
    const dt = Math.min(0.1, (time - driftLastTime) / 1000);
    driftLastTime = time;
    if (time - stillSince >= DRIFT_DELAY && dt > 0) {
      const dx = dotX / padSize - cursorX;
      const dy = dotY / padSize - cursorY;
      const dist = Math.hypot(dx, dy);
      if (dist > 1e-4) {
        const step = Math.min(dist, DRIFT_SPEED * dt);
        cursorX += (dx / dist) * step;
        cursorY += (dy / dist) * step;
        presetSpace.apply(cursorX, cursorY);
        drawPad();
      }
    }
    driftRAF = requestAnimationFrame(driftLoop);
  }

  // Move the preset cursor according to a finger movement to (x, y) pixels
  function navigate(x, y, time) {
    if (Math.hypot(x - stillX, y - stillY) > DRIFT_STILL_TOLERANCE * padSize) {
      markStill(x, y, time);
    }
    const dt = (time - lastMoveTime) / 1000;
    const dx = (x - lastX) / padSize;
    const dy = (y - lastY) / padSize;
    lastX = x;
    lastY = y;
    lastMoveTime = time;
    if (!(dt > 0)) return;

    const instantSpeed = Math.hypot(dx, dy) / dt;
    // smooth over ~60ms so that single jittery events don't open/close the gain
    const a = 1 - Math.exp(-dt / 0.06);
    speed += (instantSpeed - speed) * a;

    const gain = navigationGain(speed);
    cursorX = Math.max(0, Math.min(1, cursorX + dx * gain));
    cursorY = Math.max(0, Math.min(1, cursorY + dy * gain));
    presetSpace.apply(cursorX, cursorY);
  }

  canvas.addEventListener('pointerdown', async (e) => {
    if (activePointerId === null) {
      if (audioContext.state !== 'running') {
        try { await audioContext.resume(); } catch (err) {}
      }
      activePointerId = e.pointerId;
      dragging = true;
      let { x, y } = getXY(e);
      dotX = x;
      dotY = y;
      // a new touch teleports the preset cursor under the finger
      lastX = x;
      lastY = y;
      lastMoveTime = e.timeStamp;
      speed = 0;
      markStill(x, y, e.timeStamp);
      driftLastTime = e.timeStamp;
      if (!driftRAF) driftRAF = requestAnimationFrame(driftLoop);
      cursorX = Math.max(0, Math.min(1, x / padSize));
      cursorY = Math.max(0, Math.min(1, y / padSize));
      presetSpace.apply(cursorX, cursorY);
      drawPad();
      const touchX = Math.round((dotX / padSize) * 100);
      const touchY = Math.round((dotY / padSize) * 100);
      /* const messageEvent = new RNBO.MessageEvent(RNBO.TimeNow, 'touch', [touchX, touchY]);
      device.scheduleEvent(messageEvent); */
      if (touchDebug) touchDebug.textContent = `[${touchX}, ${touchY}]`;
      //sendMessageToInport(device, 'randomize', [1]);
      sendMessageToInport(device, 'touch', [touchX, touchY]);
      sendMessageToInport(device, 'start', [1]);
      //if (onDeviceStart) onDeviceStart();
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (dragging && e.pointerId === activePointerId) {
      let { x, y } = getXY(e);
      dotX = x;
      dotY = y;
      navigate(x, y, e.timeStamp);
      drawPad();
      const touchX = Math.round((dotX / padSize) * 100);
      const touchY = Math.round((dotY / padSize) * 100);
      /* const messageEvent = new RNBO.MessageEvent(RNBO.TimeNow, 'touch', [touchX, touchY]);
      device.scheduleEvent(messageEvent); */
      sendMessageToInport(device, 'touch', [touchX, touchY]);
      if (touchDebug) touchDebug.textContent = `[${touchX}, ${touchY}]`;
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerId === activePointerId) {
      dragging = false;
      activePointerId = null;
      sendMessageToInport(device, 'start', [0]);
      //if (onDeviceStop) onDeviceStop();
    }
  });

  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerId === activePointerId) {
      dragging = false;
      activePointerId = null;
      sendMessageToInport(device, 'start', [0]);
      //if (onDeviceStop) onDeviceStop();
    }
  });

  drawPad();

  function startAutoGoal() {
    if (autoGoalRAF) return;
    const animate = () => {
      if (!autoGoal) { autoGoalRAF = null; return; }
      const dx = autoGoalTargetX - goalX;
      const dy = autoGoalTargetY - goalY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 2) {
        autoGoalTargetX = Math.random() * 80 + 10;
        autoGoalTargetY = Math.random() * 80 + 10;
      } else {
        // target speed, in pad units (0-100) per animation frame
        const step = Math.min(dist, 0.2);
        goalX += (dx / dist) * step;
        goalY += (dy / dist) * step;
        goalX = Math.max(goalRadius + 1, Math.min(100 - goalRadius - 1, goalX));
        goalY = Math.max(goalRadius + 1, Math.min(100 - goalRadius - 1, goalY));
        sendMessageToInport(device, 'goal', [goalX, goalY, 0]); //goalRadius
      }
      drawPad();
      autoGoalRAF = requestAnimationFrame(animate);
    };
    autoGoalRAF = requestAnimationFrame(animate);
  }

  function stopAutoGoal() {
    if (autoGoalRAF) { cancelAnimationFrame(autoGoalRAF); autoGoalRAF = null; }
  }

  const btnRandPreset = document.getElementById('btn-rand-preset');
  if (btnRandPreset) {
    btnRandPreset.addEventListener('click', () => {
      // presets are points of the pad now: re-distribute them in the space
      presetSpace.shuffle();
      presetSpace.apply(cursorX, cursorY);
      drawPad();
    });
  }

  const btnShowGoal = document.getElementById('btn-show-goal');
  if (btnShowGoal) {
    btnShowGoal.addEventListener('click', () => {
      showGoal = !showGoal;
      btnShowGoal.classList.toggle('active', showGoal);
      const distDisplay = document.getElementById('distance-display');
      if (distDisplay) distDisplay.classList.toggle('visible', showGoal);
      drawPad();
    });
  }

  const btnAutoGoal = document.getElementById('btn-auto-goal');
  if (btnAutoGoal) {
    btnAutoGoal.addEventListener('click', () => {
      autoGoal = !autoGoal;
      btnAutoGoal.classList.toggle('active', autoGoal);
      if (autoGoal) {
        autoGoalTargetX = Math.random() * 80 + 10;
        autoGoalTargetY = Math.random() * 80 + 10;
        startAutoGoal();
      } else {
        stopAutoGoal();
      }
    });
  }
}

// The launcher allows to launch multiple clients in the same browser window
// e.g. `http://127.0.0.1:8000?emulate=10` to run 10 clients side-by-side

   
