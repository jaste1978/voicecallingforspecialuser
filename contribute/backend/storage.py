"""Video objects on Cloudflare R2.

The browser uploads straight to R2 with a presigned PUT; the video never
passes through this service. That is not only about bandwidth — it means a
failed or slow video upload cannot take the keypoints down with it. The
keypoints are the training data and they are already saved by the time the
upload URL is handed out. Video is the raw material we keep so the dataset
can be re-extracted when the pose models get better.

Unconfigured is a supported state: until the bucket exists, contributions
still record and still store keypoints, and their video_status is 'skipped'.
That keeps the record loop testable on a laptop and on a phone before anyone
has touched a Cloudflare dashboard.
"""

import logging
import os
from datetime import datetime, timezone

logger = logging.getLogger("contribute.storage")

_client = None
_client_failed = False

# The webm/mp4 split is not cosmetic: Safari's MediaRecorder produces mp4 and
# Chrome's produces webm, so a phone-first platform gets both no matter what
# we would prefer.
EXT_BY_MIME = {
    "video/webm": "webm",
    "video/mp4": "mp4",
    "video/quicktime": "mov",
}

UPLOAD_TTL = 900  # 15 min: long enough for a slow 3G upload, short enough to matter


def bucket() -> str:
    return os.environ.get("R2_BUCKET", "isl-contributions")


def configured() -> bool:
    return bool(
        os.environ.get("R2_ACCOUNT_ID")
        and os.environ.get("R2_ACCESS_KEY_ID")
        and os.environ.get("R2_SECRET_ACCESS_KEY")
    )


def _get_client():
    global _client, _client_failed
    if _client is not None or _client_failed:
        return _client
    if not configured():
        return None
    try:
        import boto3
        from botocore.config import Config

        _client = boto3.client(
            "s3",
            endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
            aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
            aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
            region_name="auto",
            config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
        )
    except Exception:
        logger.exception("could not build the R2 client; videos will be skipped")
        _client_failed = True
        return None
    return _client


def object_key(phrase_id: str, contribution_id: str, mime: str) -> str:
    """Grouped by phrase, then dated. Someone eyeballing the bucket to check
    a sign wants every take of that phrase together, not a flat pile."""
    ext = EXT_BY_MIME.get(mime.split(";")[0].strip(), "bin")
    day = datetime.now(timezone.utc).strftime("%Y/%m/%d")
    safe = "".join(ch for ch in phrase_id if ch.isalnum() or ch in "-_") or "unknown"
    return f"clips/{safe}/{day}/{contribution_id}.{ext}"


def presign_put(key: str, mime: str) -> str | None:
    client = _get_client()
    if client is None:
        return None
    try:
        return client.generate_presigned_url(
            "put_object",
            Params={"Bucket": bucket(), "Key": key, "ContentType": mime},
            ExpiresIn=UPLOAD_TTL,
        )
    except Exception:
        logger.exception("presign PUT failed for %s", key)
        return None


def presign_get(key: str, ttl: int = 3600) -> str | None:
    """Playback URL for the review queue (M2) and for spot-checking a clip."""
    client = _get_client()
    if client is None:
        return None
    try:
        return client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket(), "Key": key},
            ExpiresIn=ttl,
        )
    except Exception:
        logger.exception("presign GET failed for %s", key)
        return None


def head(key: str) -> dict | None:
    """Confirm the object actually landed. The browser telling us the upload
    succeeded is a claim; this is the check."""
    client = _get_client()
    if client is None:
        return None
    try:
        r = client.head_object(Bucket=bucket(), Key=key)
        return {"bytes": r.get("ContentLength", 0), "mime": r.get("ContentType", "")}
    except Exception:
        return None


def delete(key: str) -> bool:
    """Used when a contributor asks for their data to be removed."""
    client = _get_client()
    if client is None or not key:
        return False
    try:
        client.delete_object(Bucket=bucket(), Key=key)
        return True
    except Exception:
        logger.exception("delete failed for %s", key)
        return False
