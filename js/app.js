
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
let backgroundState = { mode: 'idle', gain: 0, color: 'black' };
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


  const patchExportURL = "export/patch.export.json";
  let response, patcher;
  try {
      response = await fetch(patchExportURL);
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

  let presets = patcher.presets || [];
  if (presets.length < 1) {
      console.log("No presets defined");
  } else {
      console.log(`Found ${presets.length} presets`);
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
    backgroundState = { mode: 'idle', gain: 0, color: 'black' };
    document.body.style.background = baseColor;
    document.body.style.backgroundColor = baseColor;
  }

  function startBackgroundLoop() {
    if (backgroundRAF) return;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const render = () => {
      const { mode, gain, color } = backgroundState;
      let brightness = 0;

      if (gain > 0 && mode !== 'idle') {
        analyser.getByteTimeDomainData(dataArray);
        let sum = 0;
        for (let i = 0; i < bufferLength; i++) {
          sum += Math.abs(dataArray[i] - 128);
        }
        const amplitude = sum / bufferLength;
        brightness = Math.min(255, Math.floor((amplitude / 128) * 255 * gain));
        if (mode === 'penalty') brightness = Math.min(255, brightness + 30);
        if (mode === 'harsh') brightness = Math.max(20, brightness);
      }

      if (mode === 'penalty' && color === 'red') {
        const val = `rgba(255, ${brightness}, ${brightness}, 1)`;
        document.body.style.background = val;
        document.body.style.backgroundColor = val;
      } else if (mode === 'harsh') {
        const val = `rgb(${brightness}, ${brightness}, ${brightness})`;
        document.body.style.background = val;
        document.body.style.backgroundColor = val;
      } else {
        document.body.style.background = baseColor;
        document.body.style.backgroundColor = baseColor;
      }

      if (backgroundState.mode === 'idle') {
        stopBackground();
        return;
      }

      backgroundRAF = requestAnimationFrame(render);
    };

    backgroundRAF = requestAnimationFrame(render);
  }

  function applyBackgroundMode(harshness, penalty = 0) {
    if (harshness > 0) {
      backgroundState = { mode: 'harsh', gain: 0.8, color: 'white' };
    } else if (penalty > 0) {
      backgroundState = { mode: 'penalty', gain: 0.4, color: 'red' };
    } else {
      backgroundState = { mode: 'idle', gain: 0, color: 'black' };
    }

    if (backgroundState.mode === 'idle') {
      stopBackground();
    } else {
      startBackgroundLoop();
    }
  }

  // initial goal message
  const goal = [30, 30, 5];
  sendMessageToInport(device, 'goal', goal);

  if (presets.length > 0) loadPresetAtIndex(device, presets, 0);

  let deviceStartedAt = null;
  let isActive = false;

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
    if (ev.tag === "out4") {
      if (!isActive) return;
      const harshness = ev.payload;
      if (deviceStartedAt !== null && (performance.now() - deviceStartedAt) < 250) return;
      applyBackgroundMode(harshness, 0);
    }
    if (ev.tag === "out2") {
      const sharpness = ev.payload;
      const el = document.getElementById('sharpness-value');
      if (el) el.textContent = typeof sharpness === 'number' ? sharpness.toFixed(2) : sharpness;
    }
    if (ev.tag === "out3") {
      // loudness — received but not displayed
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
    setupUI(device, presets, audioContext,
      () => { isActive = true; deviceStartedAt = performance.now(); },
      () => { isActive = false; }
    );
    startOscilloscope(analyser);
  }

document.addEventListener("DOMContentLoaded", () => {
  const enterButton = document.getElementById("enter-button");
  const enterOverlay = document.getElementById("enter-overlay");
  const enterText = document.getElementById("enter-text");

  const enterTexts = [
    [
      'B3-H4RSH_S0L0_1NSTR',
      'Tap and hold the pad to generate the sound.',
      'Every tap brings a new noise.',
      'Drag around and move the slider to shape it.',
    ],
    /* [
      'Turn up the volume on your device.',
      'Turn up the brightness of your screen.',
      'Enjoy!',
    ], */
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
function loadPresetAtIndex(device, presets, index) {
  const presetIndex = Math.floor(Number(index));
  if (!Number.isFinite(presetIndex) || presetIndex < 0 || presetIndex >= presets.length) {
    console.warn('Ignoring invalid preset index:', index);
    return;
  }
  const preset = presets[presetIndex];
  if (!preset) return;
  console.log(`Loading preset ${preset.name}`);
  device.setPreset(preset.preset);
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

function setupUI(device, presets, audioContext, onDeviceStart, onDeviceStop) {
  const canvas = document.getElementById('xy-pad');
  const ctx = canvas.getContext('2d');
  const touchDebug = document.getElementById('touch-debug');
  const presetButtons = document.querySelectorAll('.preset-btn');
  const accentColor = getComputedStyle(document.documentElement)
    .getPropertyValue('--sw-accent-color').trim() || '#ff44b4';

  let padSize = canvas.width;
  const dotRadius = 10;
  let dotX = padSize / 2;
  let dotY = padSize / 2;
  let dragging = false;
  let activePointerId = null;

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

    if (showGoal) {
      const gPixX = (goalX / 100) * padSize;
      const gPixY = (goalY / 100) * padSize;
      const s = (3 / 100) * padSize;
      ctx.strokeStyle = accentColor || '#f4f4f4';
      ctx.lineWidth = 1;
      ctx.strokeRect(gPixX - s / 2, gPixY - s / 2, s, s);
    }

    ctx.beginPath();
    ctx.arc(dotX, dotY, dotRadius, 0, 2 * Math.PI);
    ctx.fillStyle = accentColor || '#ff44b4';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  resizePad();
  window.addEventListener('resize', resizePad);

  const initTouchX = Math.round((dotX / padSize) * 100);
  const initTouchY = Math.round((dotY / padSize) * 100);
  sendMessageToInport(device, 'touch', [initTouchX, initTouchY]);

  if (presetButtons && presetButtons.length) {
    presetButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const presetIndex = Number(btn.dataset.preset || 0);
        if (!Array.isArray(presets) || presets.length <= presetIndex) {
          console.warn('Preset index out of range:', presetIndex);
          return;
        }
        loadPresetAtIndex(device, presets, presetIndex);
      });
    });
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
        const step = Math.min(dist, 0.5);
        goalX += (dx / dist) * step;
        goalY += (dy / dist) * step;
        goalX = Math.max(goalRadius + 1, Math.min(100 - goalRadius - 1, goalX));
        goalY = Math.max(goalRadius + 1, Math.min(100 - goalRadius - 1, goalY));
        sendMessageToInport(device, 'goal', [goalX, goalY, 4]); //goalRadius
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
      if (!Array.isArray(presets) || presets.length === 0) return;
      const idx = Math.floor(Math.random() * presets.length);
      loadPresetAtIndex(device, presets, idx);
    });
  }

  const btnShowGoal = document.getElementById('btn-show-goal');
  if (btnShowGoal) {
    btnShowGoal.addEventListener('click', () => {
      showGoal = !showGoal;
      btnShowGoal.classList.toggle('active', showGoal);
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

   
