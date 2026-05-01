from __future__ import annotations

import argparse
import atexit
import json
import mimetypes
import os
import socket
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from ld2420 import LD2420


BASE_DIR = Path(__file__).resolve().parent
DEFAULT_WEB_ROOT = BASE_DIR / "www"
DEFAULT_CONFIG_PATH = BASE_DIR / "config.json"
DEFAULT_CONFIG = {
    "serialPort": "/dev/ttyUSB0",
    "baud": 115200,
}


def parse_int(value):
    if isinstance(value, str):
        return int(value, 0)
    return int(value)


class App:
    def __init__(self, config_path: Path, web_root: Path, serial_port: str | None, baud: int | None):
        self.config_path = config_path
        self.web_root = web_root
        self.config = self._load_config()
        if serial_port:
            self.config["serialPort"] = serial_port
        if baud:
            self.config["baud"] = int(baud)
        self.radar = LD2420(self.config["serialPort"], self.config["baud"])
        atexit.register(self.radar.close)

    def _load_config(self):
        config = DEFAULT_CONFIG.copy()
        try:
            data = json.loads(self.config_path.read_text())
            if isinstance(data, dict):
                config.update(data)
        except FileNotFoundError:
            pass
        return config

    def save_config(self):
        self.config_path.write_text(json.dumps(self.config, indent=2) + "\n")

    def apply_config(self, payload):
        if "serialPort" in payload:
            self.config["serialPort"] = str(payload["serialPort"])
        if "baud" in payload:
            self.config["baud"] = int(payload["baud"])
        self.save_config()
        self.radar.reconfigure(self.config["serialPort"], self.config["baud"])

    def status(self):
        return {
            "serialPort": self.config["serialPort"],
            "baud": self.config["baud"],
            "ip": self._local_ip(),
            "wifiConnected": False,
            "rxPin": None,
            "txPin": None,
            "mdns": "",
        }

    @staticmethod
    def _local_ip():
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
        except OSError:
            return "127.0.0.1"
        finally:
            sock.close()


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "LD2420Linux/1.0"

    @property
    def app(self) -> App:
        return self.server.app

    def log_message(self, fmt, *args):
        return

    def do_GET(self):
        if self.path == "/":
            self._send_file(self.app.web_root / "index.html")
            return
        if self.path == "/app.js":
            self._send_file(self.app.web_root / "app.js")
            return
        if self.path == "/api/status":
            self._send_json(HTTPStatus.OK, self.app.status())
            return
        if self.path == "/api/version":
            self.app.radar.open_command_mode()
            version = self.app.radar.read_version()
            self.app.radar.close_command_mode()
            self._send_text(HTTPStatus.OK if version else HTTPStatus.INTERNAL_SERVER_ERROR, version or "FAIL")
            return
        if self.path == "/api/energy":
            self._send_json(HTTPStatus.OK, self.app.radar.energy_snapshot())
            return
        self._send_text(HTTPStatus.NOT_FOUND, "Not found")

    def do_POST(self):
        if self.path in {"/api/open", "/api/close", "/api/reboot"}:
            if self.path == "/api/open":
                ok = self.app.radar.open_command_mode()
            elif self.path == "/api/close":
                ok = self.app.radar.close_command_mode()
            else:
                self.app.radar.open_command_mode()
                ok = self.app.radar.reboot()
            self._send_text(HTTPStatus.OK if ok else HTTPStatus.INTERNAL_SERVER_ERROR, "OK" if ok else "FAIL")
            return

        try:
            payload = self._read_json()
        except ValueError:
            self._send_text(HTTPStatus.BAD_REQUEST, "bad json")
            return

        if self.path == "/api/config":
            try:
                self.app.apply_config(payload)
            except Exception as exc:
                self._send_text(HTTPStatus.BAD_REQUEST, str(exc))
                return
            self._send_text(HTTPStatus.OK, "OK")
            return

        if self.path == "/api/systemMode":
            mode = int(payload.get("mode", 0x64))
            ok = self.app.radar.open_command_mode() and self.app.radar.set_system_mode(mode)
            if ok:
                self.app.radar.close_command_mode()
            self._send_text(HTTPStatus.OK if ok else HTTPStatus.INTERNAL_SERVER_ERROR, "OK" if ok else "FAIL")
            return

        if self.path == "/api/readParams":
            ids = payload.get("ids")
            if not isinstance(ids, list):
                self._send_text(HTTPStatus.BAD_REQUEST, "need ids")
                return
            parsed = [parse_int(value) for value in ids]
            self.app.radar.open_command_mode()
            values = self.app.radar.read_params(parsed)
            self.app.radar.close_command_mode()
            if values is None:
                self._send_text(HTTPStatus.INTERNAL_SERVER_ERROR, "FAIL")
                return
            self._send_json(HTTPStatus.OK, {"values": values})
            return

        if self.path == "/api/setParams":
            pairs = payload.get("pairs")
            if not isinstance(pairs, list):
                self._send_text(HTTPStatus.BAD_REQUEST, "need pairs")
                return
            parsed = [(parse_int(item["id"]), parse_int(item["value"])) for item in pairs]
            self.app.radar.open_command_mode()
            ok = self.app.radar.set_params(parsed)
            self.app.radar.close_command_mode()
            self._send_text(HTTPStatus.OK if ok else HTTPStatus.INTERNAL_SERVER_ERROR, "OK" if ok else "FAIL")
            return

        self._send_text(HTTPStatus.NOT_FOUND, "Not found")

    def _read_json(self):
        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw.decode())
        except Exception as exc:
            raise ValueError("bad json") from exc

    def _send_json(self, status: HTTPStatus, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_text(self, status: HTTPStatus, text: str):
        body = text.encode()
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_file(self, path: Path):
        if not path.exists() or not path.is_file():
            self._send_text(HTTPStatus.NOT_FOUND, "Not found")
            return
        body = path.read_bytes()
        content_type, _ = mimetypes.guess_type(str(path))
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type or "application/octet-stream")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class AppServer(ThreadingHTTPServer):
    def __init__(self, server_address, request_handler, app):
        super().__init__(server_address, request_handler)
        self.app = app


def build_parser():
    parser = argparse.ArgumentParser(description="LD2420 Linux web console")
    parser.add_argument("--host", default="0.0.0.0", help="HTTP bind host")
    parser.add_argument("--port", type=int, default=8080, help="HTTP bind port")
    parser.add_argument("--serial-port", help="Radar serial device, e.g. /dev/ttyUSB0")
    parser.add_argument("--baud", type=int, help="Radar baudrate")
    parser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH), help="Path to JSON config file")
    parser.add_argument("--web-root", default=str(DEFAULT_WEB_ROOT), help="Static web directory")
    return parser


def main():
    args = build_parser().parse_args()
    app = App(Path(args.config), Path(args.web_root), args.serial_port, args.baud)
    server = AppServer((args.host, args.port), RequestHandler, app)
    print("LD2420 Linux gateway ready at http://%s:%d/" % (args.host, args.port))
    print("Using serial port %s at %d baud" % (app.config["serialPort"], app.config["baud"]))
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        app.radar.close()
        server.server_close()


if __name__ == "__main__":
    main()
