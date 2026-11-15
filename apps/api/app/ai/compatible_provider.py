import json

from openai import AsyncOpenAI
from openai.lib._pydantic import to_strict_json_schema

from app.ai.contracts import AITier
from app.ai.provider import AIProvider, OutputT


class OpenAICompatibleProvider(AIProvider):
    """Adapter for vLLM and other servers implementing Chat Completions JSON Schema."""

    def __init__(self, *, model: str, base_url: str, api_key: str = "local") -> None:
        self._model = model
        self._client = AsyncOpenAI(api_key=api_key, base_url=base_url)

    async def generate_structured(
        self,
        *,
        tier: AITier,
        system_prompt: str,
        user_prompt: str,
        output_type: type[OutputT],
    ) -> OutputT:
        del tier
        response = await self._client.chat.completions.create(
            model=self._model,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            response_format={
                "type": "json_schema",
                "json_schema": {
                    "name": output_type.__name__,
                    "strict": True,
                    "schema": to_strict_json_schema(output_type),
                },
            },
        )
        content = response.choices[0].message.content
        if not content:
            raise RuntimeError("The local model returned an empty structured result")
        return output_type.model_validate(json.loads(content))
