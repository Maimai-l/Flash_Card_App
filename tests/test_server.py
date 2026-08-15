"""The HTTP layer: dispatch, error shape, and the loopback-only guard."""

import json
import urllib.error
import urllib.request

import pytest

from app.server import AppServer, find_free_port, _origin_is_local


@pytest.fixture
def server(api, tmp_path):
    (tmp_path / "web").mkdir()
    (tmp_path / "web" / "index.html").write_text("<!doctype html><title>x</title>")
    running = AppServer(str(tmp_path / "web"), api, find_free_port(0)).start()
    yield running
    running.stop()


# Talk to loopback directly; an ambient HTTPS_PROXY must not intercept it.
opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def post(server, method, args=None, headers=None):
    body = json.dumps({"method": method, "args": args or []}).encode()
    request = urllib.request.Request(
        f"{server.url}api", body, {"Content-Type": "application/json", **(headers or {})})
    with opener.open(request) as response:
        return json.loads(response.read())


def test_dispatches_to_the_api(server):
    result = post(server, "get_bootstrap")
    assert "version" in result and "decks" in result


def test_unknown_method_is_reported_not_raised(server):
    assert "Unknown API method" in post(server, "definitely_not_a_method")["error"]


def test_private_attributes_are_not_reachable(server):
    assert "error" in post(server, "_secret")
    assert "error" in post(server, "__init__")


def test_bad_arguments_come_back_as_an_error(server):
    assert "error" in post(server, "answer_card", ["not-a-number", 3])


def test_static_files_are_served(server):
    with opener.open(f"{server.url}index.html") as response:
        assert response.status == 200
        assert b"<!doctype html>" in response.read()


def test_cross_origin_requests_are_refused(server):
    with pytest.raises(urllib.error.HTTPError) as caught:
        post(server, "get_bootstrap", headers={"Origin": "https://evil.example"})
    assert caught.value.code == 403


def test_same_origin_requests_pass(server):
    result = post(server, "get_bootstrap", headers={"Origin": server.url.rstrip("/")})
    assert "version" in result


def test_only_the_api_path_accepts_posts(server):
    request = urllib.request.Request(f"{server.url}elsewhere", b"{}",
                                     {"Content-Type": "application/json"})
    with pytest.raises(urllib.error.HTTPError) as caught:
        opener.open(request)
    assert caught.value.code == 404


@pytest.mark.parametrize("origin,expected", [
    ("", True),
    ("null", True),
    ("http://127.0.0.1:9999", True),
    ("http://localhost:9999", True),
    ("http://127.0.0.1:1234", False),
    ("http://example.com", False),
    ("https://127.0.0.1.evil.com:9999", False),
])
def test_origin_check(origin, expected):
    assert _origin_is_local(origin, 9999) is expected


def test_round_trip_through_http_writes_data(server):
    text = json.dumps({"deck": "CS", "cards": [{"front": "f", "back": "b"}]})
    assert post(server, "import_commit", [text])["cards"]["new"] == 1
    queue = post(server, "get_queue", [""])
    assert len(queue["cards"]) == 1
    assert post(server, "answer_card", [queue["cards"][0]["card_id"], 3])["ok"] is True
