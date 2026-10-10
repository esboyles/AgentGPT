"""A small local web server that puts linecast on a desktop window.

It runs linecast's own commands for their ``--json`` data and their
colored ``--print`` frames, caches the results, and serves a dashboard
page that draws them. It uses only the Python standard library besides
linecast itself.

Routes:
    /                    the dashboard (``?view=moon`` etc. for one card)
    /api/<app>           linecast's ``--json`` payload for weather,
                         sunshine, moon, sky or tides
    /api/art/<app>       one colored ``--print`` frame as HTML, for any of
                         the seven apps, sized by ``cols`` and ``rows``
    /api/summary         flat values for Home Assistant REST sensors
    /api/config          the server's settings, for the page
    /api/health          a liveness check
"""

import argparse
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from importlib import resources
import json
import os
import shutil
import subprocess
import sys
import threading
import time
from urllib.parse import parse_qs, urlparse
import webbrowser

from linecast_desktop import __version__
from linecast_desktop.ansi import ansi_to_html

JSON_APPS = ("weather", "sunshine", "moon", "sky", "tides")
ART_APPS = ("weather", "sunshine", "moon", "sky", "tides", "radar", "maps")
UNIT_APPS = ("weather", "tides", "radar", "maps")

# Seconds a result stays fresh. Weather and tides change slowly and come
# from rate-limited public services; the sun and sky move by the minute.
JSON_TTL = {"weather": 600, "tides": 600, "sunshine": 60, "moon": 300, "sky": 60}
ART_TTL = {"weather": 600, "tides": 600, "sunshine": 60, "moon": 300,
           "sky": 120, "radar": 300, "maps": 3600}

RUN_TIMEOUT = 120
MAX_LOCATION = 100
COLS = (20, 300)
ROWS = (8, 120)

STATIC_FILES = {
    "/": ("index.html", "text/html; charset=utf-8"),
    "/index.html": ("index.html", "text/html; charset=utf-8"),
    "/app.js": ("app.js", "text/javascript; charset=utf-8"),
    "/style.css": ("style.css", "text/css; charset=utf-8"),
    "/icon.svg": ("icon.svg", "image/svg+xml"),
}


class LinecastError(Exception):
    """linecast ran but did not produce what was asked for."""


class Settings:
    """What every linecast run is given unless a request overrides it."""

    def __init__(self, location=None, units=None, lang=None):
        self.location = location or None
        self.units = units  # "metric", "imperial" or None for linecast's own
        self.lang = lang or None

    def as_dict(self):
        return {"location": self.location, "units": self.units, "lang": self.lang}


def build_command(app, settings, location=None, art=None):
    """The argv for one linecast run.

    *art* is ``(cols, rows)`` for a colored frame, or None for JSON.
    The location is passed as ``--location=VALUE`` so a value starting
    with a dash cannot be read as another option.
    """
    cmd = [sys.executable, "-m", "linecast", app]
    if art is None:
        cmd.append("--json")
    else:
        cols, rows = art
        cmd += ["--width", str(cols), "--height", str(rows)]
    place = location or settings.location
    if place:
        cmd.append("--location=" + place)
    if settings.units and app in UNIT_APPS:
        cmd.append("--" + settings.units)
    if settings.lang:
        cmd.append("--lang=" + settings.lang)
    return cmd


def _child_env(art):
    env = dict(os.environ)
    # Windows consoles default to a legacy code page; linecast writes
    # emoji, braille and box drawing, so ask for UTF-8 on the pipe.
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUTF8"] = "1"
    # LINECAST_COLOR outranks NO_COLOR and the tty check, so the frame
    # keeps its colors even though stdout is a pipe.
    env["LINECAST_COLOR"] = "truecolor" if art else "none"
    return env


def run_linecast(cmd, art=False):
    """Run linecast and return its stdout as text."""
    try:
        proc = subprocess.run(
            cmd, capture_output=True, timeout=RUN_TIMEOUT, env=_child_env(art),
            stdin=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except subprocess.TimeoutExpired:
        raise LinecastError("linecast took too long to answer") from None
    except OSError as exc:
        raise LinecastError("could not start linecast: %s" % exc) from None
    out = proc.stdout.decode("utf-8", errors="replace")
    if proc.returncode != 0 or not out.strip():
        err = proc.stderr.decode("utf-8", errors="replace").strip()
        message = (err or out).strip().splitlines()
        raise LinecastError(message[-1] if message else
                            "linecast exited with status %d" % proc.returncode)
    return out


class Cache:
    """Results by key, each fresh for its own number of seconds.

    One lock per key keeps two requests for the same thing from running
    linecast twice. A failed refresh hands back the last good result,
    marked stale, rather than an error.
    """

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self._values = {}
        self._locks = {}
        self._guard = threading.Lock()

    def _lock(self, key):
        with self._guard:
            return self._locks.setdefault(key, threading.Lock())

    def get(self, key, ttl, produce):
        """Return ``(value, stale)``; raises when there is nothing to give."""
        with self._lock(key):
            hit = self._values.get(key)
            now = self._clock()
            if hit and now - hit[0] < ttl:
                return hit[1], False
            try:
                value = produce()
            except LinecastError:
                if hit:
                    return hit[1], True
                raise
            self._values[key] = (now, value)
            return value, False

    def clear(self):
        with self._guard:
            self._values.clear()


class LinecastService:
    """The work behind the routes, kept apart from HTTP for testing."""

    def __init__(self, settings, runner=run_linecast, cache=None):
        self.settings = settings
        self.runner = runner
        self.cache = cache or Cache()

    def data(self, app, location=None):
        if app not in JSON_APPS:
            raise KeyError(app)
        cmd = build_command(app, self.settings, location)

        def produce():
            text = self.runner(cmd, art=False)
            try:
                return json.loads(text)
            except ValueError:
                raise LinecastError("linecast did not return JSON") from None

        return self.cache.get(("json", app, location), JSON_TTL[app], produce)

    def art(self, app, cols, rows, location=None):
        if app not in ART_APPS:
            raise KeyError(app)
        cmd = build_command(app, self.settings, location, art=(cols, rows))

        def produce():
            text = self.runner(cmd, art=True)
            return {"app": app, "cols": cols, "rows": rows,
                    "generated_at": datetime.now().isoformat(timespec="seconds"),
                    "html": ansi_to_html(text.rstrip("\n"))}

        return self.cache.get(("art", app, location, cols, rows), ART_TTL[app], produce)

    def summary(self, location=None):
        """Flat values for Home Assistant, one call for every sensor."""
        out = {"location": None, "updated": datetime.now().astimezone().isoformat(
            timespec="seconds"), "errors": {}}
        payloads = {}
        for app in ("weather", "sunshine", "moon", "tides"):
            try:
                payloads[app], _stale = self.data(app, location)
            except LinecastError as exc:
                out["errors"][app] = str(exc)
        for app in ("weather", "sunshine", "moon", "tides"):
            if out["location"] is None and app in payloads:
                out["location"] = payloads[app].get("location") or None
        out["weather"] = _weather_summary(payloads.get("weather"))
        out["sun"] = _sun_summary(payloads.get("sunshine"))
        out["moon"] = _moon_summary(payloads.get("moon"))
        out["tide"] = _tide_summary(payloads.get("tides"))
        return out


def aware(stamp, tz_name):
    """linecast's local wall-clock time as ISO 8601 with its UTC offset.

    Home Assistant's timestamp sensors need the offset. Without a usable
    zone the value comes back unchanged.
    """
    if not stamp or not tz_name:
        return stamp
    try:
        from zoneinfo import ZoneInfo
        dt = datetime.fromisoformat(stamp)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=ZoneInfo(tz_name))
        return dt.isoformat()
    except Exception:
        return stamp


def _weather_summary(p):
    if not p:
        return None
    cur = p.get("current") or {}
    today = p.get("today") or {}
    units = p.get("units") or {}
    return {
        "temperature": cur.get("temperature"),
        "feels_like": cur.get("feels_like"),
        "condition": cur.get("condition"),
        "icon": cur.get("icon"),
        "humidity": cur.get("humidity"),
        "wind_speed": cur.get("wind_speed"),
        "wind_gusts": cur.get("wind_gusts"),
        "high": today.get("high"),
        "low": today.get("low"),
        "precipitation_probability": today.get("precipitation_probability"),
        "summary": p.get("summary"),
        "alerts": len(p.get("alerts") or []),
        "unit_temperature": units.get("temperature"),
        "unit_wind": units.get("wind"),
        "stale": p.get("stale"),
    }


def _sun_summary(p):
    if not p:
        return None
    tz = p.get("timezone")
    nxt = p.get("next_event") or {}
    length = p.get("day_length_seconds")
    delta = p.get("day_length_delta_seconds")
    return {
        "sunrise": aware(p.get("sunrise"), tz),
        "sunset": aware(p.get("sunset"), tz),
        "solar_noon": aware(p.get("solar_noon"), tz),
        "day_length_minutes": round(length / 60, 1) if length is not None else None,
        "day_length_change_minutes": round(delta / 60, 1) if delta is not None else None,
        "elevation": p.get("elevation_deg"),
        "next_event": nxt.get("kind"),
        "next_event_time": aware(nxt.get("time"), tz),
    }


def _moon_summary(p):
    if not p:
        return None
    tz = p.get("timezone")
    illum = p.get("illumination")
    events = p.get("events") or []
    rise = next((e.get("time") for e in events if e.get("kind") == "rise"), None)
    moonset = next((e.get("time") for e in events if e.get("kind") == "set"), None)
    return {
        "phase": p.get("phase"),
        "icon": p.get("icon"),
        # linecast already reports this as a percentage
        "illumination": illum,
        "waxing": p.get("waxing"),
        "age_days": p.get("age_days"),
        "next_full": p.get("next_full"),
        "next_full_name": p.get("next_full_name"),
        "next_new": p.get("next_new"),
        "next_rise": aware(rise, tz),
        "next_set": aware(moonset, tz),
        "up": p.get("up_now"),
    }


def _tide_summary(p):
    if not p or not p.get("events"):
        return None
    tz = p.get("timezone")
    events = p.get("events") or []
    first = events[0]
    nxt_high = next((e for e in events if e.get("kind") == "high"), None)
    nxt_low = next((e for e in events if e.get("kind") == "low"), None)
    return {
        "station": p.get("station"),
        "now_height": p.get("now_height"),
        "unit": (p.get("units") or {}).get("height"),
        "next": first.get("kind"),
        "next_time": aware(first.get("time"), tz),
        "next_height": first.get("height"),
        "next_high_time": aware(nxt_high.get("time"), tz) if nxt_high else None,
        "next_high_height": nxt_high.get("height") if nxt_high else None,
        "next_low_time": aware(nxt_low.get("time"), tz) if nxt_low else None,
        "next_low_height": nxt_low.get("height") if nxt_low else None,
        "rising": first.get("kind") == "high",
    }


def _clean_location(values):
    """The ``location`` query value, or None. Raises ValueError if unfit."""
    if not values:
        return None
    value = values[0].strip()
    if not value:
        return None
    if len(value) > MAX_LOCATION or any(ord(ch) < 32 or ord(ch) == 127 for ch in value):
        raise ValueError("location must be at most %d printable characters" % MAX_LOCATION)
    return value


def _clamp_int(values, default, bounds):
    try:
        n = int(values[0]) if values else default
    except ValueError:
        n = default
    return max(bounds[0], min(bounds[1], n))


def _static(name):
    return resources.files("linecast_desktop").joinpath("static", name).read_bytes()


def make_handler(service):
    class Handler(BaseHTTPRequestHandler):
        server_version = "linecast-desktop/" + __version__
        protocol_version = "HTTP/1.1"

        def log_message(self, fmt, *args):  # keep the console quiet
            if os.environ.get("LINECAST_DESKTOP_DEBUG"):
                super().log_message(fmt, *args)

        def _send(self, status, body, ctype, extra=None):
            self.send_response(status)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            for k, v in (extra or {}).items():
                self.send_header(k, v)
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(body)

        def _json(self, status, obj, extra=None):
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            # Home Assistant and other dashboards on the network read the
            # API from their own origin.
            headers = {"Access-Control-Allow-Origin": "*"}
            headers.update(extra or {})
            self._send(status, body, "application/json; charset=utf-8", headers)

        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            url = urlparse(self.path)
            query = parse_qs(url.query)
            path = url.path.rstrip("/") or "/"
            try:
                if path in STATIC_FILES:
                    name, ctype = STATIC_FILES[path]
                    return self._send(HTTPStatus.OK, _static(name), ctype)
                if path == "/api/health":
                    return self._json(HTTPStatus.OK, {"ok": True})
                if path == "/api/config":
                    return self._json(HTTPStatus.OK, {
                        "version": __version__,
                        "linecast": _linecast_version(),
                        "settings": service.settings.as_dict(),
                        "json_apps": JSON_APPS,
                        "art_apps": ART_APPS,
                    })
                location = _clean_location(query.get("location"))
                if path == "/api/summary":
                    return self._json(HTTPStatus.OK, service.summary(location))
                parts = path.strip("/").split("/")
                if len(parts) == 3 and parts[:2] == ["api", "art"]:
                    cols = _clamp_int(query.get("cols"), 80, COLS)
                    rows = _clamp_int(query.get("rows"), 24, ROWS)
                    value, stale = service.art(parts[2], cols, rows, location)
                    return self._json(HTTPStatus.OK, value,
                                      {"X-Linecast-Stale": "1"} if stale else None)
                if len(parts) == 2 and parts[0] == "api":
                    value, stale = service.data(parts[1], location)
                    return self._json(HTTPStatus.OK, value,
                                      {"X-Linecast-Stale": "1"} if stale else None)
                return self._json(HTTPStatus.NOT_FOUND, {"error": "not found"})
            except KeyError:
                return self._json(HTTPStatus.NOT_FOUND, {"error": "unknown app"})
            except ValueError as exc:
                return self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
            except LinecastError as exc:
                return self._json(HTTPStatus.BAD_GATEWAY, {"error": str(exc)})

    return Handler


_LINECAST_VERSION = None


def _linecast_version():
    global _LINECAST_VERSION
    if _LINECAST_VERSION is None:
        try:
            from importlib.metadata import version
            _LINECAST_VERSION = version("linecast")
        except Exception:
            _LINECAST_VERSION = "unknown"
    return _LINECAST_VERSION


def _browser_candidates():
    """Chromium-family browsers that can open a page as its own app window."""
    found = []
    for name in ("msedge", "chrome", "google-chrome", "chromium", "chromium-browser"):
        path = shutil.which(name)
        if path:
            found.append(path)
    if sys.platform == "win32":
        for base in (os.environ.get("ProgramFiles(x86)"), os.environ.get("ProgramFiles"),
                     os.environ.get("LOCALAPPDATA")):
            if not base:
                continue
            for rel in (r"Microsoft\Edge\Application\msedge.exe",
                        r"Google\Chrome\Application\chrome.exe"):
                path = os.path.join(base, rel)
                if os.path.isfile(path):
                    found.append(path)
    return found


def open_window(url, width=1280, height=860):
    """Open *url* as a standalone window: no tabs, no address bar."""
    for browser in _browser_candidates():
        try:
            subprocess.Popen(
                [browser, "--app=" + url, "--window-size=%d,%d" % (width, height)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            return True
        except OSError:
            continue
    return webbrowser.open(url)


def parse_args(argv=None):
    env = os.environ.get
    p = argparse.ArgumentParser(
        prog="linecast-desktop",
        description="Show linecast in a desktop window and serve it to Home Assistant.")
    p.add_argument("--port", type=int, default=int(env("LINECAST_DESKTOP_PORT", "8765")),
                   help="port to listen on (default 8765)")
    p.add_argument("--lan", action="store_true",
                   default=env("LINECAST_DESKTOP_LAN", "") not in ("", "0"),
                   help="listen on every network interface, so Home Assistant or "
                        "another device can reach it (default: this computer only)")
    p.add_argument("--host", default=None, help="exact address to listen on; overrides --lan")
    p.add_argument("--location", default=env("LINECAST_LOCATION"),
                   help="place name or 'lat,lon' (default: linecast's saved location, "
                        "else your network location)")
    units = p.add_mutually_exclusive_group()
    units.add_argument("--metric", dest="units", action="store_const", const="metric")
    units.add_argument("--imperial", dest="units", action="store_const", const="imperial")
    p.add_argument("--lang", default=env("LINECAST_LANG"), help="display language code")
    p.add_argument("--open", action="store_true",
                   help="open the dashboard in its own window once the server is up")
    p.add_argument("--view", default=None,
                   help="with --open, show one card: weather, sun, moon, tides, sky or art")
    p.add_argument("--version", action="version", version="%(prog)s " + __version__)
    args = p.parse_args(argv)
    if args.units is None:
        args.units = env("LINECAST_UNITS") or None
    if args.units not in (None, "metric", "imperial"):
        p.error("LINECAST_UNITS must be metric or imperial")
    return args


def make_server(args, runner=run_linecast):
    host = args.host or ("0.0.0.0" if args.lan else "127.0.0.1")
    settings = Settings(args.location, args.units, args.lang)
    service = LinecastService(settings, runner=runner)
    server = ThreadingHTTPServer((host, args.port), make_handler(service))
    server.daemon_threads = True
    return server, service


def main(argv=None):
    args = parse_args(argv)
    try:
        server, _service = make_server(args)
    except OSError as exc:
        print("linecast-desktop: cannot listen on port %d: %s" % (args.port, exc),
              file=sys.stderr)
        print("Is it already running? Open http://127.0.0.1:%d/" % args.port, file=sys.stderr)
        return 1
    host, port = server.server_address[:2]
    local = "http://127.0.0.1:%d/" % port
    print("linecast-desktop %s is running at %s" % (__version__, local))
    if host == "0.0.0.0":
        print("Listening on the local network too; use this computer's IP address "
              "from Home Assistant, e.g. http://<this-pc>:%d/api/summary" % port)
    print("Press Ctrl+C to stop.")
    if args.open:
        url = local + ("?view=" + args.view if args.view else "")
        threading.Timer(0.5, open_window, (url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
