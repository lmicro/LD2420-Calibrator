async function jget(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(await r.text());
  return await r.json();
}

async function jpost(url, body = null) {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : null
  });
  if (!r.ok) throw new Error(await r.text());
  return await r.text();
}

async function post(url) {
  try {
    const t = await jpost(url);
    document.getElementById('cmdOut').textContent = t;
  } catch (e) {
    document.getElementById('cmdOut').textContent = 'Error: ' + e.message;
  }
}

async function loadStatus() {
  try {
    const s = await jget('/api/status');
    document.getElementById('status').textContent = JSON.stringify(s, null, 2);
    document.getElementById('serialPort').value = s.serialPort || '';
    document.getElementById('baud').value = s.baud || 115200;
  } catch (e) {
    document.getElementById('status').textContent = 'Status error: ' + e.message;
  }
}

async function saveConfig() {
  const serialPort = document.getElementById('serialPort').value;
  const baud = parseInt(document.getElementById('baud').value);
  try {
    await jpost('/api/config', { serialPort, baud });
    alert('Saved. Serial reopened.');
    loadStatus();
  } catch (e) {
    alert('Save failed: ' + e.message);
  }
}

async function getVersion() {
  try {
    const t = await (await fetch('/api/version')).text();
    document.getElementById('cmdOut').textContent = 'Version: ' + t;
  } catch (e) {
    document.getElementById('cmdOut').textContent = 'Error: ' + e.message;
  }
}

async function loadClearDelay() {
  const out = document.getElementById('delayOut');
  out.textContent = 'Loading...';
  try {
    const r = await fetch('/api/readParams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [0x04] })
    });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json();
    const value = j.values?.[0];
    document.getElementById('clearDelay').value = Number.isFinite(value) ? value : '';
    out.textContent = Number.isFinite(value) ? `Loaded delay (param 0x04): ${value}` : 'Delay value unavailable.';
  } catch (e) {
    out.textContent = 'Error: ' + e.message;
  }
}

async function loadDistanceWindow() {
  const out = document.getElementById('distanceOut');
  out.textContent = 'Loading...';
  try {
    const r = await fetch('/api/readParams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [0x00, 0x01] })
    });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json();
    const minValue = j.values?.[0];
    const maxValue = j.values?.[1];
    document.getElementById('minDistance').value = Number.isFinite(minValue) ? minValue : '';
    document.getElementById('maxDistance').value = Number.isFinite(maxValue) ? maxValue : '';
    out.textContent =
      Number.isFinite(minValue) && Number.isFinite(maxValue)
        ? `Loaded distance window: min=${minValue}, max=${maxValue}`
        : 'Distance window unavailable.';
  } catch (e) {
    out.textContent = 'Error: ' + e.message;
  }
}

async function saveDistanceWindow() {
  const out = document.getElementById('distanceOut');
  const minValue = parseInt(document.getElementById('minDistance').value, 10);
  const maxValue = parseInt(document.getElementById('maxDistance').value, 10);
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue) || minValue < 0 || maxValue < 0) {
    out.textContent = 'Error: min and max distance must be non-negative integers.';
    return;
  }
  out.textContent = 'Saving...';
  try {
    const t = await jpost('/api/setParams', {
      pairs: [
        { id: 0x00, value: minValue },
        { id: 0x01, value: maxValue }
      ]
    });
    out.textContent = `Saved distance window: min=${minValue}, max=${maxValue} (${t})`;
  } catch (e) {
    out.textContent = 'Error: ' + e.message;
  }
}

async function saveClearDelay() {
  const out = document.getElementById('delayOut');
  const value = parseInt(document.getElementById('clearDelay').value, 10);
  if (!Number.isFinite(value) || value < 0) {
    out.textContent = 'Error: delay must be a non-negative integer.';
    return;
  }
  out.textContent = 'Saving...';
  try {
    const t = await jpost('/api/setParams', { pairs: [{ id: 0x04, value }] });
    out.textContent = `Saved delay (param 0x04): ${value} (${t})`;
  } catch (e) {
    out.textContent = 'Error: ' + e.message;
  }
}

async function setMode(mode) {
  try {
    const t = await jpost('/api/systemMode', { mode });
    document.getElementById('cmdOut').textContent = 'SystemMode set: ' + t;
  } catch (e) {
    document.getElementById('cmdOut').textContent = 'Error: ' + e.message;
  }
}

function parseIds(str) {
  return str.split(',').map(s => s.trim()).filter(s => s.length).map(s => {
    if (s.startsWith('0x') || s.startsWith('0X')) return parseInt(s, 16);
    return parseInt(s, 10);
  });
}

async function doRead() {
  const s = document.getElementById('readIds').value;
  const ids = parseIds(s);
  try {
    const r = await fetch('/api/readParams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids })
    });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json();
    const values = j.values || [];
    let out = '';
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i], v = values[i];
      out += `0x${id.toString(16)} = ${v}\n`;
    }
    document.getElementById('paramOut').textContent = out;
  } catch (e) {
    document.getElementById('paramOut').textContent = 'Error: ' + e.message;
  }
}

async function doSet() {
  const s = document.getElementById('setPairs').value;
  const pairs = [];
  for (const token of s.split(',')) {
    const t = token.trim();
    if (!t) continue;
    const [k, v] = t.split('=');
    if (!k || v === undefined) continue;
    const id = k.trim().startsWith('0x') ? parseInt(k.trim(), 16) : parseInt(k.trim(), 10);
    const val = v.trim().startsWith('0x') ? parseInt(v.trim(), 16) : parseInt(v.trim(), 10);
    pairs.push({ id, value: val });
  }
  try {
    const t = await jpost('/api/setParams', { pairs });
    document.getElementById('paramOut').textContent = 'Set: ' + t;
  } catch (e) {
    document.getElementById('paramOut').textContent = 'Error: ' + e.message;
  }
}

function thresholdRawToHlk(raw) {
  // HLK tool scale is logarithmic: raw 1000000 becomes displayed value 60.
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.round(10 * Math.log10(raw));
}

function thresholdHlkToRaw(hlk) {
  // Inverse of the HLK display conversion: displayed value 60 becomes raw 1000000.
  if (!Number.isFinite(hlk) || hlk <= 0) return 0;
  return Math.round(10 ** (hlk / 10));
}

function clampThresholdHlk(value) {
  return Math.max(0, Math.min(90, value));
}

function currentThresholdsForGate(gate) {
  const triggerHlk = parseInt(document.getElementById('trigger' + gate).value, 10);
  const holdHlk = parseInt(document.getElementById('hold' + gate).value, 10);
  const triggerClamped = Number.isFinite(triggerHlk) ? clampThresholdHlk(triggerHlk) : null;
  const holdClamped = Number.isFinite(holdHlk) ? clampThresholdHlk(holdHlk) : null;
  return {
    triggerHlk: triggerClamped,
    holdHlk: holdClamped,
  };
}

const energyStats = Array.from({ length: 16 }, () => ({
  count: 0,
  total: 0,
  samples: [],
  freq: {},
  modeRaw: null,
  modeCount: 0,
  min: null,
  max: null,
}));
let energyStatsDelayUntil = 0;
let energySamplingPaused = false;

function updateEnergyStats(gate, rawValue) {
  const stats = energyStats[gate];
  stats.count += 1;
  stats.total += rawValue;
  stats.samples.push(rawValue);
  stats.freq[rawValue] = (stats.freq[rawValue] || 0) + 1;
  if (stats.freq[rawValue] > stats.modeCount) {
    stats.modeCount = stats.freq[rawValue];
    stats.modeRaw = rawValue;
  }
  if (stats.min === null || rawValue < stats.min) stats.min = rawValue;
  if (stats.max === null || rawValue > stats.max) stats.max = rawValue;
}

function resetEnergyStats(gate) {
  energyStats[gate] = {
    count: 0,
    total: 0,
    samples: [],
    freq: {},
    modeRaw: null,
    modeCount: 0,
    min: null,
    max: null,
  };
}

function medianRaw(samples) {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

function resetAllEnergyStats() {
  for (let i = 0; i < 16; i++) {
    resetEnergyStats(i);
    const currentCell = document.getElementById('energyCurrent' + i);
    if (currentCell) currentCell.textContent = '-';
    updateEnergyThresholdDisplay(i);
  }
  energyStatsDelayUntil = 0;
  const status = document.getElementById('energyDelayStatus');
  if (status) status.textContent = energySamplingPaused ? 'Energy statistics reset. Sampling is paused.' : 'Energy statistics reset. Sampling is active.';
}

function resetAllEnergyStatsWithDelay() {
  resetAllEnergyStats();
  const delaySecs = parseFloat(document.getElementById('energyDelaySecs').value);
  const status = document.getElementById('energyDelayStatus');
  if (!Number.isFinite(delaySecs) || delaySecs < 0) {
    if (status) status.textContent = 'Error: delay must be zero or greater.';
    return;
  }
  if (delaySecs > 0) {
    energyStatsDelayUntil = Date.now() + Math.round(delaySecs * 1000);
    if (status) status.textContent = `Energy statistics reset. Waiting ${delaySecs} seconds before sampling resumes.`;
  }
}

function setEnergySamplingPaused(paused) {
  energySamplingPaused = paused;
  const button = document.getElementById('energyPauseButton');
  const status = document.getElementById('energyDelayStatus');
  if (button) button.textContent = paused ? 'Start Updates' : 'Stop Updates';
  if (status && energyStatsDelayUntil === 0) {
    status.textContent = paused ? 'Sampling paused. Displayed values are frozen.' : 'Energy statistics are updating normally.';
  }
}

function toggleEnergySamplingPaused() {
  setEnergySamplingPaused(!energySamplingPaused);
}

function updateEnergyThresholdDisplay(gate) {
  const thresholds = currentThresholdsForGate(gate);
  const stats = energyStats[gate];

  const triggerCell = document.getElementById('energyTrigger' + gate);
  const holdCell = document.getElementById('energyHold' + gate);
  const minCell = document.getElementById('energyMin' + gate);
  const meanCell = document.getElementById('energyMean' + gate);
  const medianCell = document.getElementById('energyMedian' + gate);
  const modeCell = document.getElementById('energyMode' + gate);
  const maxCell = document.getElementById('energyMax' + gate);

  if (triggerCell) {
    triggerCell.textContent = thresholds.triggerHlk === null ? '-' : thresholds.triggerHlk;
  }
  if (holdCell) {
    holdCell.textContent = thresholds.holdHlk === null ? '-' : thresholds.holdHlk;
  }
  if (minCell) {
    minCell.textContent = stats.min === null ? '-' : thresholdRawToHlk(stats.min);
  }
  if (meanCell) {
    meanCell.textContent = stats.count === 0 ? '-' : thresholdRawToHlk(stats.total / stats.count);
  }
  if (medianCell) {
    const median = medianRaw(stats.samples);
    medianCell.textContent = median === null ? '-' : thresholdRawToHlk(median);
  }
  if (modeCell) {
    modeCell.textContent = stats.modeRaw === null ? '-' : thresholdRawToHlk(stats.modeRaw);
  }
  if (maxCell) {
    maxCell.textContent = stats.max === null ? '-' : thresholdRawToHlk(stats.max);
  }
}

function updateAllEnergyThresholdDisplays() {
  for (let i = 0; i < 16; i++) {
    updateEnergyThresholdDisplay(i);
  }
}

function ensureThresholdRows() {
  const tbody = document.getElementById('thresholdRows');
  if (tbody.childElementCount === 16) return;
  tbody.innerHTML = '';
  for (let i = 0; i < 16; i++) {
    const tr = document.createElement('tr');

    const gateCell = document.createElement('td');
    gateCell.textContent = i.toString();

    const triggerCell = document.createElement('td');
    const triggerInput = document.createElement('input');
    triggerInput.type = 'number';
    triggerInput.step = '1';
    triggerInput.min = '0';
    triggerInput.max = '90';
    triggerInput.id = 'trigger' + i;
    triggerInput.addEventListener('input', () => {
      const value = parseInt(triggerInput.value, 10);
      if (Number.isFinite(value)) triggerInput.value = clampThresholdHlk(value).toString();
      updateEnergyThresholdDisplay(i);
    });
    triggerCell.appendChild(triggerInput);

    const holdCell = document.createElement('td');
    const holdInput = document.createElement('input');
    holdInput.type = 'number';
    holdInput.step = '1';
    holdInput.min = '0';
    holdInput.max = '90';
    holdInput.id = 'hold' + i;
    holdInput.addEventListener('input', () => {
      const value = parseInt(holdInput.value, 10);
      if (Number.isFinite(value)) holdInput.value = clampThresholdHlk(value).toString();
      updateEnergyThresholdDisplay(i);
    });
    holdCell.appendChild(holdInput);

    const actionCell = document.createElement('td');
    const enableButton = document.createElement('button');
    enableButton.type = 'button';
    enableButton.textContent = 'Enable';
    enableButton.addEventListener('click', () => enableGate(i));
    actionCell.appendChild(enableButton);
    const disableButton = document.createElement('button');
    disableButton.type = 'button';
    disableButton.textContent = 'Disable';
    disableButton.addEventListener('click', () => disableGate(i));
    actionCell.appendChild(disableButton);
    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.textContent = 'Reset';
    resetButton.addEventListener('click', () => resetGateThresholds(i));
    actionCell.appendChild(resetButton);

    tr.appendChild(gateCell);
    tr.appendChild(triggerCell);
    tr.appendChild(holdCell);
    tr.appendChild(actionCell);
    tbody.appendChild(tr);
  }
}

function thresholdIds() {
  const ids = [];
  for (let i = 0; i < 16; i++) ids.push(0x10 + i);
  for (let i = 0; i < 16; i++) ids.push(0x20 + i);
  return ids;
}

function setGateThresholds(gate, triggerHlk, holdHlk) {
  document.getElementById('trigger' + gate).value = clampThresholdHlk(triggerHlk).toString();
  document.getElementById('hold' + gate).value = clampThresholdHlk(holdHlk).toString();
  updateEnergyThresholdDisplay(gate);
}

function disableGate(gate) {
  setGateThresholds(gate, 90, 90);
}

function enableGate(gate) {
  const current = currentThresholdsForGate(gate);
  setGateThresholds(
    gate,
    current.triggerHlk !== null && current.triggerHlk < 90 ? current.triggerHlk : 60,
    current.holdHlk !== null && current.holdHlk < 90 ? current.holdHlk : 60
  );
}

function resetGateThresholds(gate) {
  setGateThresholds(gate, 60, 60);
}

function applyThresholdRange() {
  const startGate = parseInt(document.getElementById('rangeStartGate').value, 10);
  const endGate = parseInt(document.getElementById('rangeEndGate').value, 10);
  const triggerValue = parseInt(document.getElementById('rangeTrigger').value, 10);
  const holdValue = parseInt(document.getElementById('rangeHold').value, 10);
  const out = document.getElementById('thresholdOut');
  if (!Number.isFinite(startGate) || !Number.isFinite(endGate) || startGate < 0 || endGate > 15 || startGate > endGate) {
    out.textContent = 'Error: choose a valid gate range between 0 and 15.';
    return;
  }
  if (!Number.isFinite(triggerValue) || !Number.isFinite(holdValue)) {
    out.textContent = 'Error: bulk apply needs both move and still threshold values.';
    return;
  }
  for (let gate = startGate; gate <= endGate; gate++) {
    setGateThresholds(gate, triggerValue, holdValue);
  }
  out.textContent = `Applied move=${clampThresholdHlk(triggerValue)} and still=${clampThresholdHlk(holdValue)} to gates ${startGate}-${endGate}. Save Thresholds to write it to the radar.`;
}

function disableGateRange() {
  const startGate = parseInt(document.getElementById('rangeStartGate').value, 10);
  const endGate = parseInt(document.getElementById('rangeEndGate').value, 10);
  const out = document.getElementById('thresholdOut');
  if (!Number.isFinite(startGate) || !Number.isFinite(endGate) || startGate < 0 || endGate > 15 || startGate > endGate) {
    out.textContent = 'Error: choose a valid gate range between 0 and 15.';
    return;
  }
  for (let gate = startGate; gate <= endGate; gate++) {
    disableGate(gate);
  }
  out.textContent = `Disabled gates ${startGate}-${endGate} by setting them to 90/90. Save Thresholds to write it to the radar.`;
}

function gateNumberToDistanceValue(gate) {
  return Math.round(gate * 0.7 * 100);
}

function setDistanceWindowFromGates() {
  const minGate = parseInt(document.getElementById('minGateHelper').value, 10);
  const maxGate = parseInt(document.getElementById('maxGateHelper').value, 10);
  const out = document.getElementById('distanceOut');
  if (!Number.isFinite(minGate) || !Number.isFinite(maxGate) || minGate < 0 || minGate > 15 || maxGate < 0 || maxGate > 16 || minGate > maxGate) {
    out.textContent = 'Error: choose helper gates in the range 0..15 for min and 0..16 for max.';
    return;
  }
  const minValue = gateNumberToDistanceValue(minGate);
  const maxValue = gateNumberToDistanceValue(maxGate);
  document.getElementById('minDistance').value = minValue.toString();
  document.getElementById('maxDistance').value = maxValue.toString();
  out.textContent = `Filled min/max distance from gate helper: gate ${minGate} -> ${minValue}, gate ${maxGate} -> ${maxValue}. Save Distance Window to write it to the radar.`;
}

function currentThresholdProfile() {
  const trigger = [];
  const hold = [];
  for (let i = 0; i < 16; i++) {
    trigger.push(parseInt(document.getElementById('trigger' + i).value, 10) || 0);
    hold.push(parseInt(document.getElementById('hold' + i).value, 10) || 0);
  }
  return { trigger, hold };
}

function thresholdProfileStorageKey(name) {
  return 'ld2420-threshold-profile:' + name;
}

function refreshProfileList() {
  const select = document.getElementById('profileSelect');
  if (!select) return;
  const current = select.value;
  const names = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('ld2420-threshold-profile:')) {
      names.push(key.slice('ld2420-threshold-profile:'.length));
    }
  }
  names.sort();
  select.innerHTML = '';
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = '-- Select Profile --';
  select.appendChild(placeholder);
  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  }
  if (names.includes(current)) select.value = current;
}

function saveThresholdProfile() {
  const name = document.getElementById('profileName').value.trim();
  const out = document.getElementById('thresholdOut');
  if (!name) {
    out.textContent = 'Error: enter a profile name before saving.';
    return;
  }
  localStorage.setItem(thresholdProfileStorageKey(name), JSON.stringify(currentThresholdProfile()));
  document.getElementById('profileName').value = '';
  refreshProfileList();
  document.getElementById('profileSelect').value = name;
  out.textContent = `Saved local threshold profile "${name}".`;
}

function loadThresholdProfile() {
  const name = document.getElementById('profileSelect').value;
  const out = document.getElementById('thresholdOut');
  if (!name) {
    out.textContent = 'Error: select a profile to load.';
    return;
  }
  const raw = localStorage.getItem(thresholdProfileStorageKey(name));
  if (!raw) {
    out.textContent = `Error: profile "${name}" was not found.`;
    refreshProfileList();
    return;
  }
  const profile = JSON.parse(raw);
  for (let i = 0; i < 16; i++) {
    setGateThresholds(i, profile.trigger?.[i] ?? 60, profile.hold?.[i] ?? 60);
  }
  out.textContent = `Loaded local threshold profile "${name}". Save Thresholds to write it to the radar.`;
}

function deleteThresholdProfile() {
  const name = document.getElementById('profileSelect').value;
  const out = document.getElementById('thresholdOut');
  if (!name) {
    out.textContent = 'Error: select a profile to delete.';
    return;
  }
  localStorage.removeItem(thresholdProfileStorageKey(name));
  refreshProfileList();
  out.textContent = `Deleted local threshold profile "${name}".`;
}

async function loadThresholds() {
  ensureThresholdRows();
  document.getElementById('thresholdOut').textContent = 'Loading...';
  try {
    const r = await fetch('/api/readParams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: thresholdIds() })
    });
    if (!r.ok) throw new Error(await r.text());
    const j = await r.json();
    const values = j.values || [];
    for (let i = 0; i < 16; i++) {
      const triggerValue = values[i];
      const holdValue = values[i + 16];
      document.getElementById('trigger' + i).value = Number.isFinite(triggerValue) ? thresholdRawToHlk(triggerValue) : '';
      document.getElementById('hold' + i).value = Number.isFinite(holdValue) ? thresholdRawToHlk(holdValue) : '';
    }
    updateAllEnergyThresholdDisplays();
    document.getElementById('thresholdOut').textContent =
      'Thresholds loaded. Displayed values are HLK scale 0-90.';
  } catch (e) {
    document.getElementById('thresholdOut').textContent = 'Error: ' + e.message;
  }
}

async function saveThresholds() {
  ensureThresholdRows();
  const pairs = [];
  for (let i = 0; i < 16; i++) {
    const triggerValue = parseInt(document.getElementById('trigger' + i).value, 10);
    const holdValue = parseInt(document.getElementById('hold' + i).value, 10);
    if (!Number.isFinite(triggerValue) || !Number.isFinite(holdValue)) {
      document.getElementById('thresholdOut').textContent = `Error: gate ${i} needs both threshold values.`;
      return;
    }
    const triggerHlk = clampThresholdHlk(triggerValue);
    const holdHlk = clampThresholdHlk(holdValue);
    document.getElementById('trigger' + i).value = triggerHlk.toString();
    document.getElementById('hold' + i).value = holdHlk.toString();
    pairs.push({ id: 0x10 + i, value: thresholdHlkToRaw(triggerHlk) });
    pairs.push({ id: 0x20 + i, value: thresholdHlkToRaw(holdHlk) });
  }
  updateAllEnergyThresholdDisplays();
  document.getElementById('thresholdOut').textContent = 'Saving...';
  try {
    const t = await jpost('/api/setParams', { pairs });
    document.getElementById('thresholdOut').textContent =
      'Thresholds saved using raw serial values derived from the HLK scale: ' + t;
  } catch (e) {
    document.getElementById('thresholdOut').textContent = 'Error: ' + e.message;
  }
}

async function pollEnergy() {
  try {
    const j = await jget('/api/energy');
    const delayStatus = document.getElementById('energyDelayStatus');
    const waitingForDelay = Date.now() < energyStatsDelayUntil;
    document.getElementById('presence').textContent = j.valid ? (j.presence ? 'Present' : 'None') : '-';
    document.getElementById('distance').textContent = j.valid ? j.distance : '-';
    if (delayStatus) {
      if (waitingForDelay) {
        const secondsLeft = Math.max(0, Math.ceil((energyStatsDelayUntil - Date.now()) / 1000));
        delayStatus.textContent = `Sampling delayed. ${secondsLeft}s remaining before energy statistics resume.`;
      } else if (energyStatsDelayUntil !== 0) {
        delayStatus.textContent = energySamplingPaused
          ? 'Sampling delay complete. Sampling is paused.'
          : 'Sampling delay complete. Energy statistics are updating.';
        energyStatsDelayUntil = 0;
      }
    }
    const tbody = document.getElementById('gates');
    if (tbody.childElementCount !== 16) {
      tbody.innerHTML = '';
      for (let i = 0; i < 16; i++) {
        const tr = document.createElement('tr');
        const td1 = document.createElement('td');
        td1.textContent = i.toString();
        const td2 = document.createElement('td');
        td2.id = 'energyCurrent' + i;
        td2.textContent = '-';
        const td3 = document.createElement('td');
        td3.id = 'energyMin' + i;
        td3.textContent = '-';
        const td4 = document.createElement('td');
        td4.id = 'energyMean' + i;
        td4.textContent = '-';
        const td5 = document.createElement('td');
        td5.id = 'energyMedian' + i;
        td5.textContent = '-';
        const td6 = document.createElement('td');
        td6.id = 'energyMode' + i;
        td6.textContent = '-';
        const td7 = document.createElement('td');
        td7.id = 'energyMax' + i;
        td7.textContent = '-';
        const td8 = document.createElement('td');
        td8.id = 'energyTrigger' + i;
        td8.textContent = '-';
        const td9 = document.createElement('td');
        td9.id = 'energyHold' + i;
        td9.textContent = '-';
        tr.appendChild(td1);
        tr.appendChild(td2);
        tr.appendChild(td3);
        tr.appendChild(td4);
        tr.appendChild(td5);
        tr.appendChild(td6);
        tr.appendChild(td7);
        tr.appendChild(td8);
        tr.appendChild(td9);
        tbody.appendChild(tr);
      }
    }
    if (j.valid && Array.isArray(j.energy)) {
      for (let i = 0; i < 16; i++) {
        const currentCell = document.getElementById('energyCurrent' + i);
        if (!energySamplingPaused && currentCell) currentCell.textContent = thresholdRawToHlk(j.energy[i]);
        if (!waitingForDelay && !energySamplingPaused) {
          updateEnergyStats(i, j.energy[i]);
        }
        updateEnergyThresholdDisplay(i);
      }
    } else {
      for (let i = 0; i < 16; i++) {
        const currentCell = document.getElementById('energyCurrent' + i);
        resetEnergyStats(i);
        if (currentCell) currentCell.textContent = '-';
        updateEnergyThresholdDisplay(i);
      }
    }
  } catch (e) {
  } finally {
    setTimeout(pollEnergy, 500);
  }
}

window.addEventListener('load', () => {
  ensureThresholdRows();
  loadDistanceWindow();
  loadClearDelay();
  loadThresholds();
  loadStatus();
  pollEnergy();
  refreshProfileList();
  setEnergySamplingPaused(false);
});
