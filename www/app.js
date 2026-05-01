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
    triggerInput.id = 'trigger' + i;
    triggerCell.appendChild(triggerInput);

    const holdCell = document.createElement('td');
    const holdInput = document.createElement('input');
    holdInput.type = 'number';
    holdInput.step = '1';
    holdInput.min = '0';
    holdInput.id = 'hold' + i;
    holdCell.appendChild(holdInput);

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
      document.getElementById('trigger' + i).value = values[i] ?? '';
      document.getElementById('hold' + i).value = values[i + 16] ?? '';
    }
    document.getElementById('thresholdOut').textContent = 'Thresholds loaded.';
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
    pairs.push({ id: 0x10 + i, value: triggerValue });
    pairs.push({ id: 0x20 + i, value: holdValue });
  }
  document.getElementById('thresholdOut').textContent = 'Saving...';
  try {
    const t = await jpost('/api/setParams', { pairs });
    document.getElementById('thresholdOut').textContent = 'Thresholds saved: ' + t;
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
        td2.id = 'e' + i;
        tr.appendChild(td1);
        tr.appendChild(td2);
        tbody.appendChild(tr);
      }
    }
    if (j.valid && Array.isArray(j.energy)) {
      for (let i = 0; i < 16; i++) {
        const td = document.getElementById('e' + i);
        if (td) td.textContent = j.energy[i];
      }
    }
  } catch (e) {
  } finally {
    setTimeout(pollEnergy, 500);
  }
}

window.addEventListener('load', () => {
  ensureThresholdRows();
  loadStatus();
  pollEnergy();
});
