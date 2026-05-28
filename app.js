const $ = (selector) => document.querySelector(selector);

const els = {
  video: $("#camera"),
  overlay: $("#overlay"),
  empty: $("#cameraEmpty"),
  start: $("#startButton"),
  mute: $("#muteButton"),
  muteIcon: $("#muteIcon"),
  testAudio: $("#testAudioButton"),
  calibrate: $("#calibrateButton"),
  demo: $("#demoButton"),
  file: $("#fileInput"),
  modelStatus: $("#modelStatus"),
  currentTip: $("#currentTip"),
  cueLog: $("#cueLog"),
  clearLog: $("#clearLog"),
  strictness: $("#strictness"),
  strictnessLabel: $("#strictnessLabel"),
  viewLabel: $("#viewLabel"),
  tempoValue: $("#tempoValue"),
  stabilityValue: $("#stabilityValue"),
  rangeValue: $("#rangeValue"),
  sessionClock: $("#sessionClock"),
  swingCount: $("#swingCount"),
  cueCount: $("#cueCount"),
  bestTempo: $("#bestTempo"),
  consistencyScore: $("#consistencyScore")
};

const state = {
  running: false,
  muted: false,
  mode: "side",
  strictness: 2,
  stream: null,
  sourceType: "camera",
  startedAt: null,
  lastFrameAt: 0,
  baseline: null,
  armed: false,
  quietStartedAt: null,
  ignoreMotionUntil: 0,
  previousFrame: null,
  previousMotion: null,
  poseLandmarker: null,
  poseReady: false,
  poseLoading: false,
  poseFailed: false,
  samples: [],
  swing: null,
  swingCount: 0,
  cueCount: 0,
  bestTempo: null,
  consistency: [],
  lastCueAt: 0,
  lastCueText: "",
  audioContext: null,
  audioUnlocked: false,
  activeUtterance: null,
  lastSpeechError: "",
  speechKeepAliveTimer: null,
  voices: [],
  clockTimer: null,
  animationId: null,
  demoStartedAt: 0
};

const analysisCanvas = document.createElement("canvas");
const analysisCtx = analysisCanvas.getContext("2d", { willReadFrequently: true });
const overlayCtx = els.overlay.getContext("2d");

const strictnessMap = {
  1: { label: "少说", cooldown: 7000, energy: 15, sway: 0.2 },
  2: { label: "平衡", cooldown: 4800, energy: 11, sway: 0.16 },
  3: { label: "严格", cooldown: 3000, energy: 8, sway: 0.12 }
};

const modeCopy = {
  side: "侧面视角",
  downline: "后方视角",
  fitness: "通用运动"
};

function refreshVoices() {
  if (!("speechSynthesis" in window)) return;
  state.voices = window.speechSynthesis.getVoices();
}

if ("speechSynthesis" in window) {
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}

function setStatus(text, tone = "ready") {
  els.modelStatus.textContent = text;
  const colors = {
    ready: ["rgba(48, 213, 168, 0.34)", "#bbf7d0", "rgba(20, 83, 45, 0.2)"],
    warn: ["rgba(245, 200, 75, 0.36)", "#fde68a", "rgba(113, 63, 18, 0.28)"],
    live: ["rgba(96, 165, 250, 0.45)", "#bfdbfe", "rgba(30, 64, 175, 0.24)"]
  }[tone];
  els.modelStatus.style.borderColor = colors[0];
  els.modelStatus.style.color = colors[1];
  els.modelStatus.style.background = colors[2];
}

async function loadPoseModel() {
  if (state.poseLoading || state.poseReady || state.poseFailed) return;
  state.poseLoading = true;
  setStatus("尝试加载姿态模型", "warn");
  try {
    const vision = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/+esm");
    const fileset = await vision.FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm");
    state.poseLandmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
      baseOptions: {
        modelAssetPath: "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task",
        delegate: "GPU"
      },
      runningMode: "VIDEO",
      numPoses: 1
    });
    state.poseReady = true;
    setStatus("姿态模型已增强", "ready");
  } catch (error) {
    console.info("Pose model unavailable; using motion analysis fallback.", error);
    state.poseFailed = true;
    setStatus("离线分析就绪", "ready");
  } finally {
    state.poseLoading = false;
  }
}

async function unlockAudio() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass && !state.audioContext) {
      state.audioContext = new AudioContextClass();
    }
    if (state.audioContext?.state === "suspended") {
      await state.audioContext.resume();
    }
    startSpeechKeepAlive();
    state.audioUnlocked = true;
    return true;
  } catch (error) {
    console.info("Audio unlock failed.", error);
    return false;
  }
}

function wait(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function startSpeechKeepAlive() {
  if (!("speechSynthesis" in window) || state.speechKeepAliveTimer) return;
  state.speechKeepAliveTimer = window.setInterval(() => {
    if (!document.hidden && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  }, 2500);
}

function playCueTone(force = false, pattern = "short") {
  if ((state.muted && !force) || !state.audioContext || state.audioContext.state !== "running") return;
  const now = state.audioContext.currentTime;
  const notes = pattern === "double"
    ? [{ at: 0, freq: 660 }, { at: 0.2, freq: 880 }]
    : [{ at: 0, freq: 660 }];

  notes.forEach((note) => {
    const oscillator = state.audioContext.createOscillator();
    const gain = state.audioContext.createGain();
    const start = now + note.at;
    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(note.freq, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.12, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.18);
    oscillator.connect(gain);
    gain.connect(state.audioContext.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.2);
  });
}

function pickVoice() {
  refreshVoices();
  const naturalName = /(Premium|Enhanced|Natural|Siri|婷婷|Ting-Ting|美佳|Mei-Jia|Sin-ji|Yu-shu|Li-mu|Mandarin|普通话|Chinese)/i;
  return state.voices.find((voice) => /^zh[-_](CN|HK|TW)/i.test(voice.lang) && naturalName.test(voice.name))
    || state.voices.find((voice) => /^zh[-_](CN|HK|TW)/i.test(voice.lang) && voice.localService)
    || state.voices.find((voice) => /^zh[-_](CN|HK|TW)/i.test(voice.lang))
    || state.voices.find((voice) => naturalName.test(voice.name))
    || state.voices.find((voice) => /^zh/i.test(voice.lang))
    || state.voices[0]
    || null;
}

function coachSpeakText(text) {
  return text
    .replace(/。/g, "。 ")
    .replace(/，/g, "， ")
    .replace(/下一杆/g, "下一杆，")
    .replace(/保持/g, "保持")
    .replace(/\s+/g, " ")
    .trim();
}

async function speak(text, force = false, interrupt = force) {
  if (state.muted && !force) return;
  if (!("speechSynthesis" in window)) {
    setStatus("浏览器不支持语音", "warn");
    playCueTone(force, "double");
    return;
  }
  await unlockAudio();
  playCueTone(force);

  const synth = window.speechSynthesis;
  if (interrupt || synth.speaking || synth.pending) {
    synth.cancel();
    await wait(80);
  }
  synth.resume();

  const utterance = new SpeechSynthesisUtterance(coachSpeakText(text));
  utterance.lang = "zh-CN";
  const voice = pickVoice();
  if (voice) utterance.voice = voice;
  utterance.rate = 0.88;
  utterance.pitch = 1.03;
  utterance.volume = 1;
  utterance.onstart = () => {
    state.lastSpeechError = "";
    setStatus(state.running ? "实时分析中" : "语音已打开", state.running ? "live" : "ready");
  };
  utterance.onerror = (event) => {
    state.lastSpeechError = event.error || "unknown";
    setStatus("语音被浏览器拦截，已用提示音", "warn");
    playCueTone(true, "double");
  };
  utterance.onend = () => {
    if (state.activeUtterance === utterance) state.activeUtterance = null;
  };

  state.activeUtterance = utterance;
  synth.speak(utterance);

  window.setTimeout(() => {
    if (state.activeUtterance === utterance && !synth.speaking && !synth.pending) {
      setStatus("语音未启动，已用提示音", "warn");
      playCueTone(true, "double");
    }
  }, 900);
}

function addCue(text, severity = "info", force = false, shouldSpeak = true) {
  const now = performance.now();
  const config = strictnessMap[state.strictness];
  if (!force && text === state.lastCueText && now - state.lastCueAt < 10000) return;
  if (!force && now - state.lastCueAt < config.cooldown) return;

  state.lastCueAt = force ? 0 : now;
  state.lastCueText = text;
  state.cueCount += 1;
  els.cueCount.textContent = String(state.cueCount);
  els.currentTip.textContent = text;

  const item = document.createElement("li");
  item.dataset.severity = severity;
  const time = document.createElement("time");
  time.textContent = new Date().toLocaleTimeString("zh-Hans", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const body = document.createElement("span");
  body.textContent = text;
  item.append(time, body);
  els.cueLog.prepend(item);
  while (els.cueLog.children.length > 20) els.cueLog.lastElementChild.remove();
  if (shouldSpeak) speak(text, true, true);
}

function showCueText(text) {
  els.currentTip.textContent = text;
}

function updateClock() {
  if (!state.startedAt) return;
  const seconds = Math.floor((Date.now() - state.startedAt) / 1000);
  const min = String(Math.floor(seconds / 60)).padStart(2, "0");
  const sec = String(seconds % 60).padStart(2, "0");
  els.sessionClock.textContent = `${min}:${sec}`;
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    addCue("这个浏览器不支持摄像头。可以先上传挥杆视频体验分析。", "warn");
    return;
  }

  stopSource();
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 60 }
      },
      audio: false
    });
    state.stream = stream;
    state.sourceType = "camera";
    els.video.srcObject = stream;
    els.video.muted = true;
    await els.video.play();
    beginAnalysis();
  } catch (error) {
    console.error(error);
    setStatus("摄像头未授权", "warn");
    addCue("摄像头没有打开。你可以授权摄像头，或者先上传一段挥杆视频。", "warn");
  }
}

function stopSource() {
  if (state.stream) {
    state.stream.getTracks().forEach((track) => track.stop());
    state.stream = null;
  }
  if (state.animationId) cancelAnimationFrame(state.animationId);
  state.animationId = null;
}

function resetAnalysis(announce = true) {
  state.baseline = null;
  state.armed = state.sourceType === "demo";
  state.quietStartedAt = null;
  state.ignoreMotionUntil = performance.now() + 1600;
  state.previousFrame = null;
  state.previousMotion = null;
  state.samples = [];
  state.swing = null;
  state.lastFrameAt = 0;
  els.tempoValue.textContent = "--";
  els.stabilityValue.textContent = "--";
  els.rangeValue.textContent = "--";
  if (announce) showCueText("已重新校准。下一杆保持站位两秒，让我建立你的静止基准。");
}

function beginAnalysis() {
  state.running = true;
  state.startedAt = Date.now();
  state.swingCount = 0;
  state.cueCount = 0;
  state.bestTempo = null;
  state.consistency = [];
  els.swingCount.textContent = "0";
  els.cueCount.textContent = "0";
  els.bestTempo.textContent = "--";
  els.consistencyScore.textContent = "--";
  els.empty.classList.add("hidden");
  els.start.innerHTML = '<span class="button-icon">■</span><span>停止指导</span>';
  resetAnalysis(false);
  setStatus("校准中，请站稳", "warn");
  clearInterval(state.clockTimer);
  state.clockTimer = setInterval(updateClock, 500);
  updateClock();
  showCueText("先站稳 2 秒让我校准。提示变成“可以挥杆”后再挥杆，我会等动作完成后播报。");
  requestAnimationFrame(analyzeFrame);
}

function beginDemo() {
  stopSource();
  state.sourceType = "demo";
  state.running = true;
  state.startedAt = Date.now();
  state.demoStartedAt = performance.now();
  state.swingCount = 0;
  state.cueCount = 0;
  state.bestTempo = null;
  state.consistency = [];
  els.swingCount.textContent = "0";
  els.cueCount.textContent = "0";
  els.bestTempo.textContent = "--";
  els.consistencyScore.textContent = "--";
  els.empty.classList.add("hidden");
  els.start.innerHTML = '<span class="button-icon">■</span><span>停止指导</span>';
  setStatus("演示分析中", "live");
  resetAnalysis(false);
  clearInterval(state.clockTimer);
  state.clockTimer = setInterval(updateClock, 500);
  updateClock();
  showCueText("演示模式已启动。我会模拟几次挥杆，让你先体验耳机提示节奏。");
  requestAnimationFrame(analyzeDemoFrame);
}

function stopAnalysis() {
  state.running = false;
  stopSource();
  clearInterval(state.clockTimer);
  els.start.innerHTML = '<span class="button-icon">▶</span><span>开始实时指导</span>';
  els.empty.classList.toggle("hidden", state.sourceType === "file");
  setStatus("已暂停", "warn");
}

function loadVideoFile(file) {
  if (!file) return;
  stopSource();
  resetAnalysis(false);
  const url = URL.createObjectURL(file);
  els.video.srcObject = null;
  els.video.src = url;
  els.video.muted = true;
  els.video.loop = true;
  state.sourceType = "file";
  els.video.onloadedmetadata = async () => {
    await els.video.play();
    beginAnalysis();
  };
}

function prepareCanvas() {
  const video = els.video;
  const width = video.videoWidth || 640;
  const height = video.videoHeight || 360;
  if (analysisCanvas.width !== width || analysisCanvas.height !== height) {
    analysisCanvas.width = width;
    analysisCanvas.height = height;
    els.overlay.width = width;
    els.overlay.height = height;
  }
  return { width, height };
}

function prepareDemoCanvas() {
  const panel = document.querySelector(".camera-panel");
  const rect = panel.getBoundingClientRect();
  const width = Math.max(640, Math.round(rect.width * window.devicePixelRatio));
  const height = Math.max(360, Math.round(rect.height * window.devicePixelRatio));
  if (els.overlay.width !== width || els.overlay.height !== height) {
    els.overlay.width = width;
    els.overlay.height = height;
  }
  return { width, height };
}

function getFrameData(width, height) {
  analysisCtx.drawImage(els.video, 0, 0, width, height);
  return analysisCtx.getImageData(0, 0, width, height);
}

function analyzeImage(imageData, width, height) {
  const data = imageData.data;
  const step = 8;
  const threshold = 34;
  let changed = 0;
  let total = 0;
  let sumX = 0;
  let sumY = 0;
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;

  if (!state.previousFrame) {
    state.previousFrame = new Uint8ClampedArray(data);
    return null;
  }

  const prev = state.previousFrame;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const diff = Math.abs(data[i] - prev[i]) + Math.abs(data[i + 1] - prev[i + 1]) + Math.abs(data[i + 2] - prev[i + 2]);
      total += 1;
      if (diff > threshold) {
        changed += 1;
        sumX += x;
        sumY += y;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  state.previousFrame = new Uint8ClampedArray(data);
  const energy = (changed / total) * 100;
  const center = changed
    ? { x: sumX / changed / width, y: sumY / changed / height }
    : state.previousMotion?.center || { x: 0.5, y: 0.5 };
  const box = changed ? { minX, minY, maxX, maxY } : null;
  const widthRatio = box ? (maxX - minX) / width : 0;
  const heightRatio = box ? (maxY - minY) / height : 0;

  return { energy, center, box, widthRatio, heightRatio, changed, timestamp: performance.now() };
}

function getPoseSample(timestamp) {
  if (!state.poseReady || !state.poseLandmarker || state.sourceType === "demo") return null;
  try {
    const result = state.poseLandmarker.detectForVideo(els.video, Math.round(timestamp));
    const landmarks = result?.landmarks?.[0];
    if (!landmarks) return null;
    const point = (index) => landmarks[index];
    const avg = (...points) => ({
      x: points.reduce((sum, item) => sum + item.x, 0) / points.length,
      y: points.reduce((sum, item) => sum + item.y, 0) / points.length
    });
    const head = avg(point(0), point(7), point(8));
    const shoulders = avg(point(11), point(12));
    const hips = avg(point(23), point(24));
    const wrists = avg(point(15), point(16));
    const shoulderSpan = Math.abs(point(11).x - point(12).x);
    const hipSpan = Math.abs(point(23).x - point(24).x);
    return {
      landmarks,
      headY: head.y,
      headX: head.x,
      hipX: hips.x,
      hipY: hips.y,
      wristY: wrists.y,
      shoulderTilt: point(11).y - point(12).y,
      coilProxy: shoulderSpan / Math.max(0.05, hipSpan),
      torsoLean: shoulders.x - hips.x
    };
  } catch (error) {
    console.info("Pose frame failed; continuing with motion analysis.", error);
    return null;
  }
}

function smoothSamples(sample) {
  state.samples.push(sample);
  if (state.samples.length > 90) state.samples.shift();
  const recent = state.samples.slice(-8);
  const avgEnergy = recent.reduce((sum, item) => sum + item.energy, 0) / recent.length;
  const avgX = recent.reduce((sum, item) => sum + item.center.x, 0) / recent.length;
  const avgY = recent.reduce((sum, item) => sum + item.center.y, 0) / recent.length;
  return { ...sample, avgEnergy, avgX, avgY };
}

function updateBaseline(sample) {
  if (sample.avgEnergy > 4) return;
  if (!state.baseline) {
    state.baseline = { x: sample.avgX, y: sample.avgY, count: 1 };
    return;
  }
  const alpha = 0.06;
  state.baseline.x = state.baseline.x * (1 - alpha) + sample.avgX * alpha;
  state.baseline.y = state.baseline.y * (1 - alpha) + sample.avgY * alpha;
  state.baseline.count += 1;
}

function updateArming(sample) {
  if (state.sourceType === "demo") {
    state.armed = true;
    return true;
  }

  const now = sample.timestamp;
  if (now < state.ignoreMotionUntil) {
    setStatus("校准中，请站稳", "warn");
    return false;
  }

  if (state.armed) return true;

  const quietEnough = sample.avgEnergy < 4.2;
  if (quietEnough) {
    if (!state.quietStartedAt) state.quietStartedAt = now;
    const quietDuration = now - state.quietStartedAt;
    if (quietDuration > 1400 && state.baseline?.count >= 5) {
      state.armed = true;
      setStatus("已校准，可以挥杆", "live");
      showCueText("已校准。现在挥杆，动作完成后我只播报一条最关键提示。");
      return true;
    }
  } else {
    state.quietStartedAt = null;
    setStatus("请先站稳校准", "warn");
  }

  return false;
}

function classifySwing(sample) {
  const config = strictnessMap[state.strictness];
  const active = sample.avgEnergy > config.energy;
  const startMotionSpread = Math.max(sample.widthRatio, sample.heightRatio);
  const startActive = sample.avgEnergy > Math.max(16, config.energy * 1.25) && startMotionSpread > 0.14;
  const now = sample.timestamp;

  if (!state.swing && startActive) {
    state.swing = {
      startedAt: now,
      peakEnergy: sample.avgEnergy,
      maxWidth: sample.widthRatio,
      maxHeight: sample.heightRatio,
      minY: sample.center.y,
      maxY: sample.center.y,
      minX: sample.center.x,
      maxX: sample.center.x,
      samples: [sample]
    };
    return;
  }

  if (state.swing) {
    state.swing.peakEnergy = Math.max(state.swing.peakEnergy, sample.avgEnergy);
    state.swing.maxWidth = Math.max(state.swing.maxWidth, sample.widthRatio);
    state.swing.maxHeight = Math.max(state.swing.maxHeight, sample.heightRatio);
    state.swing.minY = Math.min(state.swing.minY, sample.center.y);
    state.swing.maxY = Math.max(state.swing.maxY, sample.center.y);
    state.swing.minX = Math.min(state.swing.minX, sample.center.x);
    state.swing.maxX = Math.max(state.swing.maxX, sample.center.x);
    state.swing.samples.push(sample);

    const elapsed = now - state.swing.startedAt;
    const quietAgain = sample.avgEnergy < Math.max(4, config.energy * 0.45) && elapsed > 650;
    const timeout = elapsed > 5500;
    if (quietAgain || timeout) {
      finishSwing(state.swing, now);
      state.swing = null;
    }
  }
}

function finishSwing(swing, endedAt) {
  const duration = (endedAt - swing.startedAt) / 1000;
  const movementSpread = Math.max(swing.maxWidth, swing.maxHeight);
  const centerTravel = Math.hypot(swing.maxX - swing.minX, swing.maxY - swing.minY);
  if (duration < 0.8 || swing.peakEnergy < 14 || movementSpread < 0.28 || centerTravel < 0.08) return;

  state.swingCount += 1;
  els.swingCount.textContent = String(state.swingCount);
  const tempo = Math.max(0.4, Math.min(3.5, duration));
  const tempoScore = Math.round(100 - Math.min(70, Math.abs(tempo - 1.45) * 42));
  const sway = Math.abs((swing.maxX - swing.minX) - (state.baseline ? Math.abs(state.baseline.x - 0.5) : 0));
  const verticalJump = swing.maxY - swing.minY;
  const rangeScore = Math.round(Math.min(100, Math.max(25, swing.maxWidth * 185 + swing.maxHeight * 62)));
  const stabilityScore = Math.round(Math.max(20, 100 - sway * 220 - verticalJump * 65));
  const poseStats = summarizePose(swing.samples);
  const combined = Math.round((tempoScore * 0.42 + stabilityScore * 0.36 + rangeScore * 0.22));

  state.bestTempo = state.bestTempo ? Math.min(state.bestTempo, Math.abs(tempo - 1.45)) < Math.abs(state.bestTempo - 1.45) ? state.bestTempo : tempo : tempo;
  state.consistency.push(combined);
  if (state.consistency.length > 8) state.consistency.shift();

  els.tempoValue.textContent = `${tempo.toFixed(1)}s`;
  els.stabilityValue.textContent = String(stabilityScore);
  els.rangeValue.textContent = String(rangeScore);
  els.bestTempo.textContent = `${state.bestTempo.toFixed(1)}s`;
  els.consistencyScore.textContent = String(Math.round(state.consistency.reduce((a, b) => a + b, 0) / state.consistency.length));

  const cue = chooseCue({ tempo, sway, verticalJump, rangeScore, stabilityScore, combined, swing, poseStats });
  if (cue) addCue(cue.text, cue.severity);
}

function summarizePose(samples) {
  const poses = samples.map((sample) => sample.pose).filter(Boolean);
  if (poses.length < 4) return null;
  const headYs = poses.map((pose) => pose.headY);
  const hipXs = poses.map((pose) => pose.hipX);
  const wristYs = poses.map((pose) => pose.wristY);
  const coils = poses.map((pose) => pose.coilProxy);
  return {
    headLift: Math.max(...headYs) - Math.min(...headYs),
    hipSway: Math.max(...hipXs) - Math.min(...hipXs),
    wristRange: Math.max(...wristYs) - Math.min(...wristYs),
    coil: Math.max(...coils)
  };
}

function chooseCue(result) {
  const strict = state.strictness;
  const cues = [];

  if (result.tempo < 0.95) {
    cues.push({ severity: "warn", weight: 5, text: "这杆节奏太急。下一杆上杆慢一点，转身完成后再启动下杆。" });
  }
  if (result.tempo > 2.25) {
    cues.push({ severity: "info", weight: 3, text: "节奏有点拖。保持准备动作安静，然后用一个连续的节拍挥过去。" });
  }
  if (result.sway > strictnessMap[strict].sway) {
    cues.push({ severity: "warn", weight: 5, text: state.mode === "downline"
      ? "身体横向晃动偏多。下一杆让胸口绕脊柱转，不要左右追球。"
      : "重心横移偏多。下一杆右脚内侧稳住，像绕身体中轴转过去。" });
  }
  if (result.poseStats?.hipSway > 0.13) {
    cues.push({ severity: "warn", weight: 6, text: "姿态模型看到髋部横移偏多。下一杆让髋部先转起来，不要整个人滑向目标。" });
  }
  if (result.poseStats?.headLift > 0.11 && state.mode !== "fitness") {
    cues.push({ severity: "warn", weight: 6, text: "头部高度变化偏大。下一杆盯住球后方，等杆头通过后再抬头。" });
  }
  if (result.poseStats?.wristRange < 0.18 && result.rangeScore < 68) {
    cues.push({ severity: "info", weight: 4, text: "手腕和手臂上杆高度偏低。下一杆先把肩转满，再自然完成上杆。" });
  }
  if (result.poseStats?.coil < 1.08 && state.mode === "side") {
    cues.push({ severity: "info", weight: 3, text: "肩髋分离还不明显。下一杆感觉胸口多转一点，髋部保持稳定。" });
  }
  if (result.verticalJump > 0.24 && state.mode !== "fitness") {
    cues.push({ severity: "warn", weight: 4, text: "击球区身体高度变化明显。下一杆保持头部高度，等收杆后再看球。" });
  }
  if (result.rangeScore < 48) {
    cues.push({ severity: "info", weight: 2, text: "动作幅度偏小。先不加力，把肩膀转满，再让手臂自然跟上。" });
  }
  if (result.combined > 78 && state.swingCount > 1) {
    cues.push({ severity: "info", weight: 1, text: "这杆整体更稳定。记住这个节奏，下一杆复制同样的上杆速度。" });
  }
  if (!cues.length) {
    cues.push({ severity: "info", weight: 1, text: "这一杆没有明显问题。继续保持画面里的站位和节奏。" });
  }

  cues.sort((a, b) => b.weight - a.weight);
  return cues[0];
}

function drawOverlay(sample) {
  const { width, height } = els.overlay;
  overlayCtx.clearRect(0, 0, width, height);
  overlayCtx.save();
  overlayCtx.lineWidth = Math.max(2, width / 300);
  overlayCtx.strokeStyle = "rgba(48, 213, 168, 0.9)";
  overlayCtx.fillStyle = "rgba(48, 213, 168, 0.12)";
  if (sample?.box) {
    const { minX, minY, maxX, maxY } = sample.box;
    overlayCtx.strokeRect(minX, minY, maxX - minX, maxY - minY);
    overlayCtx.fillRect(minX, minY, maxX - minX, maxY - minY);
  }
  if (state.baseline) {
    overlayCtx.strokeStyle = "rgba(245, 200, 75, 0.9)";
    overlayCtx.beginPath();
    overlayCtx.moveTo(state.baseline.x * width, 0);
    overlayCtx.lineTo(state.baseline.x * width, height);
    overlayCtx.stroke();
  }
  if (sample) {
    overlayCtx.fillStyle = "rgba(96, 165, 250, 0.95)";
    overlayCtx.beginPath();
    overlayCtx.arc(sample.center.x * width, sample.center.y * height, Math.max(5, width / 130), 0, Math.PI * 2);
    overlayCtx.fill();
  }
  if (sample?.pose?.landmarks) {
    drawPose(sample.pose.landmarks, width, height);
  }
  overlayCtx.restore();
}

function drawPose(landmarks, width, height) {
  const links = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]
  ];
  overlayCtx.strokeStyle = "rgba(96, 165, 250, 0.92)";
  overlayCtx.fillStyle = "rgba(96, 165, 250, 0.95)";
  overlayCtx.lineWidth = Math.max(2, width / 360);
  links.forEach(([a, b]) => {
    const p1 = landmarks[a];
    const p2 = landmarks[b];
    if (!p1 || !p2) return;
    overlayCtx.beginPath();
    overlayCtx.moveTo(p1.x * width, p1.y * height);
    overlayCtx.lineTo(p2.x * width, p2.y * height);
    overlayCtx.stroke();
  });
  [0, 11, 12, 15, 16, 23, 24, 27, 28].forEach((index) => {
    const point = landmarks[index];
    if (!point) return;
    overlayCtx.beginPath();
    overlayCtx.arc(point.x * width, point.y * height, Math.max(3, width / 260), 0, Math.PI * 2);
    overlayCtx.fill();
  });
}

function analyzeFrame(timestamp) {
  if (!state.running) return;
  state.animationId = requestAnimationFrame(analyzeFrame);
  if (!els.video.videoWidth || els.video.paused || els.video.ended) return;
  if (timestamp - state.lastFrameAt < 75) return;
  state.lastFrameAt = timestamp;

  const { width, height } = prepareCanvas();
  const frame = getFrameData(width, height);
  const raw = analyzeImage(frame, width, height);
  if (!raw) return;
  raw.pose = getPoseSample(timestamp);
  const sample = smoothSamples(raw);
  updateBaseline(sample);
  const armed = updateArming(sample);
  if (armed) {
    classifySwing(sample);
  } else {
    state.swing = null;
  }
  drawOverlay(sample);
  state.previousMotion = sample;

  if (!state.armed && !state.baseline && state.samples.length > 30) {
    setStatus("请保持站姿 2 秒校准", "warn");
  } else if (state.armed) {
    setStatus("实时分析中", "live");
  }
}

function analyzeDemoFrame(timestamp) {
  if (!state.running || state.sourceType !== "demo") return;
  state.animationId = requestAnimationFrame(analyzeDemoFrame);
  if (timestamp - state.lastFrameAt < 75) return;
  state.lastFrameAt = timestamp;

  const { width, height } = prepareDemoCanvas();
  const t = (timestamp - state.demoStartedAt) / 1000;
  const cycle = t % 4.8;
  const active = cycle > 1.2 && cycle < 2.85;
  const wave = active ? Math.sin(((cycle - 1.2) / 1.65) * Math.PI) : 0;
  const drift = Math.sin(t * 0.72) * 0.035;
  const sample = {
    energy: active ? 10 + wave * 28 : 1.6,
    avgEnergy: active ? 10 + wave * 28 : 1.6,
    center: { x: 0.5 + drift + wave * 0.11, y: 0.55 - wave * 0.18 },
    avgX: 0.5 + drift + wave * 0.11,
    avgY: 0.55 - wave * 0.18,
    box: active
      ? { minX: width * (0.34 - wave * 0.08), minY: height * (0.26 - wave * 0.05), maxX: width * (0.66 + wave * 0.12), maxY: height * (0.8 + wave * 0.03) }
      : null,
    widthRatio: active ? 0.32 + wave * 0.2 : 0,
    heightRatio: active ? 0.54 + wave * 0.1 : 0,
    changed: active ? 300 : 8,
    timestamp
  };
  updateBaseline(sample);
  classifySwing(sample);
  drawOverlay(sample);
}

els.start.addEventListener("click", () => {
  if (state.running) {
    stopAnalysis();
  } else {
    unlockAudio();
    startCamera();
  }
});

els.mute.addEventListener("click", () => {
  state.muted = !state.muted;
  els.muteIcon.textContent = state.muted ? "🔇" : "🔊";
  if (!state.muted) speak("语音提示已打开。", true);
});

els.testAudio.addEventListener("click", async () => {
  state.muted = false;
  els.muteIcon.textContent = "🔊";
  const unlocked = await unlockAudio();
  playCueTone(true, "double");
  els.currentTip.textContent = unlocked
    ? "语音测试已发送。你应该先听到两声提示音，然后听到中文播报。"
    : "浏览器没有打开音频通道。请换 Safari 或 Chrome 再试一次。";
  speak("耳机测试。听到这句话，就说明实时教练语音已经打开。", true);
});

els.calibrate.addEventListener("click", () => resetAnalysis(true));

els.demo.addEventListener("click", () => {
  if (state.running) stopAnalysis();
  unlockAudio();
  beginDemo();
});

els.file.addEventListener("change", (event) => {
  loadVideoFile(event.target.files?.[0]);
});

els.clearLog.addEventListener("click", () => {
  els.cueLog.innerHTML = "";
  state.cueCount = 0;
  els.cueCount.textContent = "0";
});

els.strictness.addEventListener("input", (event) => {
  state.strictness = Number(event.target.value);
  els.strictnessLabel.textContent = strictnessMap[state.strictness].label;
});

document.querySelectorAll(".segment").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".segment").forEach((item) => item.classList.remove("active"));
    button.classList.add("active");
    state.mode = button.dataset.mode;
    els.viewLabel.textContent = modeCopy[state.mode];
    resetAnalysis(false);
    addCue(`${modeCopy[state.mode]}已启用。保持完整身体进入画面，我会按这个角度判断。`, "info");
  });
});

document.addEventListener("visibilitychange", () => {
  if (document.hidden && "speechSynthesis" in window) window.speechSynthesis.cancel();
});

setStatus("离线分析就绪", "ready");
loadPoseModel();
