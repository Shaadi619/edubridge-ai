from fastapi import APIRouter, Depends

from app.auth import AuthenticatedUser, current_user

router = APIRouter(prefix="/me", tags=["account"])


@router.get("")
async def me(user: AuthenticatedUser = Depends(current_user)) -> dict[str, str | None]:
    return {"id": user.id, "email": user.email, "role": user.token_role}
