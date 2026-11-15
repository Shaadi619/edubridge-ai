from openai import AsyncOpenAI
from app.ai.contracts import AITier
from app.ai.provider import AIProvider, OutputT


class OpenAIProvider(AIProvider):
    """Native OpenAI Responses API adapter."""

    def __init__(
        self,
        *,
        fast_model: str,
        reasoning_model: str,
        api_key: str,
        fast_base_url: str | None = None,
        reasoning_base_url: str | None = None,
    ) -> None:
        self._models = {AITier.FAST: fast_model, AITier.REASONING: reasoning_model}
        self._clients = {
            AITier.FAST: AsyncOpenAI(api_key=api_key, base_url=fast_base_url),
            AITier.REASONING: AsyncOpenAI(api_key=api_key, base_url=reasoning_base_url),
        }

    async def generate_structured(
        self,
        *,
        tier: AITier,
        system_prompt: str,
        user_prompt: str,
        output_type: type[OutputT],
    ) -> OutputT:
        model = self._models[tier]
        if not model:
            raise RuntimeError(f"No model configured for AI tier: {tier.value}")

        response = await self._clients[tier].responses.parse(
            model=model,
            instructions=system_prompt,
            input=user_prompt,
            text_format=output_type,
        )
        if response.output_parsed is None:
            raise RuntimeError("The model did not return the required structured result")
        return response.output_parsed
