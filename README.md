# LD2420-Calibrator

`LD2420-Calibrator` is a CPython/Linux toolkit for calibrating and testing the HI-Link LD2420 over UART.

It includes:

- a local web UI for configuration and threshold tuning
- a serial protocol driver for the LD2420
- a terminal motion monitor for verifying ON/OFF behavior

It keeps the same API and browser UI as the original ESP32 firmware:

- `POST /api/open`
- `POST /api/close`
- `GET /api/version`
- `POST /api/reboot`
- `POST /api/systemMode`
- `POST /api/readParams`
- `POST /api/setParams`
- `GET /api/energy`
- `GET /api/status`
- `POST /api/config`

The browser UI includes a dedicated threshold editor for all 16 trigger gates (`0x10..0x1F`) and 16 hold gates (`0x20..0x2F`) using the existing parameter endpoints.

Each gate covers about `0.7 m`, so Gate 1 is roughly `0.7 m .. 1.4 m`.

## Files

- `server.py`
  - HTTP server and JSON API
- `ld2420.py`
  - CPython serial driver for the LD2420 protocol
- `monitor_motion.py`
  - terminal motion monitor with bell notifications
- `monitor_gate_power.py`
  - popup monitor for one gate's live energy statistics
- `requirements.txt`
  - Python dependency list
- `www/index.html`
- `www/app.js`
  - browser UI

## Required Package

The only required third-party package is:

- `pyserial`

Install it with:

```bash
python -m pip install pyserial
```

Or from the repo root:

```bash
python -m pip install -r requirements.txt
```

## Run

```bash
python server.py --serial-port /dev/ttyUSB0 --baud 115200 --port 8080
```

Then open:

```text
http://127.0.0.1:8080/
```

If your LD2420 uses a different baudrate, try `256000`.

## Features

- open and close command mode
- read firmware version
- reboot the module
- switch between `RUN`, `ENERGY`, and `DEBUG` system modes
- read and write LD2420 parameters
- load and edit all trigger and hold thresholds from the web UI
- view live energy output
- monitor motion state transitions from the UART text stream

## Threshold Editor

The `Gate Thresholds` section in the web UI lets you:

- load all 16 trigger thresholds
- load all 16 hold thresholds
- edit them in the official HLK calibrator `0..90` scale
- save them back to the module

The web UI converts between the HLK scale and the raw serial parameter values automatically:

- `hlk = round(10 * log10(raw))`
- `raw = round(10 ** (hlk / 10))`
- example: raw `1000000` is shown as HLK `60`

The dedicated threshold table uses that HLK scale for editing. The generic `Read/Set Parameters` section still exposes raw values directly for low-level access.

The `Energy Output` table also helps compare live activity against those settings:

- shows per-gate live energy on the HLK scale only
- shows per-gate `current`, `min`, `mean`, `median`, `mode`, and `max` live energy values
- shows the current trigger and hold thresholds on the same row on the HLK scale
- includes a reset button that clears the running energy statistics and starts recalculating them from new frames
- includes a delayed reset option so you can clear the stats, walk away, and only begin sampling after a countdown
- includes a stop/start control that freezes the displayed values until you resume live updates

These values are useful when choosing trigger and hold thresholds:

- `current` shows the gate's live level right now
- `min` shows the lowest observed background level
- `mean` shows the average level over the current sampling window
- `median` is often more stable than mean when there are spikes
- `mode` can help identify the most common steady-state level
- `max` shows peak excursions when a person moves through the gate

Practical tuning flow:

- reset or delay-reset the energy stats while the area is clear to establish a baseline
- use `min`, `median`, and `mode` as background references
- walk into the target gate and watch `current` and `max`
- set thresholds above the idle baseline but below the motion levels you want to detect

In practice, the move / trigger threshold is usually guided by stronger motion peaks, while the still / hold threshold is often guided by quieter sustained presence levels.

## Detection Distance Window

The web UI includes a dedicated `Detection Distance Window` section for:

- parameter `0x00` as the raw minimum distance value
- parameter `0x01` as the raw maximum distance value

These are the simplest controls in this repo for limiting very near detection such as ignoring Gate 0, though this repo keeps them as raw firmware values rather than converting them to gate numbers.

The gate helper does not conflict with the raw minimum and maximum distance values:

- it is only a convenience tool that fills the raw fields using the approximate `0.7 m` per gate spacing
- it does not write anything to the radar by itself
- `Save Distance Window` is the step that actually writes the current raw min/max values to the module
- if you already know the exact raw values you want, you can ignore the helper and enter them directly

## Motion Clear Delay

The web UI now includes a dedicated `Motion Clear Delay` control for parameter `0x04`.

- it loads the current raw value from `0x04`
- it lets you save a new raw value without using the generic parameter box
- the repo currently treats this as a firmware-specific raw delay value; the exact time units are not documented here

On this firmware, parameter reads can be unreliable in larger batches. The driver handles this with smaller batched requests and retries.

## Motion Test Script

There is also a terminal-based motion monitor:

```bash
python monitor_motion.py --serial-port /dev/ttyUSB0 --baud 115200 --delay-ms 1000
```

What it does:

- puts the module into `SystemMode RUN (0x64)` unless `--skip-config` is used
- waits for the requested delay
- monitors UART text output
- rings the terminal bell once on `ON`
- rings the terminal bell twice on `OFF`
- timestamps every motion-change and heartbeat line
- repeats the last known `ON` or `OFF` state every few seconds so you can tell the monitor is still alive
- can optionally show a large popup window with the current motion state
- when `RANGE ...` lines are available, shows an inferred gate number in the popup by mapping distance to 70 cm gates
- excludes gates whose trigger and hold thresholds both resolve to HLK `90`, treating those `90/90` gates as disabled for popup inference

Useful options:

- `--delay-ms 1000`
- `--heartbeat-secs 5`
- `--skip-config`
- `--popup`
- `--verbose`

## Gate Power Popup

There is also a dedicated popup monitor for one gate's live ENERGY readings:

```bash
python monitor_gate_power.py --serial-port /dev/ttyUSB0 --baud 115200 --gate 3
```

What it does:

- switches the module into `SystemMode ENERGY (0x04)` unless `--skip-config` is used
- opens a Tkinter popup for the selected gate
- converts the selected gate's live raw energy readings to the HLK `0..90` style scale using `10 * log10(raw)`
- updates the selected gate's `current`, `min`, `mean`, and `max` values as new frames arrive
- keeps the raw values visible in the popup footer for reference
- shows the current `presence` flag and `distance`

Useful options:

- `--gate 3`
- `--poll-ms 100`
- `--skip-config`
- `--restore-run`
- `--verbose`

## Debug Output

Serial debugging is controlled by `ENABLE_DEBUG` in `ld2420.py`.

- It is currently set to `True`
- When enabled, the bash console prints:
  - transmitted command frames
  - parsed command responses from the module
  - raw pending bytes only when a command times out
  - command timeouts

## Notes

- The serial device path is stored in `config.json` after you update it through `/api/config`.
- `config.json` is intentionally ignored by Git because it is machine-local.
- The server is meant to be launched directly from a bash prompt.
- This repository is prepared to live as a standalone GitHub project under the name `LD2420-Calibrator`.

## GitHub Push

If you want to publish this directory as its own repository:

1. Copy or move this `python/` directory to a separate checkout named `LD2420-Calibrator`.
2. Initialize Git in that directory if needed.
3. Create an empty GitHub repository named `LD2420-Calibrator` under your account.
4. Add the GitHub repo as `origin`.
5. Commit and push.

Example:

```bash
cp -r python ~/src/LD2420-Calibrator
cd ~/src/LD2420-Calibrator
git init
git add .
git commit -m "Initial import"
git branch -M main
git remote add origin git@github.com:YOUR_GITHUB_USERNAME/LD2420-Calibrator.git
git push -u origin main
```
