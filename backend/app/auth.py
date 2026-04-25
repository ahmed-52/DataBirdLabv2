"""Supabase JWT verification via JWKS endpoint (ES256)."""
import os
import logging
from typing import Optional
from fastapi import Header, HTTPException
import jwt as pyjwt
from jwt import PyJWKClient

logger = logging.getLogger(__name__)

SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
JWKS_URL = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json" if SUPABASE_URL else ""

_jwks_client: Optional[PyJWKClient] = None


def _get_signing_key(token: str):
    """Resolve the signing key for a given JWT via JWKS. Cached by PyJWKClient."""
    global _jwks_client
    if _jwks_client is None:
        if not JWKS_URL:
            raise HTTPException(500, "SUPABASE_URL not configured")
        _jwks_client = PyJWKClient(JWKS_URL)
    return _jwks_client.get_signing_key_from_jwt(token).key


def verify_jwt(authorization: Optional[str]) -> dict:
    """Verify Supabase ES256 JWT. Returns the decoded payload or raises 401."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing or malformed Authorization header")
    token = authorization[len("Bearer "):].strip()
    try:
        signing_key = _get_signing_key(token)
        payload = pyjwt.decode(
            token,
            signing_key,
            algorithms=["ES256"],
            audience="authenticated",
            issuer=f"{SUPABASE_URL}/auth/v1",
        )
        return payload
    except pyjwt.ExpiredSignatureError:
        raise HTTPException(401, "Token expired")
    except pyjwt.InvalidAudienceError:
        raise HTTPException(401, "Wrong audience")
    except pyjwt.InvalidIssuerError:
        raise HTTPException(401, "Wrong issuer")
    except pyjwt.InvalidSignatureError:
        raise HTTPException(401, "Invalid signature")
    except Exception as e:
        logger.warning("jwt_verification_failed", extra={"error": str(e)})
        raise HTTPException(401, "Invalid token")


def get_current_user(authorization: str = Header(...)) -> dict:
    """FastAPI dependency. Use as: `Depends(get_current_user)`."""
    return verify_jwt(authorization)
