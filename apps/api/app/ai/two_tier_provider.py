from app.ai.contracts import AITier
from app.ai.provider import AIProvider, OutputT


class TwoTierAIProvider(AIProvider):
    def __init__(self, *, fast: AIProvider, reasoning: AIProvider) -> None:
        self._providers = {AITier.FAST: fast, AITier.REASONING: reasoning}

    async def generate_structured(
        self,
        *,
        tier: AITier,
        system_prompt: str,
        user_prompt: str,
        output_type: type[OutputT],
    ) -> OutputT:
        return await self._providers[tier].generate_structured(
            tier=tier,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            output_type=output_type,
        )

