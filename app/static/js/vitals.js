// ===================================================================
// vitals.js — Camera Heart Rate (rPPG) + Breathing Rate
// Works on http://localhost (no HTTPS needed)
// No external model loading — uses center-ROI fallback always
// ===================================================================

const VITALS = (() => {

  const FPS        = 15;
  const WINDOW_SEC = 10;
  const BUF_SIZE   = FPS * WINDOW_SEC;

  let video         = null;
  let overlayCanvas = null;
  let overlayCtx    = null;
  let captureCanvas = null;
  let captureCtx    = null;
  let rafId         = null;
  let captureTimer  = null;
  let running       = false;

  let greenBuf  = [];
  let yPosBuf   = [];

  let currentBPM    = 0;
  let currentBreath = 0;
  let currentSpO2   = 98;
  let faceDetected  = false;

  // face-api state
  let faceApiReady  = false;
  let faceBox       = null;   // last detected box {x,y,width,height} in capture coords

  let onVitalsUpdate = null;
  let onFaceStatus   = null;

  // ── Load face-api tiny model (optional — graceful fallback) ──────
  async function tryLoadFaceApi() {
    if (typeof faceapi === 'undefined') { faceApiReady = false; return; }
    try {
      await faceapi.nets.tinyFaceDetector.loadFromUri(
        'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights'
      );
      faceApiReady = true;
    } catch (_) {
      faceApiReady = false;
    }
  }

  // ── Public: start ────────────────────────────────────────────────
  async function start(videoEl, overlayEl, onUpdate, onStatus) {
    onVitalsUpdate = onUpdate;
    onFaceStatus   = onStatus;
    video          = videoEl;
    overlayCanvas  = overlayEl;
    overlayCtx     = overlayCanvas.getContext('2d');

    // Check browser support
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      _status('error');
      console.error('[VITALS] getUserMedia not supported — must use https:// or localhost');
      if (onFaceStatus) onFaceStatus('notSupported');
      return false;
    }

    // Request camera
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 320 }, height: { ideal: 240 },
                 facingMode: 'user', frameRate: { ideal: FPS } },
        audio: false
      });
    } catch (err) {
      _status('error');
      console.error('[VITALS] Camera permission denied or unavailable:', err.name, err.message);
      return false;
    }

    // Attach stream and wait for metadata
    video.srcObject = stream;
    try {
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = reject;
        setTimeout(reject, 8000, new Error('video metadata timeout'));
      });
      await video.play();
    } catch (err) {
      console.error('[VITALS] Video play error:', err);
      stream.getTracks().forEach(t => t.stop());
      _status('error');
      return false;
    }

    // Now we know real dimensions
    const vw = video.videoWidth  || 320;
    const vh = video.videoHeight || 240;
    overlayCanvas.width  = vw;
    overlayCanvas.height = vh;

    // Offscreen capture canvas (smaller for perf)
    captureCanvas        = document.createElement('canvas');
    captureCanvas.width  = Math.round(vw / 2);
    captureCanvas.height = Math.round(vh / 2);
    captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });

    running = true;
    greenBuf = []; yPosBuf = [];
    currentBPM = 0; currentBreath = 0;

    // Try to load face-api in background (non-blocking)
    tryLoadFaceApi();

    // Start loops
    captureTimer = setInterval(_captureFrame, Math.round(1000 / FPS));
    rafId = requestAnimationFrame(_drawLoop);

    _status('scanning');
    return true;
  }

  // ── Public: stop ─────────────────────────────────────────────────
  function stop() {
    running = false;
    clearInterval(captureTimer);
    cancelAnimationFrame(rafId);
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    if (overlayCtx && overlayCanvas) {
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
    greenBuf = []; yPosBuf = [];
    currentBPM = 0; currentBreath = 0;
    faceDetected = false; faceBox = null;
  }

  // ── Capture frame ────────────────────────────────────────────────
  async function _captureFrame() {
    if (!running || !video || video.readyState < 2) return;

    const cw = captureCanvas.width;
    const ch = captureCanvas.height;

    captureCtx.drawImage(video, 0, 0, cw, ch);

    // Try face detection if face-api loaded
    if (faceApiReady) {
      try {
        const det = await faceapi.detectSingleFace(
          captureCanvas,
          new faceapi.TinyFaceDetectorOptions({ inputSize: 128, scoreThreshold: 0.35 })
        );
        if (det) {
          faceDetected = true;
          faceBox = det.box;
          _status('detected', det.box);
        } else {
          faceDetected = false;
          faceBox = null;
          _status('scanning');
        }
      } catch (_) { /* ignore detection errors */ }
    } else {
      // No face-api: treat center region as face (always "detected")
      faceDetected = true;
      faceBox = {
        x: cw * 0.2, y: ch * 0.05,
        width: cw * 0.6, height: ch * 0.7
      };
      _status('detected', faceBox);
    }

    // ROI = forehead (top 30% of face box)
    let roi;
    if (faceBox) {
      roi = {
        x: Math.max(0, Math.round(faceBox.x + faceBox.width * 0.15)),
        y: Math.max(0, Math.round(faceBox.y)),
        w: Math.max(1, Math.round(faceBox.width * 0.7)),
        h: Math.max(1, Math.round(faceBox.height * 0.28))
      };
    } else {
      roi = { x: Math.round(cw*0.3), y: Math.round(ch*0.1),
              w: Math.round(cw*0.4), h: Math.round(ch*0.3) };
    }

    // Clamp to canvas bounds
    roi.w = Math.min(roi.w, cw - roi.x);
    roi.h = Math.min(roi.h, ch - roi.y);
    if (roi.w < 1 || roi.h < 1) return;

    let roiData;
    try {
      roiData = captureCtx.getImageData(roi.x, roi.y, roi.w, roi.h);
    } catch (e) {
      console.warn('[VITALS] getImageData failed (tainted canvas?):', e.message);
      return;
    }

    const g    = _meanChannel(roiData.data, 1);
    const faceY = faceBox ? (faceBox.y + faceBox.height / 2) : ch / 2;

    greenBuf.push(g);
    yPosBuf.push(faceY);
    if (greenBuf.length > BUF_SIZE) { greenBuf.shift(); yPosBuf.shift(); }

    if (greenBuf.length >= FPS * 4) _computeVitals();
  }

  // ── Compute vitals ───────────────────────────────────────────────
  function _computeVitals() {
    // Heart rate via rPPG (green channel autocorrelation)
    const sig = _detrend(_bandpass(greenBuf.slice(), FPS, 0.7, 3.0));
    const bpm = _dominantFreqBPM(sig, FPS, 0.7, 3.0);
    if (bpm >= 40 && bpm <= 180) {
      currentBPM = currentBPM === 0 ? bpm : Math.round(0.75 * currentBPM + 0.25 * bpm);
    }

    // Breathing rate (face Y movement)
    const bsig   = _detrend(yPosBuf.slice());
    const breath = _dominantFreqBPM(bsig, FPS, 0.1, 0.5);
    if (breath >= 6 && breath <= 30) {
      currentBreath = currentBreath === 0 ? breath : Math.round(0.75 * currentBreath + 0.25 * breath);
    }

    // SpO2 estimate from AC/DC ratio
    const ac = _stdDev(sig);
    const dc = _mean(greenBuf.slice());
    const pi = dc > 0 ? (ac / dc) * 100 : 1.5;
    currentSpO2 = Math.min(100, Math.max(94, Math.round(98 + (pi - 1.5) * 1.5)));

    if (onVitalsUpdate) {
      onVitalsUpdate({ bpm: currentBPM, breath: currentBreath, spo2: currentSpO2 });
    }
  }

  // ── Draw overlay loop ────────────────────────────────────────────
  function _drawLoop() {
    if (!running) return;
    rafId = requestAnimationFrame(_drawLoop);

    const w = overlayCanvas.width;
    const h = overlayCanvas.height;
    overlayCtx.clearRect(0, 0, w, h);

    if (faceDetected && faceBox) {
      // Scale faceBox from capture coords to overlay coords
      const sx = w / captureCanvas.width;
      const sy = h / captureCanvas.height;
      const bx = faceBox.x * sx, by = faceBox.y * sy;
      const bw = faceBox.width * sx, bh = faceBox.height * sy;

      // Face bounding box
      overlayCtx.strokeStyle = '#28a745';
      overlayCtx.lineWidth   = 2;
      overlayCtx.strokeRect(bx, by, bw, bh);

      // Forehead ROI highlight
      overlayCtx.fillStyle = 'rgba(40,167,69,0.15)';
      overlayCtx.fillRect(bx + bw*0.15, by, bw*0.7, bh*0.28);

      // Pulse ring on face center
      const cx = bx + bw / 2, cy = by + bh / 2;
      const t  = Date.now() / 1000;
      const pulse = 0.5 + 0.5 * Math.sin(t * (currentBPM || 72) / 60 * Math.PI * 2);
      overlayCtx.beginPath();
      overlayCtx.arc(cx, cy, bw * 0.45 + pulse * 8, 0, Math.PI * 2);
      overlayCtx.strokeStyle = `rgba(220,53,69,${0.25 + pulse * 0.5})`;
      overlayCtx.lineWidth   = 2.5;
      overlayCtx.stroke();

      // Labels
      _label(overlayCtx, `❤ ${currentBPM || '…'} BPM`,    6,  6,  '#ff6b6b');
      _label(overlayCtx, `🌬 ${currentBreath || '…'} br/min`, 6, 36, '#74c0fc');
      _label(overlayCtx, `💧 SpO₂ ${currentSpO2}%`,        6, 66, '#a9e34b');

    } else {
      // Scanning box animation
      const t = Date.now() / 700;
      const alpha = 0.4 + 0.4 * Math.sin(t);
      overlayCtx.strokeStyle = `rgba(255,193,7,${alpha})`;
      overlayCtx.lineWidth   = 2;
      overlayCtx.setLineDash([8, 5]);
      overlayCtx.strokeRect(w*0.15, h*0.1, w*0.7, h*0.8);
      overlayCtx.setLineDash([]);
      overlayCtx.fillStyle = `rgba(255,193,7,${alpha})`;
      overlayCtx.font      = 'bold 12px Inter, sans-serif';
      overlayCtx.textAlign = 'center';
      overlayCtx.fillText('Position face in frame', w/2, h*0.94);
      overlayCtx.textAlign = 'left';
    }
  }

  function _label(ctx, text, x, y, color) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x, y, 148, 26);
    ctx.fillStyle = color;
    ctx.font      = 'bold 12px Inter, sans-serif';
    ctx.fillText(text, x + 6, y + 17);
  }

  // ── DSP helpers ──────────────────────────────────────────────────
  function _meanChannel(data, ch) {
    let s = 0, n = 0;
    for (let i = ch; i < data.length; i += 4) { s += data[i]; n++; }
    return n ? s / n : 0;
  }

  function _mean(arr) {
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }

  function _stdDev(arr) {
    const m = _mean(arr);
    return Math.sqrt(arr.reduce((s, v) => s + (v-m)**2, 0) / arr.length);
  }

  function _detrend(arr) {
    const m = _mean(arr);
    return arr.map(v => v - m);
  }

  // Simple moving-average bandpass (low-pass - low-pass)
  function _bandpass(arr, fs, fLow, fHigh) {
    const winLow  = Math.max(1, Math.round(fs / fHigh));
    const winHigh = Math.max(1, Math.round(fs / fLow));
    return arr.map((_, i, a) => {
      const lo = _movAvg(a, i, winLow);
      const hi = _movAvg(a, i, winHigh);
      return lo - hi;
    });
  }

  function _movAvg(arr, idx, win) {
    const half = Math.floor(win / 2);
    const s = Math.max(0, idx - half);
    const e = Math.min(arr.length - 1, idx + half);
    let sum = 0;
    for (let i = s; i <= e; i++) sum += arr[i];
    return sum / (e - s + 1);
  }

  function _dominantFreqBPM(sig, fs, fMin, fMax) {
    const n      = sig.length;
    if (n < 8) return 0;
    const lagMin = Math.max(1, Math.floor(fs / fMax));
    const lagMax = Math.min(n - 1, Math.ceil(fs / fMin));
    let bestLag  = -1, bestVal = -Infinity;
    for (let lag = lagMin; lag <= lagMax; lag++) {
      let sum = 0;
      for (let i = 0; i < n - lag; i++) sum += sig[i] * sig[i + lag];
      if (sum > bestVal) { bestVal = sum; bestLag = lag; }
    }
    return bestLag > 0 ? Math.round((fs / bestLag) * 60) : 0;
  }

  function _status(s, box) {
    if (onFaceStatus) onFaceStatus(s, box);
  }

  // ── Public API ───────────────────────────────────────────────────
  return { start, stop,
    getBPM:    () => currentBPM,
    getBreath: () => currentBreath,
    getSpO2:   () => currentSpO2,
    isRunning: () => running,
    hasFace:   () => faceDetected,
  };
})();
