from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "EduBridge AI API"
    environment: Literal["development", "test", "staging", "production"] = "development"
    web_origin: str = "http://localhost:5173"
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/edubridge"
    supabase_url: str = ""
    supabase_service_role_key: str = Field(default="", repr=False)
    supabase_jwt_secret: str = ""
    supabase_jwt_audience: str = "authenticated"

    ai_tier1_provider: Literal["openai", "azure_openai", "openai_compatible"] = "openai"
    ai_tier1_model: str = ""
    ai_tier1_base_url: str | None = None
    ai_tier2_provider: Literal["openai", "azure_openai", "openai_compatible"] = "openai"
    ai_tier2_model: str = ""
    ai_tier2_base_url: str | None = None
    openai_api_key: str = Field(default="", repr=False)
    embedding_model: str = "text-embedding-3-small"
    embedding_provider: Literal["openai", "azure_openai"] = "openai"
    tutor_min_similarity: float = Field(default=0.30, ge=0, le=1)
    azure_openai_endpoint: str = ""
    azure_openai_api_key: str = Field(default="", repr=False)
    azure_openai_api_version: str = "2024-10-21"
    azure_openai_embedding_deployment: str = ""
    azure_openai_tier1_deployment: str = ""
    azure_openai_tier2_deployment: str = ""
    azure_openai_transcription_endpoint: str = ""
    azure_openai_transcription_api_key: str = Field(default="", repr=False)
    azure_openai_transcription_deployment: str = ""
    local_ai_api_key: str = Field(default="local", repr=False)

    @property
    def is_production(self) -> bool:
        return self.environment == "production"


@lru_cache
def get_settings() -> Settings:
    return Settings()
