from abc import ABC, abstractmethod
from typing import TypeVar

from pydantic import BaseModel

from app.ai.contracts import AITier

OutputT = TypeVar("OutputT", bound=BaseModel)


class AIProvider(ABC):
    """A small boundary that permits hosted and self-hosted model backends."""

    @abstractmethod
    async def generate_structured(
        self,
        *,
        tier: AITier,
        system_prompt: str,
        user_prompt: str,
        output_type: type[OutputT],
    ) -> OutputT:
        raise NotImplementedError

