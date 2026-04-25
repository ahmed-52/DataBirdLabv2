import pytest
from unittest.mock import MagicMock, patch


def test_local_mode_returns_relative_url(monkeypatch):
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    from importlib import reload
    from app import storage as s
    reload(s)
    url = s.url_for("boeung-sne", "uploads/survey_12/audio/x.wav")
    assert url == "/static/uploads/survey_12/audio/x.wav"


def test_gcs_mode_signs_url(monkeypatch):
    monkeypatch.setenv("STORAGE_BACKEND", "gcs")
    monkeypatch.setenv("GCS_BUCKET", "test-bucket")
    from importlib import reload
    from app import storage as s
    reload(s)

    fake_blob = MagicMock()
    fake_blob.generate_signed_url.return_value = "https://storage.googleapis.com/test-bucket/colonies/boeung-sne/uploads/x.wav?X-Goog-Signature=abc"
    fake_bucket = MagicMock()
    fake_bucket.blob.return_value = fake_blob
    monkeypatch.setattr(s, "_bucket", lambda: fake_bucket)

    cache = {}
    url = s.url_for("boeung-sne", "uploads/x.wav", cache=cache)
    assert "X-Goog-Signature=abc" in url
    fake_blob.generate_signed_url.assert_called_once()


def test_gcs_dedupe_cache(monkeypatch):
    monkeypatch.setenv("STORAGE_BACKEND", "gcs")
    monkeypatch.setenv("GCS_BUCKET", "test-bucket")
    from importlib import reload
    from app import storage as s
    reload(s)

    fake_blob = MagicMock()
    fake_blob.generate_signed_url.return_value = "https://signed/abc"
    fake_bucket = MagicMock()
    fake_bucket.blob.return_value = fake_blob
    monkeypatch.setattr(s, "_bucket", lambda: fake_bucket)

    cache = {}
    s.url_for("boeung-sne", "uploads/x.wav", cache=cache)
    s.url_for("boeung-sne", "uploads/x.wav", cache=cache)
    s.url_for("boeung-sne", "uploads/x.wav", cache=cache)
    # Same path 3x — only signs once
    assert fake_blob.generate_signed_url.call_count == 1


def test_gcs_signing_failure_returns_null(monkeypatch, caplog):
    monkeypatch.setenv("STORAGE_BACKEND", "gcs")
    monkeypatch.setenv("GCS_BUCKET", "test-bucket")
    from importlib import reload
    from app import storage as s
    reload(s)

    fake_blob = MagicMock()
    fake_blob.generate_signed_url.side_effect = RuntimeError("no creds")
    fake_bucket = MagicMock()
    fake_bucket.blob.return_value = fake_blob
    monkeypatch.setattr(s, "_bucket", lambda: fake_bucket)

    url = s.url_for("boeung-sne", "uploads/x.wav", cache={})
    assert url is None


def test_strips_static_prefix(monkeypatch):
    monkeypatch.setenv("STORAGE_BACKEND", "local")
    from importlib import reload
    from app import storage as s
    reload(s)
    # Input may have 'static/' prefix from legacy DB rows; output normalized
    assert s._normalize_path("static/uploads/x.wav") == "uploads/x.wav"
    assert s._normalize_path("uploads/x.wav") == "uploads/x.wav"
    assert s._normalize_path("/abs/path/static/uploads/x.wav") == "uploads/x.wav"
