import base64
import binascii
from pathlib import PurePath
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.ai.embeddings import normalize_azure_endpoint
from app.auth import AuthenticatedUser, current_user
from app.config import Settings, get_settings
from app.routers.tutor import _course_access

router = APIRouter(prefix="/courses", tags=["voice teach-back"])

MAX_AUDIO_BYTES = 8 * 1024 * 1024
ALLOWED_AUDIO_TYPES = {
    "audio/webm": ".webm",
    "audio/ogg": ".ogg",
    "audio/wav": ".wav",
    "audio/x-wav": ".wav",
    "audio/mpeg": ".mp3",
    "audio/mp4": ".m4a",
    "audio/m4a": ".m4a",
    "audio/x-m4a": ".m4a",
}


class AudioTranscriptionRequest(BaseModel):
    filename: str = Field(min_length=1, max_length=180)
    mime_type: str = Field(min_length=3, max_length=100)
    data_base64: str


class AudioTranscriptionResponse(BaseModel):
    transcript: str


def _base_mime_type(value: str) -> str:
    return value.split(";", 1)[0].strip().lower()


def _decode_audio(request: AudioTranscriptionRequest) -> tuple[bytes, str]:
    mime_type = _base_mime_type(request.mime_type)
    if mime_type not in ALLOWED_AUDIO_TYPES:
        raise HTTPException(status_code=415, detail="Record or upload WebM, OGG, WAV, MP3, or M4A audio")
    try:
        content = base64.b64decode(request.data_base64, validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=400, detail="The recorded audio data is invalid") from error
    if not content or len(content) > MAX_AUDIO_BYTES:
        raise HTTPException(status_code=413, detail="Voice recordings must be between 1 byte and 8 MB")

    valid_magic = {
        "audio/webm": content.startswith(b"\x1aE\xdf\xa3"),
        "audio/ogg": content.startswith(b"OggS"),
        "audio/wav": content.startswith(b"RIFF") and content[8:12] == b"WAVE",
        "audio/x-wav": content.startswith(b"RIFF") and content[8:12] == b"WAVE",
        "audio/mpeg": content.startswith(b"ID3") or (
            len(content) > 1 and content[0] == 0xFF and content[1] & 0xE0 == 0xE0
        ),
        "audio/mp4": len(content) >= 12 and content[4:8] == b"ftyp",
        "audio/m4a": len(content) >= 12 and content[4:8] == b"ftyp",
        "audio/x-m4a": len(content) >= 12 and content[4:8] == b"ftyp",
    }
    if not valid_magic[mime_type]:
        raise HTTPException(status_code=400, detail="The recording does not match its reported audio format")
    return content, mime_type


@router.post("/{course_id}/teach-back/transcribe", response_model=AudioTranscriptionResponse)
async def transcribe_teach_back(
    course_id: UUID,
    request: AudioTranscriptionRequest,
    user: AuthenticatedUser = Depends(current_user),
    settings: Settings = Depends(get_settings),
) -> AudioTranscriptionResponse:
    transcription_endpoint = (
        settings.azure_openai_transcription_endpoint or settings.azure_openai_endpoint
    )
    transcription_key = (
        settings.azure_openai_transcription_api_key or settings.azure_openai_api_key
    )
    if not (
        transcription_endpoint
        and transcription_key
        and settings.azure_openai_transcription_deployment
    ):
        raise HTTPException(
            status_code=503,
            detail="Voice transcription is not configured. Add an Azure speech-to-text deployment name to AZURE_OPENAI_TRANSCRIPTION_DEPLOYMENT.",
        )

    content, mime_type = _decode_audio(request)
    key = settings.supabase_service_role_key
    base = settings.supabase_url.rstrip("/")
    data_headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=75) as client:
        if not await _course_access(client, base, data_headers, str(course_id), user.id):
            raise HTTPException(status_code=403, detail="You are not an approved member of this course")
        profile = await client.get(
            f"{base}/rest/v1/profiles",
            headers=data_headers,
            params={"id": f"eq.{user.id}", "role": "eq.student", "select": "id", "limit": "1"},
        )
        profile.raise_for_status()
        if not profile.json():
            raise HTTPException(status_code=403, detail="Voice teach-back is available to students")

        deployment = settings.azure_openai_transcription_deployment
        endpoint = normalize_azure_endpoint(transcription_endpoint)
        filename = PurePath(request.filename).name[:180]
        response = await client.post(
            f"{endpoint}/openai/deployments/{deployment}/audio/transcriptions",
            params={"api-version": settings.azure_openai_api_version},
            headers={"api-key": transcription_key},
            files={"file": (filename, content, mime_type)},
            data={"response_format": "json"},
        )
        if response.status_code >= 400:
            if response.status_code in {400, 404}:
                raise HTTPException(
                    status_code=503,
                    detail="The configured Azure transcription deployment is unavailable or does not support this audio format.",
                )
            response.raise_for_status()
        payload = response.json()
        transcript = str(payload.get("text") or "").strip()
        if len(transcript) < 3:
            raise HTTPException(status_code=422, detail="No clear speech was detected. Try again closer to the microphone.")
        return AudioTranscriptionResponse(transcript=transcript[:4000])
