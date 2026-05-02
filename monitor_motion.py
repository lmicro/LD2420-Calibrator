from __future__ import annotations

import argparse
import math
import re
import time
from dataclasses import dataclass
from datetime import datetime

import serial


CMD_HEADER = b"\xFD\xFC\xFB\xFA"
CMD_TAIL = b"\x04\x03\x02\x01"

CMD_OPEN_CMD_MODE = 0x00FF
CMD_CLOSE_CMD_MODE = 0x00FE
CMD_SET_SYSTEM = 0x0012

MODE_RUN = 0x64
GATE_WIDTH_METERS = 0.7


def u16le(value: int) -> bytes:
    return bytes((value & 0xFF, (value >> 8) & 0xFF))


def u32le(value: int) -> bytes:
    return bytes(
        (
            value & 0xFF,
            (value >> 8) & 0xFF,
            (value >> 16) & 0xFF,
            (value >> 24) & 0xFF,
        )
    )


def build_packet(cmd: int, payload: bytes = b"") -> bytes:
    return CMD_HEADER + u16le(2 + len(payload)) + u16le(cmd) + payload + CMD_TAIL


def hex_bytes(data: bytes) -> str:
    return " ".join(f"{byte:02X}" for byte in data)


def send_command(ser: serial.Serial, cmd: int, payload: bytes = b"", timeout: float = 0.8):
    ser.reset_input_buffer()
    frame = build_packet(cmd, payload)
    ser.write(frame)
    ser.flush()
    end = time.monotonic() + timeout
    buf = bytearray()
    while time.monotonic() < end:
        waiting = ser.in_waiting
        if waiting:
            buf.extend(ser.read(waiting))
            if len(buf) >= 10 and buf[:4] == CMD_HEADER:
                dlen = buf[4] | (buf[5] << 8)
                total = 4 + 2 + dlen + 4
                if len(buf) >= total and buf[6 + dlen : total] == CMD_TAIL:
                    return bytes(buf[:total])
        time.sleep(0.01)
    return None


def set_run_mode(ser: serial.Serial, verbose: bool):
    open_resp = send_command(ser, CMD_OPEN_CMD_MODE, u16le(0x0001))
    if open_resp is None:
        open_resp = send_command(ser, CMD_OPEN_CMD_MODE, u16le(0x0002))
    if verbose:
        print("open response:", hex_bytes(open_resp) if open_resp else "<none>")

    payload = u16le(0x0000) + u32le(MODE_RUN)
    mode_resp = send_command(ser, CMD_SET_SYSTEM, payload)
    if verbose:
        print("set mode response:", hex_bytes(mode_resp) if mode_resp else "<none>")

    close_resp = send_command(ser, CMD_CLOSE_CMD_MODE, b"", timeout=0.4)
    if verbose:
        print("close response:", hex_bytes(close_resp) if close_resp else "<none>")


def beep(count: int):
    print("\a" * count, end="", flush=True)


def timestamp() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def print_state(state: str, heartbeat: bool = False):
    prefix = "[STATE]" if heartbeat else "[MOTION]"
    print(f"{timestamp()} {prefix} {state}")


def infer_gate_from_range_text(range_text: str):
    match = re.search(r"(-?\d+(?:\.\d+)?)\s*([a-zA-Z]*)", range_text)
    if not match:
        return None
    value = float(match.group(1))
    unit = match.group(2).lower()
    if unit in {"cm", "centimeter", "centimeters"}:
        meters = value / 100.0
    elif unit in {"mm", "millimeter", "millimeters"}:
        meters = value / 1000.0
    else:
        meters = value
    if meters < 0:
        return None
    gate = max(0, min(15, int(math.floor(meters / GATE_WIDTH_METERS))))
    return {"gate": gate, "meters": meters, "raw": range_text}


@dataclass
class PopupStatus:
    root: object
    label: object
    detail_label: object
    closed: bool = False

    @classmethod
    def create(cls):
        import tkinter as tk

        root = tk.Tk()
        root.title("LD2420 Motion")
        root.configure(bg="black")
        root.attributes("-topmost", True)

        screen_w = root.winfo_screenwidth()
        screen_h = root.winfo_screenheight()
        width = max(640, int(screen_w * 0.85))
        height = max(360, int(screen_h * 0.85))
        x = max(0, (screen_w - width) // 2)
        y = max(0, (screen_h - height) // 2)
        root.geometry(f"{width}x{height}+{x}+{y}")

        label = tk.Label(
            root,
            text="WAITING",
            font=("TkDefaultFont", max(64, int(height * 0.28)), "bold"),
            bg="black",
            fg="white",
        )
        label.pack(expand=True, fill="both", pady=(40, 10))
        detail_label = tk.Label(
            root,
            text="",
            font=("TkDefaultFont", max(18, int(height * 0.05))),
            bg="black",
            fg="white",
            justify="center",
        )
        detail_label.pack(fill="x", pady=(0, 40))
        popup = cls(root=root, label=label, detail_label=detail_label)
        root.protocol("WM_DELETE_WINDOW", popup.close)
        root.update_idletasks()
        root.update()
        return popup

    def set_state(self, state: str, detail: str = ""):
        if self.closed:
            return
        styles = {
            "ON": {"text": "ON", "bg": "#0d7a30", "fg": "white"},
            "OFF": {"text": "OFF", "bg": "#8b0000", "fg": "white"},
            "WAITING": {"text": "WAITING", "bg": "black", "fg": "white"},
        }
        style = styles[state]
        self.root.configure(bg=style["bg"])
        self.label.configure(**style)
        self.detail_label.configure(text=detail, bg=style["bg"], fg=style["fg"])
        self.refresh()

    def refresh(self):
        if self.closed:
            return
        try:
            self.root.update_idletasks()
            self.root.update()
        except Exception:
            self.closed = True

    def close(self):
        if self.closed:
            return
        self.closed = True
        self.root.destroy()


def monitor(
    ser: serial.Serial,
    verbose: bool,
    popup: PopupStatus | None = None,
    heartbeat_secs: float = 5.0,
):
    state = None
    line_buf = bytearray()
    last_state_report = time.monotonic()
    last_range_info = None
    print("Monitoring motion events. Ctrl-C to stop.")
    while True:
        if popup is not None:
            popup.refresh()
        now = time.monotonic()
        if state is not None and heartbeat_secs > 0 and now - last_state_report >= heartbeat_secs:
            print_state(state, heartbeat=True)
            last_state_report = now
        chunk = ser.read(ser.in_waiting or 1)
        if not chunk:
            continue
        line_buf.extend(chunk)
        while b"\n" in line_buf:
            line, _, remainder = line_buf.partition(b"\n")
            line_buf = bytearray(remainder)
            text = line.replace(b"\r", b"").decode(errors="ignore").strip()
            if not text:
                continue
            if verbose:
                print("uart:", text)
            upper = text.upper()
            if upper == "ON":
                if state != "ON":
                    state = "ON"
                    beep(1)
                    detail = ""
                    if last_range_info is not None:
                        detail = f"Inferred gate {last_range_info['gate']} from range {last_range_info['raw']}"
                    if popup is not None:
                        popup.set_state(state, detail=detail)
                    print_state(state)
                    if detail:
                        print(f"{timestamp()} [INFERRED] {detail}")
                    last_state_report = time.monotonic()
            elif upper == "OFF":
                if state != "OFF":
                    state = "OFF"
                    beep(2)
                    detail = ""
                    if last_range_info is not None:
                        detail = f"Last inferred gate {last_range_info['gate']} from range {last_range_info['raw']}"
                    if popup is not None:
                        popup.set_state(state, detail=detail)
                    print_state(state)
                    if detail:
                        print(f"{timestamp()} [INFERRED] {detail}")
                    last_state_report = time.monotonic()
            elif upper.startswith("RANGE "):
                range_text = text.split(" ", 1)[1]
                last_range_info = infer_gate_from_range_text(range_text)
                if verbose:
                    print("[RANGE]", range_text)
                    if last_range_info is not None:
                        print(
                            f"{timestamp()} [INFERRED] gate {last_range_info['gate']} from range {last_range_info['raw']}"
                        )


def build_parser():
    parser = argparse.ArgumentParser(description="Monitor LD2420 motion transitions from UART text output")
    parser.add_argument("--serial-port", default="/dev/ttyUSB0", help="Radar serial device")
    parser.add_argument("--baud", type=int, default=115200, help="Radar baudrate")
    parser.add_argument("--delay-ms", type=int, default=0, help="Pause before monitoring starts")
    parser.add_argument("--skip-config", action="store_true", help="Do not send run-mode config commands first")
    parser.add_argument("--popup", action="store_true", help="Show a large Tkinter popup with the current ON/OFF state")
    parser.add_argument(
        "--heartbeat-secs",
        type=float,
        default=5.0,
        help="Repeat the last known ON/OFF state every N seconds (0 disables heartbeats)",
    )
    parser.add_argument("--verbose", action="store_true", help="Print UART lines and command responses")
    return parser


def main():
    args = build_parser().parse_args()
    popup = PopupStatus.create() if args.popup else None
    ser = serial.Serial(args.serial_port, args.baud, timeout=0.1)
    try:
        if not args.skip_config:
            set_run_mode(ser, args.verbose)
        ser.reset_input_buffer()
        if args.delay_ms > 0:
            print(f"Waiting {args.delay_ms} ms before monitoring...")
            time.sleep(args.delay_ms / 1000.0)
        monitor(ser, args.verbose, popup=popup, heartbeat_secs=args.heartbeat_secs)
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        if popup is not None:
            popup.close()
        ser.close()


if __name__ == "__main__":
    main()
