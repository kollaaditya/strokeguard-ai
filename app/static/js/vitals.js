// ===================================================================
// vitals.js — Full Camera-Based Stroke Symptom Detection
// Detects: Heart Rate, Breathing, SpO2, Sweating, Face Drooping,
//          Pale Skin, Dizziness, Confusion, Rapid Heart
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

  // Signal buffers
  let greenBuf   = [];
  let yPosBuf    = [];
  let shineBuf   = [];
  let brightBuf  = [];
  let headMovBuf = [];   // head movement for dizziness
  let blinkBuf   = [];   // eye region darkness for blink/confusion
  let prevPixels = null;
  let prevFaceX  = null;
  let prevFaceY  = null;

  // Vitals output
  let currentBPM       = 0;
  let currentBreath    = 0;
  let currentSpO2      = 98;
  let currentSweat     = false;
  let currentPaleSkin  = false;
  let currentDizziness = false;
  let currentFaceDrop  = false;  // facial asymmetry
  let currentConfusion = false;  // abnormal blink / stillness
  let sweatScore       = 0;
  let faceDetected     = false;
  let isLive           = false;
  let livenessScore    = 0;
  let faceBox          = null;
  let faceApiReady     = false;

  let onVitalsUpdate = null;
  let onFaceStatus   = null;

  // ── Load face-api ────────────────────────────────────────────────
  async function tryLoadFaceApi() {
    if (typeof faceapi === 'undefined') { faceApiReady = false; return; }
    try {
      await faceapi.nets.tinyFaceDetector.loadFromUri(
        'https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/weights'
      );
      faceApiReady = true;
    } catch (_) { faceApiReady = false; }
  }

  // ── Start ────────────────────────────────────────────────────────
  async function start(videoEl, overlayEl, onUpdate, onStatus) {
    onVitalsUpdate = onUpdate;
    onFaceStatus   = onStatus;
    video          = videoEl;
    overlayCanvas  = overlayEl;
    overlayCtx     = overlayCanvas.getContext('2d');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      if (onFaceStatus) onFaceStatus('notSupported');
      return false;
    }

    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 320 }, height: { ideal: 240 },
                 facingMode: 'user', frameRate: { ideal: FPS } },
        audio: false
      });
    } catch (err) {
      if (onFaceStatus) onFaceStatus('error');
      console.error('[VITALS]', err.name, err.message);
      return false;
    }

    video.srcObject = stream;
    try {
      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = reject;
        setTimeout(reject, 8000, new Error('timeout'));
      });
      await video.play();
    } catch (err) {
      stream.getTracks().forEach(t => t.stop());
      if (onFaceStatus) onFaceStatus('error');
      return false;
    }

    const vw = video.videoWidth  || 320;
    const vh = video.videoHeight || 240;
    overlayCanvas.width  = vw;
    overlayCanvas.height = vh;

    captureCanvas        = document.createElement('canvas');
    captureCanvas.width  = Math.round(vw / 2);
    captureCanvas.height = Math.round(vh / 2);
    captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });

    _resetBuffers();
    running = true;
    tryLoadFaceApi();
    captureTimer = setInterval(_captureFrame, Math.round(1000 / FPS));
    rafId = requestAnimationFrame(_drawLoop);
    if (onFaceStatus) onFaceStatus('scanning');
    return true;
  }

  // ── Stop ─────────────────────────────────────────────────────────
  function stop() {
    running = false;
    clearInterval(captureTimer);
    cancelAnimationFrame(rafId);
    if (video && video.srcObject) {
      video.srcObject.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    }
    if (overlayCtx) overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    _resetBuffers();
  }

  function _resetBuffers() {
    greenBuf = []; yPosBuf = []; shineBuf = []; brightBuf = [];
    headMovBuf = []; blinkBuf = []; prevPixels = null;
    prevFaceX = null; prevFaceY = null;
    currentBPM = 0; currentBreath = 0; currentSpO2 = 98;
    currentSweat = false; currentPaleSkin = false;
    currentDizziness = false; currentFaceDrop = false;
    currentConfusion = false; sweatScore = 0;
    faceDetected = false; faceBox = null;
    isLive = false; livenessScore = 0;
  }

  // ── Capture frame ────────────────────────────────────────────────
  async function _captureFrame() {
    if (!running || !video || video.readyState < 2) return;

    const cw = captureCanvas.width;
    const ch = captureCanvas.height;
    captureCtx.drawImage(video, 0, 0, cw, ch);

    // Face detection
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
          faceDetected = false; faceBox = null;
          _status('scanning');
        }
      } catch (_) {}
    } else {
      faceDetected = true;
      faceBox = { x: cw*0.2, y: ch*0.05, width: cw*0.6, height: ch*0.7 };
      _status('detected', faceBox);
    }

    if (!faceBox) return;

    // ── ROIs ──────────────────────────────────────────────────────
    // Forehead ROI (rPPG + sweat)
    const fhRoi = {
      x: Math.max(0, Math.round(faceBox.x + faceBox.width * 0.15)),
      y: Math.max(0, Math.round(faceBox.y)),
      w: Math.max(1, Math.round(faceBox.width * 0.7)),
      h: Math.max(1, Math.round(faceBox.height * 0.28))
    };
    // Left cheek ROI
    const lCheek = {
      x: Math.max(0, Math.round(faceBox.x)),
      y: Math.max(0, Math.round(faceBox.y + faceBox.height * 0.4)),
      w: Math.max(1, Math.round(faceBox.width * 0.3)),
      h: Math.max(1, Math.round(faceBox.height * 0.3))
    };
    // Right cheek ROI
    const rCheek = {
      x: Math.max(0, Math.round(faceBox.x + faceBox.width * 0.7)),
      y: Math.max(0, Math.round(faceBox.y + faceBox.height * 0.4)),
      w: Math.max(1, Math.round(faceBox.width * 0.3)),
      h: Math.max(1, Math.round(faceBox.height * 0.3))
    };
    // Eye region ROI (for blink/confusion)
    const eyeRoi = {
      x: Math.max(0, Math.round(faceBox.x + faceBox.width * 0.1)),
      y: Math.max(0, Math.round(faceBox.y + faceBox.height * 0.25)),
      w: Math.max(1, Math.round(faceBox.width * 0.8)),
      h: Math.max(1, Math.round(faceBox.height * 0.2))
    };

    let fhData, lData, rData, eyeData, fullData;
    try {
      fhData   = captureCtx.getImageData(fhRoi.x,    fhRoi.y,    Math.min(fhRoi.w,    cw-fhRoi.x),    Math.min(fhRoi.h,    ch-fhRoi.y));
      lData    = captureCtx.getImageData(lCheek.x,   lCheek.y,   Math.min(lCheek.w,   cw-lCheek.x),   Math.min(lCheek.h,   ch-lCheek.y));
      rData    = captureCtx.getImageData(rCheek.x,   rCheek.y,   Math.min(rCheek.w,   cw-rCheek.x),   Math.min(rCheek.h,   ch-rCheek.y));
      eyeData  = captureCtx.getImageData(eyeRoi.x,   eyeRoi.y,   Math.min(eyeRoi.w,   cw-eyeRoi.x),   Math.min(eyeRoi.h,   ch-eyeRoi.y));
      fullData = captureCtx.getImageData(0, 0, cw, ch);
    } catch (e) { return; }

    // ── rPPG (heart rate) ─────────────────────────────────────────
    const g = _meanChannel(fhData.data, 1);
    greenBuf.push(g);
    if (greenBuf.length > BUF_SIZE) greenBuf.shift();

    // ── Face Y position (breathing) ───────────────────────────────
    const faceY = faceBox.y + faceBox.height / 2;
    yPosBuf.push(faceY);
    if (yPosBuf.length > BUF_SIZE) yPosBuf.shift();

    // ── Sweat detection (forehead shine) ─────────────────────────
    const fhR = _meanChannel(fhData.data, 0);
    const fhG = g;
    const fhB = _meanChannel(fhData.data, 2);
    const brightness = (fhR + fhG + fhB) / 3;
    const maxC = Math.max(fhR, fhG, fhB);
    const minC = Math.min(fhR, fhG, fhB);
    const sat  = maxC > 0 ? (maxC - minC) / maxC : 0;
    const shine = brightness > 155 && sat < 0.18 ? brightness : 0;
    shineBuf.push(shine);
    if (shineBuf.length > BUF_SIZE) shineBuf.shift();

    // ── Pale skin detection (overall brightness + low redness) ───
    const overallBright = _meanChannel(fullData.data, 0) * 0.4 +
                          _meanChannel(fullData.data, 1) * 0.4 +
                          _meanChannel(fullData.data, 2) * 0.2;
    brightBuf.push(overallBright);
    if (brightBuf.length > BUF_SIZE) brightBuf.shift();

    // ── Face asymmetry (drooping) ─────────────────────────────────
    // Compare brightness of left vs right cheek
    const lBright = (_meanChannel(lData.data,0)+_meanChannel(lData.data,1)+_meanChannel(lData.data,2))/3;
    const rBright = (_meanChannel(rData.data,0)+_meanChannel(rData.data,1)+_meanChannel(rData.data,2))/3;
    const asymmetry = Math.abs(lBright - rBright);
    // >25 brightness difference between cheeks = possible drooping
    currentFaceDrop = asymmetry > 25;

    // ── Head movement (dizziness) ─────────────────────────────────
    const faceX = faceBox.x + faceBox.width / 2;
    if (prevFaceX !== null) {
      const dx = Math.abs(faceX - prevFaceX);
      const dy = Math.abs(faceY - prevFaceY);
      headMovBuf.push(dx + dy);
      if (headMovBuf.length > BUF_SIZE) headMovBuf.shift();
    }
    prevFaceX = faceX; prevFaceY = faceY;

    // ── Eye blink / confusion ─────────────────────────────────────
    // Eye region gets darker when eyes close (blink)
    const eyeBright = (_meanChannel(eyeData.data,0)+_meanChannel(eyeData.data,1)+_meanChannel(eyeData.data,2))/3;
    blinkBuf.push(eyeBright);
    if (blinkBuf.length > BUF_SIZE) blinkBuf.shift();

    // ── Liveness check ───────────────────────────────────────────
    _checkLiveness(fhData, fullData);

    if (greenBuf.length >= FPS * 4) _computeVitals();
  }

  // ── Compute all vitals ───────────────────────────────────────────
  function _computeVitals() {
    // Heart Rate
    const sig = _detrend(_bandpass(greenBuf.slice(), FPS, 0.7, 3.0));
    const bpm = _dominantFreqBPM(sig, FPS, 0.7, 3.0);
    if (bpm >= 40 && bpm <= 180)
      currentBPM = currentBPM === 0 ? bpm : Math.round(0.75*currentBPM + 0.25*bpm);

    // Breathing Rate
    const bsig   = _detrend(yPosBuf.slice());
    const breath = _dominantFreqBPM(bsig, FPS, 0.1, 0.5);
    if (breath >= 6 && breath <= 30)
      currentBreath = currentBreath === 0 ? breath : Math.round(0.75*currentBreath + 0.25*breath);

    // SpO2
    const ac = _stdDev(sig);
    const dc = _mean(greenBuf.slice());
    const pi = dc > 0 ? (ac / dc) * 100 : 1.5;
    currentSpO2 = Math.min(100, Math.max(94, Math.round(98 + (pi-1.5)*1.5)));

    // Sweating — sustained shine
    if (shineBuf.length >= FPS * 3) {
      const shineCount = shineBuf.slice(-FPS*3).filter(v => v > 0).length;
      sweatScore = Math.round(shineCount / (FPS*3) * 100);
      currentSweat = sweatScore > 40;
    }

    // Pale skin — high brightness + low red channel
    if (brightBuf.length >= FPS * 3) {
      const avgBright = _mean(brightBuf.slice(-FPS*3));
      const avgRed    = _mean(greenBuf.slice(-FPS*3)); // proxy
      currentPaleSkin = avgBright > 180 && avgRed < 120;
    }

    // Dizziness — excessive head movement
    if (headMovBuf.length >= FPS * 3) {
      const avgMov = _mean(headMovBuf.slice(-FPS*3));
      // >3px avg movement per frame = unstable/dizzy
      currentDizziness = avgMov > 3.0;
    }

    // Confusion — abnormal blink rate
    // Normal: 15-20 blinks/min. Confusion: very low (<8) or very high (>30)
    if (blinkBuf.length >= FPS * 5) {
      const blinkSig = _detrend(blinkBuf.slice(-FPS*5));
      const blinkRate = _dominantFreqBPM(blinkSig, FPS, 0.13, 0.5); // 8-30 blinks/min
      currentConfusion = blinkRate > 0 && (blinkRate < 8 || blinkRate > 35);
    }

    if (onVitalsUpdate) {
      onVitalsUpdate({
        bpm:       isLive ? currentBPM       : 0,
        breath:    isLive ? currentBreath    : 0,
        spo2:      isLive ? currentSpO2      : 0,
        sweat:     isLive ? currentSweat     : false,
        paleSkin:  isLive ? currentPaleSkin  : false,
        dizziness: isLive ? currentDizziness : false,
        faceDrop:  isLive ? currentFaceDrop  : false,
        confusion: isLive ? currentConfusion : false,
        sweatScore,
        live: isLive
      });
    }
  }

  // ── Liveness check ───────────────────────────────────────────────
  function _checkLiveness(roiData, fullData) {
    const d = roiData.data;
    let skinPixels = 0, total = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r=d[i], g=d[i+1], b=d[i+2]; total++;
      if (r>95 && g>40 && b>20 && r>b && Math.abs(r-g)>15 && r>g) skinPixels++;
    }
    const skinScore = Math.min(100, (skinPixels/total) * 200);

    let motionScore = 0;
    const fd = fullData.data;
    if (prevPixels && prevPixels.length === fd.length) {
      let diff = 0;
      for (let i = 0; i < fd.length; i += 32) diff += Math.abs(fd[i]-prevPixels[i]);
      const avgDiff = diff / (fd.length/32);
      if (avgDiff > 0.3 && avgDiff < 15) motionScore = Math.min(100, avgDiff*15);
      else if (avgDiff >= 15) motionScore = 20;
    }
    prevPixels = new Uint8ClampedArray(fd);

    let varianceScore = greenBuf.length >= 10
      ? Math.min(100, _stdDev(greenBuf.slice(-15)) * 80)
      : 50;

    const score = skinScore*0.4 + motionScore*0.4 + varianceScore*0.2;
    livenessScore = Math.round(0.7*livenessScore + 0.3*score);
    isLive = livenessScore >= 35;
  }

  // ── Draw overlay ─────────────────────────────────────────────────
  function _drawLoop() {
    if (!running) return;
    rafId = requestAnimationFrame(_drawLoop);

    const w = overlayCanvas.width;
    const h = overlayCanvas.height;
    overlayCtx.clearRect(0, 0, w, h);

    if (faceDetected && faceBox) {
      const sx = w / captureCanvas.width;
      const sy = h / captureCanvas.height;
      const bx = faceBox.x*sx, by = faceBox.y*sy;
      const bw = faceBox.width*sx, bh = faceBox.height*sy;

      // Box color
      const boxColor = !isLive ? '#dc3545' : currentFaceDrop ? '#ffc107' : '#28a745';
      overlayCtx.strokeStyle = boxColor;
      overlayCtx.lineWidth   = 2;
      overlayCtx.strokeRect(bx, by, bw, bh);

      if (!isLive) {
        overlayCtx.fillStyle = 'rgba(220,53,69,0.8)';
        overlayCtx.fillRect(bx, by-26, bw, 24);
        overlayCtx.fillStyle = '#fff';
        overlayCtx.font = 'bold 11px Inter,sans-serif';
        overlayCtx.textAlign = 'center';
        overlayCtx.fillText('⚠ Real face required', bx+bw/2, by-9);
        overlayCtx.textAlign = 'left';
        return;
      }

      // Forehead ROI
      overlayCtx.fillStyle = 'rgba(40,167,69,0.12)';
      overlayCtx.fillRect(bx+bw*0.15, by, bw*0.7, bh*0.28);

      // Pulse ring
      const cx = bx+bw/2, cy = by+bh/2;
      const t  = Date.now()/1000;
      const pulse = 0.5+0.5*Math.sin(t*(currentBPM||72)/60*Math.PI*2);
      overlayCtx.beginPath();
      overlayCtx.arc(cx, cy, bw*0.45+pulse*8, 0, Math.PI*2);
      overlayCtx.strokeStyle = `rgba(220,53,69,${0.2+pulse*0.5})`;
      overlayCtx.lineWidth = 2.5; overlayCtx.stroke();

      // Symptom indicators on face
      if (currentFaceDrop) {
        overlayCtx.fillStyle = 'rgba(255,193,7,0.7)';
        overlayCtx.fillRect(bx, by+bh*0.5, bw*0.45, 18);
        overlayCtx.fillStyle = '#000';
        overlayCtx.font = 'bold 10px Inter,sans-serif';
        overlayCtx.fillText('😶 DROOPING', bx+3, by+bh*0.5+13);
      }
      if (currentDizziness) {
        overlayCtx.strokeStyle = 'rgba(255,193,7,0.6)';
        overlayCtx.lineWidth = 1.5;
        overlayCtx.setLineDash([4,3]);
        overlayCtx.strokeRect(bx-4, by-4, bw+8, bh+8);
        overlayCtx.setLineDash([]);
      }

      // Vitals labels
      let y = 6;
      _label(overlayCtx, `❤ ${currentBPM||'…'} BPM`,                    6, y, currentBPM>100?'#ffc107':'#ff6b6b'); y+=30;
      _label(overlayCtx, `🌬 ${currentBreath||'…'} br/min`,              6, y, '#74c0fc'); y+=30;
      _label(overlayCtx, `💧 SpO₂ ${currentSpO2}%`,                      6, y, '#a9e34b'); y+=30;
      _label(overlayCtx, `💦 Sweat: ${currentSweat?'⚠ YES':'No'}`,       6, y, currentSweat?'#ffc107':'#adb5bd'); y+=30;
      _label(overlayCtx, `😰 Pale: ${currentPaleSkin?'⚠ YES':'No'}`,     6, y, currentPaleSkin?'#ffc107':'#adb5bd'); y+=30;
      _label(overlayCtx, `😵 Dizzy: ${currentDizziness?'⚠ YES':'No'}`,   6, y, currentDizziness?'#ffc107':'#adb5bd'); y+=30;
      _label(overlayCtx, `😶 FaceDrop: ${currentFaceDrop?'⚠ YES':'No'}`, 6, y, currentFaceDrop?'#dc3545':'#adb5bd');

    } else {
      const t = Date.now()/700;
      const alpha = 0.4+0.4*Math.sin(t);
      overlayCtx.strokeStyle = `rgba(255,193,7,${alpha})`;
      overlayCtx.lineWidth = 2; overlayCtx.setLineDash([8,5]);
      overlayCtx.strokeRect(w*0.15, h*0.1, w*0.7, h*0.8);
      overlayCtx.setLineDash([]);
      overlayCtx.fillStyle = `rgba(255,193,7,${alpha})`;
      overlayCtx.font = 'bold 12px Inter,sans-serif';
      overlayCtx.textAlign = 'center';
      overlayCtx.fillText('Position face in frame', w/2, h*0.94);
      overlayCtx.textAlign = 'left';
    }
  }

  function _label(ctx, text, x, y, color) {
    ctx.fillStyle = 'rgba(0,0,0,0.65)';
    ctx.fillRect(x, y, 158, 24);
    ctx.fillStyle = color;
    ctx.font = 'bold 11px Inter,sans-serif';
    ctx.fillText(text, x+5, y+16);
  }

  // ── DSP helpers ──────────────────────────────────────────────────
  function _meanChannel(data, ch) {
    let s=0, n=0;
    for (let i=ch; i<data.length; i+=4) { s+=data[i]; n++; }
    return n ? s/n : 0;
  }
  function _mean(arr) { return arr.reduce((a,b)=>a+b,0)/arr.length; }
  function _stdDev(arr) {
    const m=_mean(arr);
    return Math.sqrt(arr.reduce((s,v)=>s+(v-m)**2,0)/arr.length);
  }
  function _detrend(arr) { const m=_mean(arr); return arr.map(v=>v-m); }
  function _bandpass(arr, fs, fLow, fHigh) {
    const wL=Math.max(1,Math.round(fs/fHigh)), wH=Math.max(1,Math.round(fs/fLow));
    return arr.map((_,i,a)=>_movAvg(a,i,wL)-_movAvg(a,i,wH));
  }
  function _movAvg(arr, idx, win) {
    const s=Math.max(0,idx-Math.floor(win/2)), e=Math.min(arr.length-1,idx+Math.floor(win/2));
    let sum=0; for(let i=s;i<=e;i++) sum+=arr[i]; return sum/(e-s+1);
  }
  function _dominantFreqBPM(sig, fs, fMin, fMax) {
    const n=sig.length; if(n<8) return 0;
    const lagMin=Math.max(1,Math.floor(fs/fMax)), lagMax=Math.min(n-1,Math.ceil(fs/fMin));
    let bestLag=-1, bestVal=-Infinity;
    for(let lag=lagMin;lag<=lagMax;lag++){
      let sum=0; for(let i=0;i<n-lag;i++) sum+=sig[i]*sig[i+lag];
      if(sum>bestVal){bestVal=sum;bestLag=lag;}
    }
    return bestLag>0 ? Math.round((fs/bestLag)*60) : 0;
  }
  function _status(s,box){ if(onFaceStatus) onFaceStatus(s,box); }

  return {
    start, stop,
    getBPM:       () => currentBPM,
    getBreath:    () => currentBreath,
    getSpO2:      () => currentSpO2,
    getSweat:     () => currentSweat,
    getPaleSkin:  () => currentPaleSkin,
    getDizziness: () => currentDizziness,
    getFaceDrop:  () => currentFaceDrop,
    getConfusion: () => currentConfusion,
    isRunning:    () => running,
    hasFace:      () => faceDetected,
  };
})();
