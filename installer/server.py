#!/usr/bin/env python3
"""Localhost HTTP backend for the Opus/Sonnet orchestrator GUI installer.

Serves installer/gui.html and a JSON API that detects Claude Code state and
mutates config. Python 3 stdlib only. macOS.
"""
import json
import os
import shutil
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HOME = os.path.expanduser("~")
HERE = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(HERE)
GUI_PATH = os.path.join(HERE, "gui.html")
SETTINGS_PATH = os.path.join(HOME, ".claude", "settings.json")
CLAUDE_JSON_PATH = os.path.join(HOME, ".claude.json")

COMPONENTS = [
    ("adaptive-orchestrator", ".claude/skills/adaptive-orchestrator/SKILL.md"),
    ("no-subagents", ".claude/skills/no-subagents/SKILL.md"),
    ("haiku-reader", ".claude/agents/haiku-reader.md"),
    ("sonnet-worker", ".claude/agents/sonnet-worker.md"),
    ("sonnet-worker-lite", ".claude/agents/sonnet-worker-lite.md"),
]


def load_json(path):
    """Read JSON fresh. Returns (data, existed). Missing/empty -> ({}, False)."""
    if not os.path.exists(path):
        return {}, False
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    if not text.strip():
        return {}, False
    return json.loads(text), True


def save_json(path, data):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
        f.write("\n")


def node_version():
    node = shutil.which("node")
    if not node:
        return {"found": False, "version": None}
    try:
        out = subprocess.run(
            [node, "--version"], capture_output=True, text=True, timeout=10
        )
        return {"found": True, "version": out.stdout.strip() or None}
    except Exception:
        return {"found": True, "version": None}


def build_state():
    settings, _ = load_json(SETTINGS_PATH)
    claude, _ = load_json(CLAUDE_JSON_PATH)

    components = []
    for name, rel in COMPONENTS:
        p = os.path.join(HOME, rel)
        components.append({"name": name, "path": p, "found": os.path.exists(p)})

    enabled_plugins = settings.get("enabledPlugins", {}) or {}
    cost_hook = any(
        (k.startswith("orchestrator-budget@")) and v
        for k, v in enabled_plugins.items()
    )
    plugins = [{"id": k, "enabled": bool(v)} for k, v in enabled_plugins.items()]

    disabled = claude.get("disabledMcpServers", []) or []
    disabled_set = set(disabled)
    servers = claude.get("mcpServers", {}) or {}
    mcp_servers = [
        {"name": n, "disabled": n in disabled_set} for n in sorted(servers.keys())
    ]

    return {
        "components": components,
        "costHook": {"found": cost_hook},
        "bd": shutil.which("bd") is not None,
        "node": node_version(),
        "mcpServers": mcp_servers,
        "plugins": plugins,
        "defaultTarget": os.environ.get("PWD") or os.getcwd(),
    }


def toggle_mcp(body):
    name = body.get("name")
    disabled = bool(body.get("disabled"))
    if not name:
        return {"ok": False, "error": "missing name"}
    claude, existed = load_json(CLAUDE_JSON_PATH)
    if not existed:
        return {"ok": False, "error": "config not found"}
    arr = claude.get("disabledMcpServers", []) or []
    current = [s for s in arr if isinstance(s, str)]
    if disabled:
        if name not in current:
            current.append(name)
    else:
        current = [s for s in current if s != name]
    claude["disabledMcpServers"] = current
    save_json(CLAUDE_JSON_PATH, claude)
    return {"ok": True, "disabledMcpServers": current}


def toggle_plugin(body):
    plugin_id = body.get("id")
    enabled = bool(body.get("enabled"))
    if not plugin_id:
        return {"ok": False, "error": "missing id"}
    settings, existed = load_json(SETTINGS_PATH)
    if not existed:
        return {"ok": False, "error": "config not found"}
    plugins = settings.get("enabledPlugins")
    if not isinstance(plugins, dict):
        plugins = {}
    plugins[plugin_id] = enabled
    settings["enabledPlugins"] = plugins
    save_json(SETTINGS_PATH, settings)
    return {"ok": True}


def pick_folder():
    script = 'POSIX path of (choose folder with prompt "Select install target")'
    try:
        out = subprocess.run(
            ["osascript", "-e", script], capture_output=True, text=True, timeout=120
        )
    except Exception as e:
        return {"ok": False, "error": str(e)}
    if out.returncode != 0 or "User canceled" in (out.stderr or ""):
        return {"ok": False, "canceled": True}
    path = out.stdout.strip()
    if not path:
        return {"ok": False, "canceled": True}
    return {"ok": True, "path": path}


def run_install(body):
    target = body.get("target")
    checkpoints = body.get("checkpoints", "beads")
    components = body.get("components", []) or []
    cost_hook = bool(body.get("costHook"))
    is_global = bool(body.get("global"))
    if not target:
        return {"ok": False, "error": "missing target"}

    setup = os.path.join(REPO_ROOT, "setup.sh")
    argv = ["bash", setup, "--target", target, "--checkpoints", checkpoints]
    if is_global:
        argv.append("--global")

    env = dict(os.environ)
    env["GUI_COMPONENTS"] = ",".join(components)
    env["GUI_COST_HOOK"] = "1" if cost_hook else "0"
    env["GUI_NONINTERACTIVE"] = "1"

    try:
        out = subprocess.run(
            argv, capture_output=True, text=True, timeout=120, env=env, cwd=REPO_ROOT
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "log": "timeout"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    log = (out.stdout or "") + (out.stderr or "")
    return {"ok": out.returncode == 0, "code": out.returncode, "log": log}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _json(self, obj, code=200):
        payload = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self._cors()
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _read_body(self):
        length = int(self.headers.get("Content-Length") or 0)
        if not length:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8")) if raw else {}

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        if self.path == "/" or self.path.startswith("/?"):
            try:
                with open(GUI_PATH, "rb") as f:
                    body = f.read()
            except OSError:
                self._json({"ok": False, "error": "gui.html not found"}, 404)
                return
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self._cors()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if self.path == "/api/state":
            try:
                self._json(build_state())
            except Exception as e:
                self._json({"ok": False, "error": str(e)})
            return
        self._json({"ok": False, "error": "not found"}, 404)

    def do_POST(self):
        routes = {
            "/api/toggle-mcp": toggle_mcp,
            "/api/toggle-plugin": toggle_plugin,
            "/api/install": run_install,
        }
        try:
            if self.path == "/api/pick-folder":
                self._json(pick_folder())
                return
            fn = routes.get(self.path)
            if not fn:
                self._json({"ok": False, "error": "not found"}, 404)
                return
            self._json(fn(self._read_body()))
        except Exception as e:
            self._json({"ok": False, "error": str(e)})


def main():
    port = int(os.environ.get("INSTALLER_PORT") or 8765)
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"http://127.0.0.1:{port}/")
    sys.stdout.flush()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
