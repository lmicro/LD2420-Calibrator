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

function formatSigned(value) {
  if (!Number.isFinite(value)) return '-';
  if (value > 0) return '+' + value;
  return value.toString();
}

function updateThresholdRawDisplay(kind, gate) {
  const input = document.getElementById(kind + gate);
  const rawOut = document.getElementById(kind + 'Raw' + gate);
  const hlkValue = parseInt(input.value, 10);
  if (!Number.isFinite(hlkValue)) {
    rawOut.textContent = 'raw: -';
    return;
  }
  const clamped = clampThresholdHlk(hlkValue);
  if (clamped !== hlkValue) {
    input.value = clamped.toString();
  }
  rawOut.textContent = `raw: ${thresholdHlkToRaw(clamped)}`;
}

function currentThresholdsForGate(gate) {
  const triggerHlk = parseInt(document.getElementById('trigger' + gate).value, 10);
  const holdHlk = parseInt(document.getElementById('hold' + gate).value, 10);
  const triggerClamped = Number.isFinite(triggerHlk) ? clampThresholdHlk(triggerHlk) : null;
  const holdClamped = Number.isFinite(holdHlk) ? clampThresholdHlk(holdHlk) : null;
  return {
    triggerHlk: triggerClamped,
    holdHlk: holdClamped,
    triggerRaw: triggerClamped === null ? null : thresholdHlkToRaw(triggerClamped),
    holdRaw: holdClamped === null ? null : thresholdHlkToRaw(holdClamped),
  };
}

function updateEnergyThresholdDisplay(gate) {
  const energyRawText = document.getElementById('energyRaw' + gate)?.textContent;
  const energyRaw = energyRawText === '-' ? null : parseInt(energyRawText, 10);
  const thresholds = currentThresholdsForGate(gate);

  const triggerCell = document.getElementById('energyTrigger' + gate);
  const holdCell = document.getElementById('energyHold' + gate);
  const triggerMarginCell = document.getElementById('energyTriggerMargin' + gate);
  const holdMarginCell = document.getElementById('energyHoldMargin' + gate);

  if (triggerCell) {
    triggerCell.textContent = thresholds.triggerHlk === null ? '-' : `${thresholds.triggerHlk} / ${thresholds.triggerRaw}`;
  }
  if (holdCell) {
    holdCell.textContent = thresholds.holdHlk === null ? '-' : `${thresholds.holdHlk} / ${thresholds.holdRaw}`;
  }
  if (triggerMarginCell) {
    triggerMarginCell.textContent =
      energyRaw === null || thresholds.triggerRaw === null ? '-' : formatSigned(energyRaw - thresholds.triggerRaw);
  }
  if (holdMarginCell) {
    holdMarginCell.textContent =
      energyRaw === null || thresholds.holdRaw === null ? '-' : formatSigned(energyRaw - thresholds.holdRaw);
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
      updateThresholdRawDisplay('trigger', i);
      updateEnergyThresholdDisplay(i);
    });
    triggerCell.appendChild(triggerInput);
    const triggerRaw = document.createElement('div');
    triggerRaw.id = 'triggerRaw' + i;
    triggerRaw.textContent = 'raw: -';
    triggerCell.appendChild(triggerRaw);

    const holdCell = document.createElement('td');
    const holdInput = document.createElement('input');
    holdInput.type = 'number';
    holdInput.step = '1';
    holdInput.min = '0';
    holdInput.max = '90';
    holdInput.id = 'hold' + i;
    holdInput.addEventListener('input', () => {
      updateThresholdRawDisplay('hold', i);
      updateEnergyThresholdDisplay(i);
    });
    holdCell.appendChild(holdInput);
    const holdRaw = document.createElement('div');
    holdRaw.id = 'holdRaw' + i;
    holdRaw.textContent = 'raw: -';
    holdCell.appendChild(holdRaw);

    tr.appendChild(gateCell);
    tr.appendChild(triggerCell);
    tr.appendChild(holdCell);
    tbody.appendChild(tr);
  }
}

function thresholdIds() {
  const ids = [];
  for (let i = 0; i < 16; i++) ids.push(0x10 + i);
  for (let i = 0; i < 16; i++) ids.push(0x20 + i);
  return ids;
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
      updateThresholdRawDisplay('trigger', i);
      updateThresholdRawDisplay('hold', i);
    }
    updateAllEnergyThresholdDisplays();
    document.getElementById('thresholdOut').textContent =
      'Thresholds loaded. Displayed values are HLK scale 0-90; raw serial values are shown below each field.';
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
    updateThresholdRawDisplay('trigger', i);
    updateThresholdRawDisplay('hold', i);
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
    document.getElementById('presence').textContent = j.valid ? (j.presence ? 'Present' : 'None') : '-';
    document.getElementById('distance').textContent = j.valid ? j.distance : '-';
    const tbody = document.getElementById('gates');
    if (tbody.childElementCount !== 16) {
      tbody.innerHTML = '';
      for (let i = 0; i < 16; i++) {
        const tr = document.createElement('tr');
        const td1 = document.createElement('td');
        td1.textContent = i.toString();
        const td2 = document.createElement('td');
        td2.id = 'energyRaw' + i;
        td2.textContent = '-';
        const td3 = document.createElement('td');
        td3.id = 'energyHlk' + i;
        td3.textContent = '-';
        const td4 = document.createElement('td');
        td4.id = 'energyTrigger' + i;
        td4.textContent = '-';
        const td5 = document.createElement('td');
        td5.id = 'energyHold' + i;
        td5.textContent = '-';
        const td6 = document.createElement('td');
        td6.id = 'energyTriggerMargin' + i;
        td6.textContent = '-';
        const td7 = document.createElement('td');
        td7.id = 'energyHoldMargin' + i;
        td7.textContent = '-';
        tr.appendChild(td1);
        tr.appendChild(td2);
        tr.appendChild(td3);
        tr.appendChild(td4);
        tr.appendChild(td5);
        tr.appendChild(td6);
        tr.appendChild(td7);
        tbody.appendChild(tr);
      }
    }
    if (j.valid && Array.isArray(j.energy)) {
      for (let i = 0; i < 16; i++) {
        const rawCell = document.getElementById('energyRaw' + i);
        const hlkCell = document.getElementById('energyHlk' + i);
        if (rawCell) rawCell.textContent = j.energy[i];
        if (hlkCell) hlkCell.textContent = thresholdRawToHlk(j.energy[i]);
        updateEnergyThresholdDisplay(i);
      }
    } else {
      for (let i = 0; i < 16; i++) {
        const rawCell = document.getElementById('energyRaw' + i);
        const hlkCell = document.getElementById('energyHlk' + i);
        if (rawCell) rawCell.textContent = '-';
        if (hlkCell) hlkCell.textContent = '-';
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
  loadClearDelay();
  loadThresholds();
  loadStatus();
  pollEnergy();
});
