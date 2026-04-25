"""Storage abstraction — local disk in dev, GCS in prod.

GCS URLs are public (bucket has allUsers:objectViewer) in personal-project
deploy. Legacy V4 signed URL code path is preserved for Cornell-org deploys
where the org policy blocks public buckets. Toggle via GCS_PUBLIC env var.
"""
import os
import logging
from datetime import timedelta
from typing import Optional
from functools import lru_cache

logger = logging.getLogger(__name__)

STORAGE_BACKEND = os.environ.get("STORAGE_BACKEND", "local")
GCS_BUCKET = os.environ.get("GCS_BUCKET", "")
GCS_PUBLIC = os.environ.get("GCS_PUBLIC", "true").lower() == "true"


@lru_cache(maxsize=1)
def _bucket():
    """Lazy GCS client init — only called when STORAGE_BACKEND=gcs."""
    from google.cloud import storage as gcs
    return gcs.Client().bucket(GCS_BUCKET)


def _normalize_path(path: str) -> str:
    """Strip any 'static/' prefix or absolute prefix → relative path under colony root."""
    if "static/" in path:
        return path.split("static/", 1)[1]
    return path.lstrip("/")


def url_for(colony_slug: str, path: str, *, cache: Optional[dict] = None) -> Optional[str]:
    """Resolve a storage URL for a given colony+path.

    Public bucket: returns a direct https://storage.googleapis.com/... URL (no signing).
    Private bucket: returns a V4 signed URL valid for 1hr (requires IAM token creator
    role on the Cloud Run service account — fails gracefully to None on error).
    """
    rel = _normalize_path(path)

    if STORAGE_BACKEND == "local":
        return f"/static/{rel}"

    blob_path = f"colonies/{colony_slug}/{rel}"

    if GCS_PUBLIC:
        # Direct public URL — no signing, no expiry, no per-request CPU.
        return f"https://storage.googleapis.com/{GCS_BUCKET}/{blob_path}"

    # Private bucket: mint V4 signed URL with request-scoped dedupe.
    if cache is not None and blob_path in cache:
        return cache[blob_path]
    try:
        url = _bucket().blob(blob_path).generate_signed_url(
            version="v4",
            expiration=timedelta(hours=1),
            method="GET",
        )
    except Exception as e:
        logger.error("signed_url_failed", extra={"path": blob_path, "error": str(e)})
        url = None
    if cache is not None:
        cache[blob_path] = url
    return url


def upload(colony_slug: str, dest_path: str, source_file_path: str) -> str:
    """Write a local file to storage. Returns the relative path stored."""
    rel = _normalize_path(dest_path)
    if STORAGE_BACKEND == "local":
        # In local mode, dest_path already lives on disk
        return rel
    blob_path = f"colonies/{colony_slug}/{rel}"
    _bucket().blob(blob_path).upload_from_filename(source_file_path)
    return rel
