import logging
from datetime import UTC, datetime
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException

from app.auth import AuthenticatedUser, current_user
from app.config import Settings, get_settings

router = APIRouter(prefix="/notifications", tags=["notifications"])
logger = logging.getLogger(__name__)


def _notification_allowed(preferences: dict, notification_type: str) -> bool:
    """Return False only when the recipient explicitly disabled this alert type."""
    if notification_type == "misconception":
        key = "misconceptionAlerts" if "misconceptionAlerts" in preferences else "misconceptions"
    else:
        key = {
            "enroll": "enrollments",
            "flag": "flags",
            "quiz": "quizActivity",
        }.get(notification_type)
    return key is None or preferences.get(key) is not False


async def _load_preferences(
    client: httpx.AsyncClient, base: str, headers: dict, recipient_ids: list[str],
) -> dict[str, dict]:
    if not recipient_ids:
        return {}
    try:
        response = await client.get(
            f"{base}/rest/v1/user_preferences", headers=headers,
            params={"user_id": f"in.({','.join(recipient_ids)})", "select": "user_id,preferences"},
        )
        response.raise_for_status()
        return {
            row["user_id"]: row["preferences"]
            for row in response.json()
            if isinstance(row.get("preferences"), dict)
        }
    except httpx.HTTPError:
        # Notifications are important enough to default on if preference lookup
        # is temporarily unavailable.
        logger.exception("Could not load notification preferences")
        return {}


async def create_notification(
    client: httpx.AsyncClient,
    base: str,
    headers: dict,
    *,
    recipient_id: str,
    course_id: str,
    notification_type: str,
    title: str,
    body: str,
    metadata: dict | None = None,
) -> bool:
    try:
        preferences = await _load_preferences(client, base, headers, [recipient_id])
        if not _notification_allowed(preferences.get(recipient_id, {}), notification_type):
            return True
        response = await client.post(
            f"{base}/rest/v1/notifications",
            headers=headers,
            json={
                "recipient_id": recipient_id,
                "course_id": course_id,
                "type": notification_type,
                "title": title,
                "body": body,
                "metadata": metadata or {},
            },
        )
        response.raise_for_status()
        return True
    except httpx.HTTPError:
        logger.exception("Could not create %s notification for %s", notification_type, recipient_id)
        return False


async def create_notifications(
    client: httpx.AsyncClient,
    base: str,
    headers: dict,
    *,
    recipient_ids: list[str],
    course_id: str,
    notification_type: str,
    title: str,
    body: str,
    metadata: dict | None = None,
) -> bool:
    if not recipient_ids:
        return True
    try:
        preferences = await _load_preferences(client, base, headers, recipient_ids)
        enabled_ids = [
            recipient_id for recipient_id in recipient_ids
            if _notification_allowed(preferences.get(recipient_id, {}), notification_type)
        ]
        if not enabled_ids:
            return True
        response = await client.post(
            f"{base}/rest/v1/notifications",
            headers=headers,
            json=[{
                "recipient_id": recipient_id,
                "course_id": course_id,
                "type": notification_type,
                "title": title,
                "body": body,
                "metadata": metadata or {},
            } for recipient_id in enabled_ids],
        )
        response.raise_for_status()
        return True
    except httpx.HTTPError:
        logger.exception("Could not create %s notifications for course %s", notification_type, course_id)
        return False


def _config(settings: Settings) -> tuple[str, dict[str, str]]:
    key = settings.supabase_service_role_key
    return settings.supabase_url.rstrip("/"), {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
        "Prefer": "return=representation",
    }


@router.get("")
async def list_notifications(
    user: AuthenticatedUser = Depends(current_user), settings: Settings = Depends(get_settings),
) -> list[dict]:
    base, headers = _config(settings)
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(
            f"{base}/rest/v1/notifications", headers=headers,
            params={"recipient_id": f"eq.{user.id}", "dismissed_at": "is.null", "select": "id,course_id,type,title,body,read_at,created_at,metadata", "order": "created_at.desc", "limit": "50"},
        )
        response.raise_for_status()
        return response.json()


@router.patch("/{notification_id}/read")
async def mark_notification_read(
    notification_id: UUID,
    user: AuthenticatedUser = Depends(current_user), settings: Settings = Depends(get_settings),
) -> dict:
    base, headers = _config(settings)
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.patch(
            f"{base}/rest/v1/notifications", headers=headers,
            params={"id": f"eq.{notification_id}", "recipient_id": f"eq.{user.id}"},
            json={"read_at": datetime.now(UTC).isoformat()},
        )
        response.raise_for_status()
        if not response.json():
            raise HTTPException(status_code=404, detail="Notification not found")
        return response.json()[0]


@router.patch("/read-all")
async def mark_all_notifications_read(
    user: AuthenticatedUser = Depends(current_user), settings: Settings = Depends(get_settings),
) -> dict[str, bool]:
    base, headers = _config(settings)
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.patch(
            f"{base}/rest/v1/notifications", headers=headers,
            params={"recipient_id": f"eq.{user.id}", "read_at": "is.null", "dismissed_at": "is.null"},
            json={"read_at": datetime.now(UTC).isoformat()},
        )
        response.raise_for_status()
        return {"updated": True}


@router.delete("/{notification_id}")
async def dismiss_notification(
    notification_id: UUID,
    user: AuthenticatedUser = Depends(current_user), settings: Settings = Depends(get_settings),
) -> dict[str, bool]:
    base, headers = _config(settings)
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.patch(
            f"{base}/rest/v1/notifications", headers=headers,
            params={"id": f"eq.{notification_id}", "recipient_id": f"eq.{user.id}"},
            json={"dismissed_at": datetime.now(UTC).isoformat()},
        )
        response.raise_for_status()
        return {"dismissed": True}
