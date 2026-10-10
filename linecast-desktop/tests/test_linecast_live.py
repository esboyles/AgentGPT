"""Runs the real linecast. These use only what linecast computes or
bundles itself (the moon, the sun, and tides at a bundled gauge), so
they need no network beyond what linecast's location lookup skips when
given coordinates."""

import importlib.util

import pytest

from linecast_desktop import server as srv

pytestmark = pytest.mark.skipif(importlib.util.find_spec("linecast") is None,
                                reason="linecast is not installed")

BREST = "48.38,-4.49"


def service():
    return srv.LinecastService(srv.Settings(location=BREST))


def test_moon_json_from_real_linecast():
    data, stale = service().data("moon")
    assert not stale
    assert data["schema"] == 1
    assert 0 <= data["illumination"] <= 100


def test_tides_json_at_a_bundled_gauge():
    data, _ = service().data("tides")
    assert data["station"]
    assert data["events"] and data["series"]


def test_colored_frame_from_real_linecast():
    value, _ = service().art("moon", 60, 16)
    assert "<span style=" in value["html"]
    assert "\x1b" not in value["html"]


def test_summary_from_real_linecast():
    out = service().summary()
    assert out["moon"]["phase"]
    assert out["sun"]["sunrise"]
    assert out["tide"]["station"]
