import asyncio

import httpx

from app.ai.embeddings import embedding_client
from app.config import get_settings


async def main() -> None:
    settings = get_settings()
    configured = embedding_client(settings)
    if not configured:
        raise RuntimeError("Embedding provider is not configured")
    embedding_api, embedding_model = configured
    key = settings.supabase_service_role_key
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    base = settings.supabase_url.rstrip("/")
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.get(
            f"{base}/rest/v1/material_chunks",
            headers=headers,
            params={"embedding": "is.null", "select": "id,content", "order": "created_at.asc"},
        )
        response.raise_for_status()
        chunks = response.json()
        updated = 0
        for start in range(0, len(chunks), 100):
            batch = chunks[start : start + 100]
            result = await embedding_api.embeddings.create(
                model=embedding_model,
                input=[chunk["content"] for chunk in batch],
                encoding_format="float",
            )
            vectors = [item.embedding for item in sorted(result.data, key=lambda item: item.index)]
            if any(len(vector) != 1536 for vector in vectors):
                raise RuntimeError("Embedding dimension mismatch")
            for chunk, vector in zip(batch, vectors, strict=True):
                update = await client.patch(
                    f"{base}/rest/v1/material_chunks?id=eq.{chunk['id']}",
                    headers=headers,
                    json={"embedding": vector},
                )
                update.raise_for_status()
                updated += 1
        print(f"BACKFILL_COMPLETE chunks={updated}")


if __name__ == "__main__":
    asyncio.run(main())
