from openai import AsyncAzureOpenAI, AsyncOpenAI

from app.config import Settings


def normalize_azure_endpoint(endpoint: str) -> str:
    return endpoint.strip().split("/openai", 1)[0].rstrip("/")


def embedding_client(settings: Settings) -> tuple[AsyncOpenAI, str] | None:
    if settings.embedding_provider == "azure_openai":
        if not (
            settings.azure_openai_endpoint
            and settings.azure_openai_api_key
            and settings.azure_openai_embedding_deployment
        ):
            return None
        return (
            AsyncAzureOpenAI(
                azure_endpoint=normalize_azure_endpoint(settings.azure_openai_endpoint),
                api_key=settings.azure_openai_api_key,
                api_version=settings.azure_openai_api_version,
            ),
            settings.azure_openai_embedding_deployment,
        )
    if not settings.openai_api_key:
        return None
    return AsyncOpenAI(api_key=settings.openai_api_key), settings.embedding_model
