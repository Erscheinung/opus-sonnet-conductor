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
from urllib.parse import urlparse, parse_qs

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


def known_project_dirs():
    """Directories that have a project block in ~/.claude.json, newest-ish first."""
    claude, _ = load_json(CLAUDE_JSON_PATH)
    projs = claude.get("projects", {}) or {}
    dirs = [d for d in projs.keys() if os.path.isdir(d)]
    return sorted(dirs)


def dir_settings_path(directory):
    return os.path.join(directory, ".claude", "settings.json")


def dir_project_block(claude, directory):
    """The projects[<dir>] block from ~/.claude.json, or {} if absent."""
    return (claude.get("projects", {}) or {}).get(directory, {}) or {}


def dir_mcp_servers(directory):
    """MCP servers visible to a directory: its project block plus any .mcp.json."""
    claude, _ = load_json(CLAUDE_JSON_PATH)
    block = dir_project_block(claude, directory)
    names = set((block.get("mcpServers", {}) or {}).keys())
    mcp_json_path = os.path.join(directory, ".mcp.json")
    mj, _ = load_json(mcp_json_path)
    names |= set((mj.get("mcpServers", {}) or {}).keys())
    disabled = set(block.get("disabledMcpServers", []) or [])
    disabled |= set(block.get("disabledMcpjsonServers", []) or [])
    return [{"name": n, "disabled": n in disabled} for n in sorted(names)]


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


def build_state(scope="global", directory=None):
    settings, _ = load_json(SETTINGS_PATH)
    claude, _ = load_json(CLAUDE_JSON_PATH)

    components = []
    for name, rel in COMPONENTS:
        p = os.path.join(HOME, rel)
        components.append({"name": name, "path": p, "found": os.path.exists(p)})

    if scope == "dir" and directory:
        # Plugins live in the directory's own .claude/settings.json (if any).
        dsettings, _ = load_json(dir_settings_path(directory))
        enabled_plugins = dsettings.get("enabledPlugins", {}) or {}
        mcp_servers = dir_mcp_servers(directory)
    else:
        enabled_plugins = settings.get("enabledPlugins", {}) or {}
        disabled_set = set(claude.get("disabledMcpServers", []) or [])
        servers = claude.get("mcpServers", {}) or {}
        mcp_servers = [
            {"name": n, "disabled": n in disabled_set}
            for n in sorted(servers.keys())
        ]

    cost_hook = any(
        (k.startswith("orchestrator-budget@")) and v
        for k, v in enabled_plugins.items()
    )
    plugins = [{"id": k, "enabled": bool(v)} for k, v in enabled_plugins.items()]

    return {
        "scope": scope,
        "directory": directory,
        "scopes": known_project_dirs(),
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
    scope = body.get("scope", "global")
    directory = body.get("directory")
    if not name:
        return {"ok": False, "error": "missing name"}
    claude, existed = load_json(CLAUDE_JSON_PATH)
    if not existed:
        return {"ok": False, "error": "config not found"}

    if scope == "dir" and directory:
        projects = claude.setdefault("projects", {})
        block = projects.setdefault(directory, {})
        arr = block.get("disabledMcpServers", []) or []
        target = block
    else:
        arr = claude.get("disabledMcpServers", []) or []
        target = claude

    current = [s for s in arr if isinstance(s, str)]
    if disabled:
        if name not in current:
            current.append(name)
    else:
        current = [s for s in current if s != name]
    target["disabledMcpServers"] = current
    save_json(CLAUDE_JSON_PATH, claude)
    return {"ok": True, "disabledMcpServers": current}


def toggle_plugin(body):
    plugin_id = body.get("id")
    enabled = bool(body.get("enabled"))
    scope = body.get("scope", "global")
    directory = body.get("directory")
    if not plugin_id:
        return {"ok": False, "error": "missing id"}

    path = dir_settings_path(directory) if scope == "dir" and directory else SETTINGS_PATH
    settings, existed = load_json(path)
    if not existed and (scope != "dir"):
        return {"ok": False, "error": "config not found"}
    plugins = settings.get("enabledPlugins")
    if not isinstance(plugins, dict):
        plugins = {}
    plugins[plugin_id] = enabled
    settings["enabledPlugins"] = plugins
    os.makedirs(os.path.dirname(path), exist_ok=True)
    save_json(path, settings)
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


def claude_md_view(scope, directory):
    """Return the CLAUDE.md / settings files that apply at a scope, with previews."""
    files = []
    if scope == "dir" and directory:
        candidates = [
            ("project CLAUDE.md", os.path.join(directory, "CLAUDE.md")),
            ("project AGENTS.md", os.path.join(directory, "AGENTS.md")),
            ("project settings", dir_settings_path(directory)),
        ]
    else:
        candidates = [
            ("global CLAUDE.md", os.path.join(HOME, ".claude", "CLAUDE.md")),
            ("global settings", SETTINGS_PATH),
        ]
    for label, path in candidates:
        entry = {"label": label, "path": path, "exists": os.path.exists(path)}
        if entry["exists"]:
            try:
                with open(path, "r", encoding="utf-8") as f:
                    text = f.read()
                entry["lines"] = text.count("\n") + 1
                entry["bytes"] = len(text.encode("utf-8"))
                entry["preview"] = text[:4000]
                entry["truncated"] = len(text) > 4000
            except OSError as e:
                entry["error"] = str(e)
        files.append(entry)
    return {"ok": True, "files": files}


def open_in_editor(body):
    path = body.get("path")
    if not path or not os.path.exists(path):
        return {"ok": False, "error": "file not found"}
    try:
        subprocess.run(["open", path], timeout=10)
    except Exception as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True}


def context_usage(directory=None):
    """Run `claude --print /context` headless and return parsed markdown + raw."""
    claude_bin = shutil.which("claude")
    if not claude_bin:
        return {"ok": False, "error": "claude CLI not on PATH"}
    cwd = directory if (directory and os.path.isdir(directory)) else REPO_ROOT
    try:
        out = subprocess.run(
            [claude_bin, "--print", "/context"],
            capture_output=True,
            text=True,
            timeout=60,
            cwd=cwd,
            stdin=subprocess.DEVNULL,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": "timeout running claude --print /context"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
    raw = out.stdout or ""
    if not raw.strip():
        return {"ok": False, "error": (out.stderr or "empty output").strip()}
    return {"ok": True, "raw": raw, "categories": _parse_context(raw)}


def _parse_context(raw):
    """Pull the 'Estimated usage by category' table into [{category, tokens, pct}]."""
    rows = []
    in_table = False
    for line in raw.splitlines():
        s = line.strip()
        if s.startswith("### ") and "category" in s.lower():
            in_table = True
            continue
        if in_table:
            if s.startswith("### ") or (s.startswith("**") and not s.startswith("|")):
                if not s.startswith("|"):
                    in_table = False
                    continue
            if s.startswith("|") and "---" not in s:
                cells = [c.strip() for c in s.strip("|").split("|")]
                if len(cells) >= 3 and cells[0].lower() not in ("category", ""):
                    rows.append(
                        {"category": cells[0], "tokens": cells[1], "pct": cells[2]}
                    )
    return rows


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
        parsed = urlparse(self.path)
        route = parsed.path
        qs = parse_qs(parsed.query)
        scope = (qs.get("scope") or ["global"])[0]
        directory = (qs.get("dir") or [None])[0]

        if route == "/":
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
        try:
            if route == "/api/state":
                self._json(build_state(scope, directory))
            elif route == "/api/claude-md":
                self._json(claude_md_view(scope, directory))
            elif route == "/api/context":
                self._json(context_usage(directory))
            else:
                self._json({"ok": False, "error": "not found"}, 404)
        except Exception as e:
            self._json({"ok": False, "error": str(e)})

    def do_POST(self):
        routes = {
            "/api/toggle-mcp": toggle_mcp,
            "/api/toggle-plugin": toggle_plugin,
            "/api/install": run_install,
            "/api/open": open_in_editor,
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
