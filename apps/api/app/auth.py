from dataclasses import dataclass
from functools import lru_cache

import jwt
import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient

from app.config import Settings, get_settings

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class AuthenticatedUser:
    id: str
    email: str | None
    token_role: str


@lru_cache
def _jwks_client(supabase_url: str) -> PyJWKClient:
    return PyJWKClient(f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json", cache_keys=True)


def _decode_token(token: str, settings: Settings) -> dict:
    issuer = f"{settings.supabase_url.rstrip('/')}/auth/v1"
    options = {"require": ["exp", "sub", "aud"]}

    if settings.supabase_jwt_secret:
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience=settings.supabase_jwt_audience,
            issuer=issuer,
            options=options,
        )

    signing_key = _jwks_client(settings.supabase_url).get_signing_key_from_jwt(token)
    return jwt.decode(
        token,
        signing_key.key,
        algorithms=["RS256", "ES256"],
        audience=settings.supabase_jwt_audience,
        issuer=issuer,
        options=options,
    )


async def current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer),
    settings: Settings = Depends(get_settings),
) -> AuthenticatedUser:
    if not settings.supabase_url:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication is not configured",
        )
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        claims = _decode_token(credentials.credentials, settings)
    except (jwt.PyJWTError, jwt.PyJWKClientError) as error:
        # Projects can temporarily use legacy-signed access tokens alongside
        # modern sb_secret API keys. Ask Supabase Auth to validate the user's
        # bearer token rather than weakening signature verification locally.
        if not settings.supabase_service_role_key:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired access token",
                headers={"WWW-Authenticate": "Bearer"},
            ) from error
        async with httpx.AsyncClient(timeout=10) as client:
            response = await client.get(
                f"{settings.supabase_url.rstrip('/')}/auth/v1/user",
                headers={
                    "apikey": settings.supabase_service_role_key,
                    "Authorization": f"Bearer {credentials.credentials}",
                },
            )
        if response.status_code != 200:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid or expired access token",
                headers={"WWW-Authenticate": "Bearer"},
            ) from error
        auth_user = response.json()
        return AuthenticatedUser(
            id=auth_user["id"],
            email=auth_user.get("email"),
            token_role=auth_user.get("role", "authenticated"),
        )

    return AuthenticatedUser(
        id=claims["sub"],
        email=claims.get("email"),
        token_role=claims.get("role", "authenticated"),
    )
