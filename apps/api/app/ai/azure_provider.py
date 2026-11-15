import json

from openai import AsyncAzureOpenAI
from openai.lib._pydantic import to_strict_json_schema

from app.ai.contracts import AITier
from app.ai.embeddings import normalize_azure_endpoint
from app.ai.provider import AIProvider, OutputT


class AzureOpenAIProvider(AIProvider):
    """Azure OpenAI adapter using deployment names and structured Chat Completions."""

    def __init__(
        self,
        *,
        endpoint: str,
        api_key: str,
        api_version: str,
        fast_deployment: str,
        reasoning_deployment: str,
    ) -> None:
        self._deployments = {
            AITier.FAST: fast_deployment,
            AITier.REASONING: reasoning_deployment,
        }
        self._client = AsyncAzureOpenAI(
            azure_endpoint=normalize_azure_endpoint(endpoint),
            api_key=api_key,
            api_version=api_version,
        )

    async def generate_structured(
        self,
        *,
        tier: AITier,
        system_prompt: str,
        user_prompt: str,
        output_type: type[OutputT],
    ) -> OutputT:
        deployment = self._deployments[tier]
        if not deployment:
            raise RuntimeError(f"No Azure deployment configured for AI tier: {tier.value}")
        response = await self._client.chat.completions.create(
            model=deployment,
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
            raise RuntimeError("Azure OpenAI returned an empty structured result")
        return output_type.model_validate(json.loads(content))

    async def generate_structured_with_images(
        self,
        *,
        tier: AITier,
        system_prompt: str,
        user_prompt: str,
        image_data_urls: list[str],
        output_type: type[OutputT],
    ) -> OutputT:
        deployment = self._deployments[tier]
        if not deployment:
            raise RuntimeError(f"No Azure deployment configured for AI tier: {tier.value}")
        content_parts: list[dict] = [{"type": "text", "text": user_prompt}]
        content_parts.extend({"type": "image_url", "image_url": {"url": url, "detail": "high"}} for url in image_data_urls)
        response = await self._client.chat.completions.create(
            model=deployment,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": content_parts},
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
            raise RuntimeError("Azure OpenAI returned an empty structured result")
        return output_type.model_validate(json.loads(content))
