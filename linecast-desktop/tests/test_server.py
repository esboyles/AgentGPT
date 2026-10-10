import json
import threading
import urllib.error
import urllib.request

import pytest

from linecast_desktop import server as srv


MOON = {"schema": 1, "location": "Brest, Brittany", "timezone": "Europe/Paris",
        "fetched_at": "2026-10-10T15:44", "phase": "New Moon", "icon": "○",
        "illumination": 0.4, "waxing": False, "age_days": 29.4,
        "events": [{"kind": "set", "time": "2026-10-10T19:46"},
                   {"kind": "rise", "time": "2026-10-11T08:59"}],
        "next_full": "2026-10-26", "next_full_name": "Hunter's", "next_new": "2026-10-10",
        "up_now": True, "altitude_deg": 25.5}
SUN = {"schema": 1, "location": "Brest, Brittany", "timezone": "Europe/Paris",
       "fetched_at": "2026-10-10T15:44", "sunrise": "2026-10-10T08:21",
       "sunset": "2026-10-10T19:28", "solar_noon": "2026-10-10T13:54",
       "day_length_seconds": 40020, "day_length_delta_seconds": -190,
       "next_event": {"kind": "sunset", "time": "2026-10-10T19:28"},
       "elevation_deg": 26.9, "polar": None}
TIDES = {"schema": 1, "location": "Brest, Brittany", "timezone": "Europe/Paris",
         "fetched_at": "2026-10-10T15:44", "station": "Brest, Brittany",
         "units": {"height": "m"},
         "events": [{"kind": "high", "time": "2026-10-10T17:42", "height": 6.82},
                    {"kind": "low", "time": "2026-10-11T00:03", "height": 0.78}],
         "series": [{"time": "2026-10-10T15:30", "height": 5.9}], "now_height": 6.0,
         "station_id": "x", "source": "TICON-4"}


class FakeRunner:
    """Stands in for linecast: records each command, answers from a table."""

    def __init__(self, fail=()):
        self.calls = []
        self.fail = set(fail)

    def __call__(self, cmd, art=False):
        self.calls.append((cmd, art))
        app = cmd[3]
        if app in self.fail:
            raise srv.LinecastError("Could not fetch %s data." % app)
        if art:
            return "\x1b[38;2;0;128;255m%s\x1b[0m\n" % app
        return json.dumps({"moon": MOON, "sunshine": SUN, "tides": TIDES,
                           "sky": {"schema_version": 1}}[app])


@pytest.fixture
def running():
    def start(fail=(), location=None, units=None):
        runner = FakeRunner(fail)
        args = srv.parse_args(["--port", "0"] + (["--location", location] if location else [])
                              + (["--" + units] if units else []))
        server, service = srv.make_server(args, runner=runner)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = "http://127.0.0.1:%d" % server.server_address[1]
        started.append(server)
        return base, runner
    started = []
    yield start
    for server in started:
        server.shutdown()
        server.server_close()


def get(url):
    try:
        with urllib.request.urlopen(url, timeout=10) as res:
            return res.status, dict(res.headers), res.read()
    except urllib.error.HTTPError as err:
        return err.code, dict(err.headers), err.read()


def get_json(url):
    status, headers, body = get(url)
    return status, headers, json.loads(body)


def test_dashboard_and_static_files_are_served(running):
    base, _ = running()
    for path, kind in (("/", "text/html"), ("/app.js", "javascript"), ("/style.css", "text/css"),
                       ("/icon.svg", "image/svg")):
        status, headers, body = get(base + path)
        assert status == 200, path
        assert kind in headers["Content-Type"]
        assert body


def test_no_other_files_are_reachable(running):
    base, _ = running()
    for path in ("/../server.py", "/static/../server.py", "/%2e%2e/server.py", "/server.py"):
        status, _h, _b = get(base + path)
        assert status == 404, path


def test_json_route_runs_linecast_and_caches(running):
    base, runner = running()
    status, _h, data = get_json(base + "/api/moon")
    assert status == 200 and data["phase"] == "New Moon"
    get_json(base + "/api/moon")
    assert len(runner.calls) == 1  # second answer came from the cache
    cmd, art = runner.calls[0]
    assert cmd[2:5] == ["linecast", "moon", "--json"] and art is False


def test_location_goes_in_as_a_single_option(running):
    base, runner = running()
    get_json(base + "/api/moon?location=--help")
    cmd, _ = runner.calls[0]
    assert "--location=--help" in cmd
    assert "--help" not in cmd


def test_bad_location_is_refused(running):
    base, runner = running()
    status, _h, data = get_json(base + "/api/moon?location=" + "x" * 101)
    assert status == 400
    status, _h, data = get_json(base + "/api/moon?location=a%0Ab")
    assert status == 400
    assert runner.calls == []


def test_unknown_app_is_404(running):
    base, runner = running()
    status, _h, _d = get_json(base + "/api/radar")  # radar has no JSON
    assert status == 404
    status, _h, _d = get_json(base + "/api/art/nope")
    assert status == 404
    assert runner.calls == []


def test_linecast_failure_is_a_502_with_its_message(running):
    base, _ = running(fail={"tides"})
    status, _h, data = get_json(base + "/api/tides")
    assert status == 502
    assert "Could not fetch tides" in data["error"]


def test_art_is_html_and_sized_within_bounds(running):
    base, runner = running()
    status, _h, data = get_json(base + "/api/art/radar?cols=5000&rows=1")
    assert status == 200
    assert '<span style="color:#0080ff">radar</span>' in data["html"]
    cmd, art = runner.calls[0]
    assert art is True
    assert cmd[cmd.index("--width") + 1] == "300"
    assert cmd[cmd.index("--height") + 1] == "8"


def test_units_only_reach_commands_that_take_them(running):
    base, runner = running(units="metric")
    get_json(base + "/api/moon")
    get_json(base + "/api/tides")
    moon_cmd, tides_cmd = runner.calls[0][0], runner.calls[1][0]
    assert "--metric" not in moon_cmd
    assert "--metric" in tides_cmd


def test_summary_flattens_for_home_assistant(running):
    base, _ = running(fail={"weather"})
    status, headers, data = get_json(base + "/api/summary")
    assert status == 200
    assert headers["Access-Control-Allow-Origin"] == "*"
    assert data["location"] == "Brest, Brittany"
    assert data["weather"] is None and "weather" in data["errors"]
    assert data["moon"]["illumination"] == 0.4  # already a percentage
    assert data["moon"]["next_full_name"] == "Hunter's"
    # Times carry their UTC offset so Home Assistant can use them as timestamps
    assert data["sun"]["sunset"] == "2026-10-10T19:28:00+02:00"
    assert data["sun"]["day_length_minutes"] == 667.0
    assert data["tide"]["next"] == "high"
    assert data["tide"]["next_time"] == "2026-10-10T17:42:00+02:00"
    assert data["tide"]["next_low_height"] == 0.78


def test_failed_refresh_serves_last_good_value_marked_stale():
    clock = [0.0]
    cache = srv.Cache(clock=lambda: clock[0])
    calls = []

    def ok():
        calls.append(1)
        return {"v": 1}

    def broken():
        raise srv.LinecastError("down")

    assert cache.get("k", 60, ok) == ({"v": 1}, False)
    clock[0] = 30
    assert cache.get("k", 60, broken) == ({"v": 1}, False)  # still fresh, not rerun
    clock[0] = 90
    assert cache.get("k", 60, broken) == ({"v": 1}, True)
    with pytest.raises(srv.LinecastError):
        cache.get("other", 60, broken)


def test_aware_keeps_unknown_zones_unchanged():
    assert srv.aware("2026-10-10T08:21", "Europe/Paris") == "2026-10-10T08:21:00+02:00"
    assert srv.aware("2026-10-10T08:21", None) == "2026-10-10T08:21"
    assert srv.aware("2026-10-10T08:21", "Not/AZone") == "2026-10-10T08:21"
    assert srv.aware(None, "Europe/Paris") is None


def test_default_bind_is_this_computer_only():
    args = srv.parse_args(["--port", "0"])
    server, _ = srv.make_server(args, runner=FakeRunner())
    try:
        assert server.server_address[0] == "127.0.0.1"
    finally:
        server.server_close()
    args = srv.parse_args(["--port", "0", "--lan"])
    server, _ = srv.make_server(args, runner=FakeRunner())
    try:
        assert server.server_address[0] == "0.0.0.0"
    finally:
        server.server_close()
