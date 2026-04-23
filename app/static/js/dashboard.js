// ===== Dashboard — Real-Time Health Monitoring =====

let simulationInterval = null;
let isSimulating  = false;
let isCameraOn    = false;
let trendChart    = null;
let heartbeatChart= null;
let heartbeatData = [];
const maxDataPoints = 20;

// Camera vitals (updated by VITALS module)
let liveBpm    = 0;
let liveBreath = 0;
let liveSpO2   = 98;

document.addEventListener('DOMContentLoaded', () => {
  loadStats();
  initTrendChart();
  initHeartbeatChart();
});

// ===== Camera Toggle =====
async function toggleCamera() {
  if (isCameraOn) {
    stopCamera();
  } else {
    await startCamera();
  }
}

async function startCamera() {
  const btn = document.getElementById('toggleCamBtn');
  btn.innerHTML = '<i class="fas fa-spinner fa-spin me-1"></i>Starting…';
  btn.disabled = true;

  const video   = document.getElementById('camVideo');
  const overlay = document.getElementById('camOverlay');

  const ok = await VITALS.start(
    video,
    overlay,
    (v) => {
      liveBpm    = v.bpm    || liveBpm;
      liveBreath = v.breath || liveBreath;
      liveSpO2   = v.spo2   || liveSpO2;

      if (v.live === false) {
        ['vBpm','vBreath','vSpo2','vSweat'].forEach(id => {
          document.getElementById(id).textContent = id==='vBpm' ? '⚠ Spoof' : '—';
        });
        document.getElementById('mBpm').textContent    = '—';
        document.getElementById('mBreath').textContent = '—';
        return;
      }

      // Update vitals panel
      document.getElementById('vBpm').textContent    = liveBpm    || '…';
      document.getElementById('vBreath').textContent = liveBreath || '…';
      document.getElementById('vSpo2').textContent   = liveSpO2   || '…';
      document.getElementById('vSweat').textContent  = v.sweat    ? '⚠ YES' : 'No';
      document.getElementById('vSweat').className    = 'vital-val '+(v.sweat?'text-warning':'text-success');
      document.getElementById('mBpm').textContent    = liveBpm    || '—';
      document.getElementById('mBreath').textContent = liveBreath || '—';

      // Auto-check symptom boxes from camera detection
      if (v.sweat)     document.getElementById('sSweating').checked     = true;
      if (v.paleSkin)  document.getElementById('sPaleSkin').checked      = true;
      if (v.dizziness) document.getElementById('sDizziness').checked     = true;
      if (v.faceDrop)  document.getElementById('sFaceDrooping').checked  = true;
      if (v.confusion) document.getElementById('sConfusion').checked     = true;
      if (liveBpm > 100) document.getElementById('sRapidHeart').checked  = true;
      if (liveBreath > 25) document.getElementById('sNausea').checked    = true;

      pushHeartbeat(liveBpm);

      const bpmEl = document.getElementById('vBpm');
      bpmEl.className = 'vital-val '+(liveBpm>100?'text-danger':liveBpm<60?'text-warning':'text-success');

      if (isSimulating && liveBpm > 0) {
        clearTimeout(window._autoPredTimer);
        window._autoPredTimer = setTimeout(runPrediction, 3000);
      }
    },
    // onFaceStatus
    (status, box) => {
      const el = document.getElementById('camStatus');
      if (status === 'detected') {
        el.textContent = '● Face Detected';
        el.className   = 'cam-status detected';
      } else if (status === 'scanning') {
        el.textContent = '● Scanning…';
        el.className   = 'cam-status scanning';
      } else if (status === 'notSupported') {
        el.textContent = '● HTTPS Required';
        el.className   = 'cam-status error';
        document.getElementById('camHint').style.display = 'block';
      } else {
        el.textContent = '● Camera Error';
        el.className   = 'cam-status error';
      }
    }
  );

  if (ok) {
    isCameraOn = true;
    btn.innerHTML = '<i class="fas fa-video-slash me-1"></i>Stop Camera';
    btn.className = 'btn btn-warning btn-sm';
    btn.disabled  = false;
    document.getElementById('camStatus').textContent = '● Scanning…';
    document.getElementById('camStatus').className   = 'cam-status scanning';
  } else {
    btn.innerHTML = '<i class="fas fa-camera me-1"></i>Start Camera';
    btn.disabled  = false;
    document.getElementById('camStatus').textContent = '● Error';
    document.getElementById('camStatus').className   = 'cam-status error';
  }
}

function stopCamera() {
  VITALS.stop();
  isCameraOn = false;
  const btn = document.getElementById('toggleCamBtn');
  btn.innerHTML = '<i class="fas fa-camera me-1"></i>Start Camera';
  btn.className = 'btn btn-info btn-sm';
  document.getElementById('camStatus').textContent = '● Offline';
  document.getElementById('camStatus').className   = 'cam-status scanning';
  document.getElementById('vBpm').textContent    = '—';
  document.getElementById('vBreath').textContent = '—';
  document.getElementById('vSpo2').textContent   = '—';
  liveBpm = 0; liveBreath = 0;
}

// ===== Heartbeat Waveform =====
function initHeartbeatChart() {
  const ctx = document.getElementById('heartbeatChart');
  heartbeatChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: Array(40).fill(''),
      datasets: [{
        data: Array(40).fill(0),
        borderColor: '#dc3545',
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
        tension: 0.4,
      }]
    },
    options: {
      responsive: true,
      animation: false,
      plugins: { legend: { display: false } },
      scales: { x: { display: false }, y: { display: false } }
    }
  });
}

function pushHeartbeat(bpm) {
  // Simulate ECG-like spike based on BPM
  const t = Date.now() / 1000;
  const freq = (bpm || 72) / 60;
  const phase = (t * freq) % 1;
  // QRS spike shape
  let val = 0;
  if (phase < 0.05)       val = phase / 0.05;
  else if (phase < 0.1)   val = 1 - (phase - 0.05) / 0.05 * 2;
  else if (phase < 0.15)  val = -0.3 + (phase - 0.1) / 0.05 * 0.3;
  else                    val = 0;

  heartbeatData.push(val);
  if (heartbeatData.length > 40) heartbeatData.shift();

  heartbeatChart.data.datasets[0].data = [...heartbeatData];
  heartbeatChart.update('none');
}

// ===== Stats =====
async function loadStats() {
  try {
    const res  = await fetch('/api/stats');
    const data = await res.json();
    document.getElementById('statTotal').textContent  = data.total;
    document.getElementById('statLow').textContent    = data.low;
    document.getElementById('statMedium').textContent = data.medium;
    document.getElementById('statHigh').textContent   = data.high;
  } catch (err) { console.error('Stats error:', err); }
}

// ===== Trend Chart =====
function initTrendChart() {
  trendChart = new Chart(document.getElementById('trendChart'), {
    type: 'line',
    data: {
      labels: [],
      datasets: [{
        label: 'Risk %',
        data: [],
        borderColor: '#0d6efd',
        backgroundColor: 'rgba(13,110,253,0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 4,
        pointBackgroundColor: '#0d6efd',
      }]
    },
    options: {
      responsive: true,
      animation: { duration: 400 },
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 100, ticks: { callback: v => v + '%' } },
        x: { display: true }
      }
    }
  });
}

function updateTrendChart(timestamp, probability, riskLevel) {
  const color = riskLevel === 'HIGH' ? '#dc3545' : riskLevel === 'MEDIUM' ? '#ffc107' : '#28a745';
  trendChart.data.labels.push(new Date(timestamp).toLocaleTimeString());
  trendChart.data.datasets[0].data.push(probability);
  if (trendChart.data.labels.length > maxDataPoints) {
    trendChart.data.labels.shift();
    trendChart.data.datasets[0].data.shift();
  }
  trendChart.data.datasets[0].borderColor = color;
  trendChart.data.datasets[0].pointBackgroundColor = color;
  trendChart.update();
}

// ===== Risk Gauge =====
function drawGauge(probability, riskLevel) {
  const canvas = document.getElementById('riskGauge');
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const cx = w / 2, cy = h - 15, r = 100;

  ctx.clearRect(0, 0, w, h);

  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(200,200,200,0.2)';
  ctx.lineWidth = 22; ctx.stroke();

  const color = riskLevel === 'HIGH' ? '#dc3545' : riskLevel === 'MEDIUM' ? '#ffc107' : '#28a745';
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, Math.PI + (probability / 100) * Math.PI);
  ctx.strokeStyle = color; ctx.lineWidth = 22; ctx.lineCap = 'round'; ctx.stroke();

  ctx.fillStyle = '#212529'; ctx.font = 'bold 36px Inter'; ctx.textAlign = 'center';
  ctx.fillText(Math.round(probability) + '%', cx, cy - 25);
  ctx.font = '14px Inter'; ctx.fillStyle = color;
  ctx.fillText(riskLevel || '—', cx, cy - 5);
}

// ===== Update UI =====
function updateUI(data, result) {
  document.getElementById('mGlucose').textContent    = parseFloat(data.avg_glucose_level).toFixed(1);
  document.getElementById('mBmi').textContent        = parseFloat(data.bmi).toFixed(1);
  document.getElementById('mAge').textContent        = Math.round(data.age);
  document.getElementById('mHypertension').textContent = data.hypertension == 1 ? 'Yes' : 'No';

  // Only update BPM/breath from camera if camera is on
  if (!isCameraOn) {
    document.getElementById('mBpm').textContent    = '—';
    document.getElementById('mBreath').textContent = '—';
  }

  drawGauge(result.probability, result.risk_level);

  const badge = document.getElementById('riskBadge');
  badge.textContent = result.risk_level;
  badge.className   = 'risk-badge ' + result.risk_level;

  document.getElementById('lastUpdated').textContent = 'Updated: ' + new Date().toLocaleTimeString();

  const adviceList = document.getElementById('adviceList');
  adviceList.innerHTML = result.advice.map(a => `<li>${a}</li>`).join('');
  document.getElementById('adviceCard').style.display = 'block';

  updateTrendChart(result.timestamp, result.probability, result.risk_level);

  if (result.risk_level === 'HIGH') showHighRiskAlert(result.probability);

  loadStats();
}

// ===== HIGH RISK Modal =====
function showHighRiskAlert(probability) {
  const modal = new bootstrap.Modal(document.getElementById('highRiskModal'));
  document.getElementById('highRiskMsg').textContent =
    `Your stroke risk probability is ${probability.toFixed(1)}%. Please seek immediate medical attention.`;
  modal.show();
}

// ===== Simulation Toggle =====
function toggleSimulation() {
  isSimulating ? stopSimulation() : startSimulation();
}

async function startSimulation() {
  isSimulating = true;
  document.getElementById('toggleSimBtn').innerHTML = '<i class="fas fa-stop me-1"></i>Stop Monitor';
  document.getElementById('toggleSimBtn').classList.replace('btn-success', 'btn-danger');
  document.getElementById('liveIndicator').style.display = 'inline-block';

  await runPrediction();
  simulationInterval = setInterval(runPrediction, 3000);
}

function stopSimulation() {
  isSimulating = false;
  clearInterval(simulationInterval);
  document.getElementById('toggleSimBtn').innerHTML = '<i class="fas fa-play me-1"></i>Start Live Monitor';
  document.getElementById('toggleSimBtn').classList.replace('btn-danger', 'btn-success');
  document.getElementById('liveIndicator').style.display = 'none';
}

async function runPrediction() {
  try {
    let data;

    if (isCameraOn && liveBpm > 0 && VITALS.hasFace()) {
      const simRes = await fetch('/api/simulate');
      data = await simRes.json();
      data._bpm    = liveBpm;
      data._breath = liveBreath;
      data._spo2   = liveSpO2;
      // Only flag hypertension for severely high BPM (>120)
      if (liveBpm > 120) data.hypertension = 1;
    } else {
      // No camera — use simulation
      const simRes = await fetch('/api/simulate');
      data = await simRes.json();
    }

    const predRes = await fetch('/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await predRes.json();
    if (result.error) { console.error('Server error:', result.error); stopSimulation(); return; }
    updateUI(data, result);
  } catch (err) {
    console.error('Prediction error:', err);
    stopSimulation();
  }
}

// ===== Manual Form =====
async function submitManual() {
  const data = {
    age:               parseFloat(document.getElementById('fAge').value),
    gender:            document.getElementById('fGender').value,
    avg_glucose_level: parseFloat(document.getElementById('fGlucose').value),
    bmi:               parseFloat(document.getElementById('fBmi').value),
    hypertension:      parseInt(document.getElementById('fHypertension').value),
    heart_disease:     parseInt(document.getElementById('fHeartDisease').value),
    ever_married:      document.getElementById('fMarried').value,
    work_type:         document.getElementById('fWorkType').value,
    Residence_type:    'Urban',
    smoking_status:    document.getElementById('fSmoking').value,
    // Symptoms
    sym_face_drooping:    document.getElementById('sFaceDrooping').checked    ? 1 : 0,
    sym_arm_weakness:     document.getElementById('sArmWeakness').checked     ? 1 : 0,
    sym_speech_difficulty:document.getElementById('sSpeechDifficulty').checked? 1 : 0,
    sym_severe_headache:  document.getElementById('sSevereHeadache').checked  ? 1 : 0,
    sym_vision_blur:      document.getElementById('sVisionBlur').checked      ? 1 : 0,
    sym_dizziness:        document.getElementById('sDizziness').checked       ? 1 : 0,
    sym_numbness:         document.getElementById('sNumbness').checked        ? 1 : 0,
    sym_chest_pain:       document.getElementById('sChestPain').checked       ? 1 : 0,
    sym_confusion:        document.getElementById('sConfusion').checked       ? 1 : 0,
    sym_nausea:           document.getElementById('sNausea').checked          ? 1 : 0,
    sym_sweating:         document.getElementById('sSweating').checked        ? 1 : 0,
    sym_pale_skin:        document.getElementById('sPaleSkin').checked        ? 1 : 0,
    sym_rapid_heart:      document.getElementById('sRapidHeart').checked      ? 1 : 0,
  };

  if (isCameraOn && liveBpm > 0) {
    data._bpm    = liveBpm;
    data._breath = liveBreath;
    data._spo2   = liveSpO2;
    data._sweat  = VITALS.getSweat()    ? 1 : 0;
    data._pale   = VITALS.getPaleSkin() ? 1 : 0;
    data._dizzy  = VITALS.getDizziness()? 1 : 0;
    data._fdrop  = VITALS.getFaceDrop() ? 1 : 0;
    data._confus = VITALS.getConfusion()? 1 : 0;
    if (liveBpm > 120) data.hypertension = 1;
  }

  try {
    const res    = await fetch('/api/predict', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (result.error) { console.error('Server error:', result.error); return; }
    updateUI(data, result);
  } catch (err) { console.error('Manual prediction error:', err); }
}

function resetForm() {
  document.getElementById('fAge').value          = 45;
  document.getElementById('fGlucose').value      = 100;
  document.getElementById('fBmi').value          = 25;
  document.getElementById('fHypertension').value = 0;
  document.getElementById('fHeartDisease').value = 0;
  document.getElementById('fMarried').value      = 'Yes';
  document.getElementById('fWorkType').value     = 'Private';
  document.getElementById('fSmoking').value      = 'never smoked';
  ['sFaceDrooping','sArmWeakness','sSpeechDifficulty','sSevereHeadache',
   'sVisionBlur','sDizziness','sNumbness','sChestPain','sConfusion','sNausea',
   'sSweating','sPaleSkin','sRapidHeart'
  ].forEach(id => document.getElementById(id).checked = false);
}

function redirectHttps() {
  window.location.href = window.location.href.replace('http://', 'https://');
}
