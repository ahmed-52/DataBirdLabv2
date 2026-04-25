import pytest
import jwt as pyjwt
from datetime import datetime, timedelta, timezone
from cryptography.hazmat.primitives.asymmetric.ec import generate_private_key, SECP256R1
from cryptography.hazmat.primitives import serialization
from fastapi import HTTPException
from app.auth import verify_jwt


@pytest.fixture(scope="module")
def keypair():
    priv = generate_private_key(SECP256R1())
    pub = priv.public_key()
    pem_priv = priv.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    pem_pub = pub.public_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PublicFormat.SubjectPublicKeyInfo,
    )
    return pem_priv, pem_pub


def make_token(priv_pem, *, exp_offset=3600, audience="authenticated"):
    return pyjwt.encode(
        {
            "sub": "user-123",
            "aud": audience,
            "iss": "https://test.supabase.co/auth/v1",
            "exp": datetime.now(timezone.utc) + timedelta(seconds=exp_offset),
        },
        priv_pem, algorithm="ES256",
    )


def test_valid_token_accepted(keypair, monkeypatch):
    priv, pub = keypair
    monkeypatch.setattr("app.auth._get_signing_key", lambda token: pub)
    monkeypatch.setattr("app.auth.SUPABASE_URL", "https://test.supabase.co")
    token = make_token(priv)
    payload = verify_jwt(f"Bearer {token}")
    assert payload["sub"] == "user-123"


def test_expired_token_rejected(keypair, monkeypatch):
    priv, pub = keypair
    monkeypatch.setattr("app.auth._get_signing_key", lambda token: pub)
    monkeypatch.setattr("app.auth.SUPABASE_URL", "https://test.supabase.co")
    token = make_token(priv, exp_offset=-10)
    with pytest.raises(HTTPException) as exc:
        verify_jwt(f"Bearer {token}")
    assert exc.value.status_code == 401


def test_wrong_audience_rejected(keypair, monkeypatch):
    priv, pub = keypair
    monkeypatch.setattr("app.auth._get_signing_key", lambda token: pub)
    monkeypatch.setattr("app.auth.SUPABASE_URL", "https://test.supabase.co")
    token = make_token(priv, audience="wrong")
    with pytest.raises(HTTPException) as exc:
        verify_jwt(f"Bearer {token}")
    assert exc.value.status_code == 401


def test_tampered_signature_rejected(keypair, monkeypatch):
    priv, pub = keypair
    monkeypatch.setattr("app.auth._get_signing_key", lambda token: pub)
    monkeypatch.setattr("app.auth.SUPABASE_URL", "https://test.supabase.co")
    token = make_token(priv)
    tampered = token[:-5] + "XXXXX"
    with pytest.raises(HTTPException) as exc:
        verify_jwt(f"Bearer {tampered}")
    assert exc.value.status_code == 401


def test_missing_bearer_prefix_rejected(keypair, monkeypatch):
    priv, pub = keypair
    monkeypatch.setattr("app.auth._get_signing_key", lambda token: pub)
    monkeypatch.setattr("app.auth.SUPABASE_URL", "https://test.supabase.co")
    token = make_token(priv)
    with pytest.raises(HTTPException) as exc:
        verify_jwt(token)  # no Bearer prefix
    assert exc.value.status_code == 401
