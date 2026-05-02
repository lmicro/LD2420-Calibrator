from __future__ import annotations

import argparse
import math
import time
from dataclasses import dataclass

import ld2420 as ld2420_module
from ld2420 import LD2420


MODE_RUN = 0x64
MODE_ENERGY = 0x04


def raw_to_hlk(raw: int | float | None) -> float | None:
    if raw is None or raw <= 0:
        return 0.0
    return 10.0 * math.log10(raw)


@dataclass
class RunningStats:
    count: int = 0
    total: int = 0
    current: int | None = None
    minimum: int | None = None
    maximum: int | None = None

    def update(self, value: int) -> None:
        self.count += 1
        self.total += value
        self.current = value
        if self.minimum is None or value < self.minimum:
            self.minimum = value
        if self.maximum is None or value > self.maximum:
            self.maximum = value

    @property
    def mean(self) -> float | None:
        if self.count == 0:
            return None
        return self.total / self.count


class GatePowerPopup:
    def __init__(self, gate: int):
        import tkinter as tk

        self.tk = tk
        self.root = tk.Tk()
        self.root.title(f"LD2420 Gate {gate} Power")
        self.root.configure(bg="#101820")
        self.root.attributes("-topmost", True)
        self.closed = False

        screen_w = self.root.winfo_screenwidth()
        screen_h = self.root.winfo_screenheight()
        width = max(700, int(screen_w * 0.7))
        height = max(480, int(screen_h * 0.7))
        x = max(0, (screen_w - width) // 2)
        y = max(0, (screen_h - height) // 2)
        self.root.geometry(f"{width}x{height}+{x}+{y}")

        header = tk.Label(
            self.root,
            text=f"Gate {gate} Power (HLK 0-90)",
            font=("TkDefaultFont", max(26, int(height * 0.055)), "bold"),
            bg="#101820",
            fg="#f6f1d1",
        )
        header.pack(pady=(24, 12))

        self.status = tk.Label(
            self.root,
            text="Waiting for ENERGY frames...",
            font=("TkDefaultFont", max(14, int(height * 0.03))),
            bg="#101820",
            fg="#9fb3c8",
        )
        self.status.pack(pady=(0, 18))

        self.value_labels = {}
        grid = tk.Frame(self.root, bg="#101820")
        grid.pack(expand=True)
        rows = [("Current", "current"), ("Min", "minimum"), ("Mean", "mean"), ("Max", "maximum")]
        for idx, (title, key) in enumerate(rows):
            title_label = tk.Label(
                grid,
                text=title,
                font=("TkDefaultFont", max(20, int(height * 0.04)), "bold"),
                bg="#101820",
                fg="#7dd3fc",
                anchor="e",
                width=10,
            )
            title_label.grid(row=idx, column=0, padx=(20, 12), pady=10, sticky="e")
            value_label = tk.Label(
                grid,
                text="-",
                font=("TkDefaultFont", max(28, int(height * 0.06)), "bold"),
                bg="#101820",
                fg="#ffffff",
                anchor="w",
                width=12,
            )
            value_label.grid(row=idx, column=1, padx=(12, 20), pady=10, sticky="w")
            self.value_labels[key] = value_label

        self.footer = tk.Label(
            self.root,
            text="",
            font=("TkDefaultFont", max(12, int(height * 0.025))),
            bg="#101820",
            fg="#9fb3c8",
        )
        self.footer.pack(pady=(12, 24))

        self.root.protocol("WM_DELETE_WINDOW", self.close)
        self.refresh()

    def refresh(self) -> None:
        if self.closed:
            return
        try:
            self.root.update_idletasks()
            self.root.update()
        except Exception:
            self.closed = True

    def set_waiting(self) -> None:
        self.status.configure(text="Waiting for ENERGY frames...", fg="#9fb3c8")
        for label in self.value_labels.values():
            label.configure(text="-")
        self.footer.configure(text="")
        self.refresh()

    def update_stats(self, stats: RunningStats, presence: int, distance: int, sample_count: int) -> None:
        mean = stats.mean
        self.status.configure(
            text=f"Streaming ENERGY mode. Samples: {sample_count}",
            fg="#86efac",
        )
        current_hlk = raw_to_hlk(stats.current)
        min_hlk = raw_to_hlk(stats.minimum)
        mean_hlk = raw_to_hlk(mean)
        max_hlk = raw_to_hlk(stats.maximum)
        self.value_labels["current"].configure(
            text=f"{current_hlk:.1f}" if current_hlk is not None else "-"
        )
        self.value_labels["minimum"].configure(text=f"{min_hlk:.1f}" if min_hlk is not None else "-")
        self.value_labels["mean"].configure(text=f"{mean_hlk:.1f}" if mean_hlk is not None else "-")
        self.value_labels["maximum"].configure(text=f"{max_hlk:.1f}" if max_hlk is not None else "-")
        self.footer.configure(
            text=(
                f"Raw current: {stats.current}    "
                f"Raw min/max: {stats.minimum}/{stats.maximum}    "
                f"Presence: {presence}    Distance: {distance}"
            )
        )
        self.refresh()

    def close(self) -> None:
        if self.closed:
            return
        self.closed = True
        self.root.destroy()


def configure_mode(radar: LD2420, mode: int) -> bool:
    return radar.open_command_mode() and radar.set_system_mode(mode) and radar.close_command_mode()


def build_parser():
    parser = argparse.ArgumentParser(description="Monitor one LD2420 gate energy level with a live popup")
    parser.add_argument("--serial-port", default="/dev/ttyUSB0", help="Radar serial device")
    parser.add_argument("--baud", type=int, default=115200, help="Radar baudrate")
    parser.add_argument("--gate", type=int, required=True, help="Gate number to monitor (0-15)")
    parser.add_argument("--poll-ms", type=int, default=100, help="Popup refresh interval in milliseconds")
    parser.add_argument("--skip-config", action="store_true", help="Do not switch to ENERGY mode automatically")
    parser.add_argument("--restore-run", action="store_true", help="Switch back to RUN mode when exiting")
    parser.add_argument("--verbose", action="store_true", help="Print LD2420 command debug output")
    return parser


def main():
    args = build_parser().parse_args()
    if not 0 <= args.gate <= 15:
        raise SystemExit("--gate must be between 0 and 15")

    ld2420_module.ENABLE_DEBUG = args.verbose
    popup = GatePowerPopup(args.gate)
    radar = LD2420(args.serial_port, args.baud)
    stats = RunningStats()
    last_ts = 0

    try:
        if not args.skip_config and not configure_mode(radar, MODE_ENERGY):
            raise RuntimeError("failed to switch radar into ENERGY mode")

        while not popup.closed:
            popup.refresh()
            snapshot = radar.energy_snapshot()
            if snapshot["valid"] and snapshot["tsMs"] != last_ts:
                last_ts = snapshot["tsMs"]
                value = snapshot["energy"][args.gate]
                stats.update(value)
                popup.update_stats(stats, snapshot["presence"], snapshot["distance"], stats.count)
            elif not snapshot["valid"] and stats.count == 0:
                popup.set_waiting()
            time.sleep(max(args.poll_ms, 10) / 1000.0)
    except KeyboardInterrupt:
        pass
    finally:
        if args.restore_run:
            try:
                configure_mode(radar, MODE_RUN)
            except Exception:
                pass
        radar.close()
        popup.close()


if __name__ == "__main__":
    main()
