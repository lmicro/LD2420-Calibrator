from __future__ import annotations

import argparse
import time

import serial


CMD_HEADER = b"\xFD\xFC\xFB\xFA"
CMD_TAIL = b"\x04\x03\x02\x01"

CMD_OPEN_CMD_MODE = 0x00FF
CMD_CLOSE_CMD_MODE = 0x00FE
CMD_SET_SYSTEM = 0x0012

MODE_RUN = 0x64


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


def monitor(ser: serial.Serial, verbose: bool):
    state = None
    line_buf = bytearray()
    print("Monitoring motion events. Ctrl-C to stop.")
    while True:
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
                    print("[MOTION] ON")
            elif upper == "OFF":
                if state != "OFF":
                    state = "OFF"
                    beep(2)
                    print("[MOTION] OFF")
            elif verbose and upper.startswith("RANGE "):
                print("[RANGE]", text.split(" ", 1)[1])


def build_parser():
    parser = argparse.ArgumentParser(description="Monitor LD2420 motion transitions from UART text output")
    parser.add_argument("--serial-port", default="/dev/ttyUSB0", help="Radar serial device")
    parser.add_argument("--baud", type=int, default=115200, help="Radar baudrate")
    parser.add_argument("--delay-ms", type=int, default=0, help="Pause before monitoring starts")
    parser.add_argument("--skip-config", action="store_true", help="Do not send run-mode config commands first")
    parser.add_argument("--verbose", action="store_true", help="Print UART lines and command responses")
    return parser


def main():
    args = build_parser().parse_args()
    ser = serial.Serial(args.serial_port, args.baud, timeout=0.1)
    try:
        if not args.skip_config:
            set_run_mode(ser, args.verbose)
        ser.reset_input_buffer()
        if args.delay_ms > 0:
            print(f"Waiting {args.delay_ms} ms before monitoring...")
            time.sleep(args.delay_ms / 1000.0)
        monitor(ser, args.verbose)
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        ser.close()


if __name__ == "__main__":
    main()
