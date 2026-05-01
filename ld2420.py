from __future__ import annotations

import threading
import time

try:
    import serial
except ImportError as exc:  # pragma: no cover
    raise RuntimeError(
        "pyserial is required for the Linux LD2420 port. Install it with: python -m pip install pyserial"
    ) from exc

ENABLE_DEBUG = True
PARAM_BATCH_SIZE = 12
PARAM_RETRIES = 3


class LD2420:
    CMD_HEADER = b"\xFD\xFC\xFB\xFA"
    CMD_TAIL = b"\x04\x03\x02\x01"

    ENG_HEADER = b"\xF4\xF3\xF2\xF1"
    ENG_TAIL = b"\xF8\xF7\xF6\xF5"
    ENG_DLEN = 0x0023

    DBG_HEADER = b"\xAA\xBF\x10\x14"
    DBG_POINTS = 20 * 16
    DBG_BYTES = DBG_POINTS * 4

    CMD_OPEN_CMD_MODE = 0x00FF
    CMD_CLOSE_CMD_MODE = 0x00FE
    CMD_READ_VERSION = 0x0000
    ALT_CMD_READ_VERSION = 0x0002
    CMD_REBOOT = 0x0068
    CMD_READ_PARAM = 0x0008
    CMD_SET_PARAM = 0x0007
    CMD_SET_SYSTEM = 0x0012

    def __init__(self, serial_port: str, baud: int = 115200, timeout: float = 0.05):
        self.serial_port = serial_port
        self.baud = int(baud)
        self.timeout = float(timeout)
        self.serial = serial.Serial(self.serial_port, self.baud, timeout=self.timeout)
        self.rxbuf = bytearray()
        self.max_buf = 4096
        self.command_lock = threading.Lock()
        self.state_lock = threading.Lock()
        self.last_resp = None
        self.last_energy = {
            "valid": False,
            "tsMs": 0,
            "presence": 0,
            "distance": 0,
            "energy": [0] * 16,
        }
        self._stop = threading.Event()
        self._reader = threading.Thread(target=self._reader_loop, name="ld2420-reader", daemon=True)
        self._reader.start()

    def _debug(self, message: str) -> None:
        if ENABLE_DEBUG:
            print(message, flush=True)

    @staticmethod
    def _hex(data: bytes | bytearray) -> str:
        return " ".join(f"{byte:02X}" for byte in data)

    @staticmethod
    def _u16le(value: int) -> bytes:
        return bytes((value & 0xFF, (value >> 8) & 0xFF))

    @staticmethod
    def _u32le(value: int) -> bytes:
        return bytes(
            (
                value & 0xFF,
                (value >> 8) & 0xFF,
                (value >> 16) & 0xFF,
                (value >> 24) & 0xFF,
            )
        )

    @staticmethod
    def _rd_u16le(buf: bytes | bytearray, offset: int) -> int:
        return buf[offset] | (buf[offset + 1] << 8)

    @staticmethod
    def _rd_u32le(buf: bytes | bytearray, offset: int) -> int:
        return (
            buf[offset]
            | (buf[offset + 1] << 8)
            | (buf[offset + 2] << 16)
            | (buf[offset + 3] << 24)
        )

    def close(self) -> None:
        self._stop.set()
        if self._reader.is_alive():
            self._reader.join(timeout=1.0)
        if self.serial.is_open:
            self.serial.close()

    def reconfigure(self, serial_port: str | None = None, baud: int | None = None) -> None:
        with self.command_lock:
            if serial_port is not None:
                self.serial_port = serial_port
            if baud is not None:
                self.baud = int(baud)
            was_open = self.serial.is_open
            if was_open:
                self.serial.close()
            self.serial.port = self.serial_port
            self.serial.baudrate = self.baud
            self.serial.timeout = self.timeout
            self.serial.open()
            self.rxbuf = bytearray()
            with self.state_lock:
                self.last_resp = None
                self.last_energy["valid"] = False

    def _build_command_packet(self, cmd: int, payload: bytes = b"") -> bytes:
        frame_len = 2 + len(payload)
        return self.CMD_HEADER + self._u16le(frame_len) + self._u16le(cmd) + payload + self.CMD_TAIL

    def _reader_loop(self) -> None:
        while not self._stop.is_set():
            if self.command_lock.locked():
                time.sleep(0.02)
                continue
            try:
                self.poll()
            except Exception:
                time.sleep(0.05)
            time.sleep(0.02)

    def _clear_input(self) -> None:
        self.rxbuf = bytearray()
        try:
            self.serial.reset_input_buffer()
        except Exception:
            pass
        with self.state_lock:
            self.last_resp = None

    def _read_uart(self) -> None:
        waiting = self.serial.in_waiting
        if waiting <= 0:
            return
        chunk = self.serial.read(waiting)
        if not chunk:
            return
        self.rxbuf.extend(chunk)
        if len(self.rxbuf) > self.max_buf:
            del self.rxbuf[: len(self.rxbuf) // 2]

    def poll(self) -> None:
        self._read_uart()
        buf = self.rxbuf
        i = 0

        while i + 4 <= len(buf):
            head = buf[i : i + 4]

            if head == self.CMD_HEADER:
                if i + 6 > len(buf):
                    break
                dlen = self._rd_u16le(buf, i + 4)
                total = 4 + 2 + dlen + 4
                if i + total > len(buf):
                    break
                if buf[i + 6 + dlen : i + total] == self.CMD_TAIL:
                    data = buf[i + 6 : i + 6 + dlen]
                    ret_cmd = self._rd_u16le(data, 0)
                    ret_code = 0xFFFF
                    payload = b""
                    if dlen >= 4:
                        ret_code = self._rd_u16le(data, 2)
                        payload = bytes(data[4:dlen])
                    elif dlen >= 2:
                        payload = bytes(data[2:dlen])
                    with self.state_lock:
                        self.last_resp = {
                            "retCmd": ret_cmd,
                            "retCode": ret_code,
                            "payload": payload,
                        }
                    self._debug(
                        "[LD2420 RX] cmd=0x%04X ret=0x%04X payload=%s raw=%s"
                        % (ret_cmd, ret_code, self._hex(payload), self._hex(buf[i : i + total]))
                    )
                    del buf[: i + total]
                    i = 0
                    continue
                i += 1
                continue

            if head == self.ENG_HEADER:
                if i + 6 > len(buf):
                    break
                dlen = self._rd_u16le(buf, i + 4)
                total = 4 + 2 + dlen + 4
                if i + total > len(buf):
                    break
                if dlen == self.ENG_DLEN and buf[i + 6 + dlen : i + total] == self.ENG_TAIL:
                    payload = buf[i + 6 : i + 6 + dlen]
                    energies = []
                    for gate in range(16):
                        energies.append(self._rd_u16le(payload, 3 + gate * 2))
                    with self.state_lock:
                        self.last_energy = {
                            "valid": True,
                            "tsMs": int(time.time() * 1000),
                            "presence": payload[0],
                            "distance": self._rd_u16le(payload, 1),
                            "energy": energies,
                        }
                    del buf[: i + total]
                    i = 0
                    continue
                i += 1
                continue

            if head == self.DBG_HEADER:
                total = 4 + self.DBG_BYTES + 4
                if i + total > len(buf):
                    break
                if buf[i + 4 + self.DBG_BYTES : i + total] == self.CMD_HEADER:
                    del buf[: i + total]
                    i = 0
                    continue
                i += 1
                continue

            i += 1

        if i:
            del buf[:i]

    def send_command_wait(self, cmd: int, payload: bytes = b"", timeout: float = 0.5):
        deadline = time.monotonic() + timeout
        expected_cmds = (cmd, (cmd | 0x0100) & 0xFFFF)
        with self.command_lock:
            self._clear_input()
            packet = self._build_command_packet(cmd, payload)
            self._debug(
                "[LD2420 TX] cmd=0x%04X payload=%s raw=%s"
                % (cmd, self._hex(payload), self._hex(packet))
            )
            self.serial.write(packet)
            self.serial.flush()
            while time.monotonic() < deadline:
                self.poll()
                with self.state_lock:
                    resp = self.last_resp
                if resp and resp["retCmd"] in expected_cmds:
                    return resp
                time.sleep(0.01)
            if self.rxbuf:
                preview = bytes(self.rxbuf[:128])
                self._debug(
                    "[LD2420 RAW] timeout pending-buffer=%s%s"
                    % (self._hex(preview), " ..." if len(self.rxbuf) > len(preview) else "")
                )
            self._debug("[LD2420 RX] timeout waiting for response to cmd=0x%04X" % cmd)
        return None

    def open_command_mode(self, host_ver: int = 0x0001) -> bool:
        versions = [host_ver]
        if host_ver != 0x0002:
            versions.append(0x0002)
        for version in versions:
            self._debug("[LD2420] trying open-command host version 0x%04X" % version)
            resp = self.send_command_wait(self.CMD_OPEN_CMD_MODE, self._u16le(version))
            if resp and resp["retCode"] == 0x0000:
                return True
        return False

    def close_command_mode(self) -> bool:
        resp = self.send_command_wait(self.CMD_CLOSE_CMD_MODE, b"")
        return bool(resp and resp["retCode"] in (0x0000, 0xFFFF))

    def read_version(self) -> str | None:
        for command in (self.CMD_READ_VERSION, self.ALT_CMD_READ_VERSION):
            resp = self.send_command_wait(command, b"")
            if not resp or resp["retCode"] != 0x0000:
                continue
            chars = []
            for value in resp["payload"]:
                if 0x20 <= value <= 0x7E:
                    chars.append(chr(value))
            version = "".join(chars)
            if version:
                return version
        return None

    def reboot(self) -> bool:
        resp = self.send_command_wait(self.CMD_REBOOT, b"")
        return bool(resp and resp["retCode"] in (0x0000, 0xFFFF))

    def set_system_mode(self, mode: int) -> bool:
        payload = self._u16le(0x0000) + self._u32le(mode)
        resp = self.send_command_wait(self.CMD_SET_SYSTEM, payload)
        if resp:
            return resp["retCode"] == 0x0000
        self._debug("[LD2420] no ack for set_system_mode; assuming firmware applied mode change")
        return True

    def read_params(self, ids: list[int]) -> list[int] | None:
        if not ids:
            return None
        values = []
        for start in range(0, len(ids), PARAM_BATCH_SIZE):
            batch = ids[start : start + PARAM_BATCH_SIZE]
            batch_values = None
            for _ in range(PARAM_RETRIES):
                payload = bytearray()
                for param_id in batch:
                    payload.extend(self._u16le(int(param_id)))
                resp = self.send_command_wait(self.CMD_READ_PARAM, bytes(payload), timeout=1.5)
                if not resp or resp["retCode"] != 0x0000:
                    time.sleep(0.1)
                    continue
                data = resp["payload"]
                expected = len(batch) * 4
                if len(data) < expected:
                    time.sleep(0.1)
                    continue
                batch_values = []
                for idx in range(len(batch)):
                    batch_values.append(self._rd_u32le(data, idx * 4))
                break
            if batch_values is None:
                return None
            values.extend(batch_values)
        return values

    def set_params(self, pairs: list[tuple[int, int]]) -> bool:
        if not pairs:
            return False
        for start in range(0, len(pairs), PARAM_BATCH_SIZE):
            batch = pairs[start : start + PARAM_BATCH_SIZE]
            ok = False
            for _ in range(PARAM_RETRIES):
                payload = bytearray()
                for param_id, value in batch:
                    payload.extend(self._u16le(int(param_id)))
                    payload.extend(self._u32le(int(value)))
                resp = self.send_command_wait(self.CMD_SET_PARAM, bytes(payload), timeout=1.5)
                if resp and resp["retCode"] == 0x0000:
                    ok = True
                    break
                time.sleep(0.1)
            if not ok:
                return False
        return True

    def energy_snapshot(self) -> dict:
        with self.state_lock:
            snapshot = self.last_energy
            return {
                "valid": snapshot["valid"],
                "tsMs": snapshot["tsMs"],
                "presence": snapshot["presence"],
                "distance": snapshot["distance"],
                "energy": list(snapshot["energy"]),
            }
