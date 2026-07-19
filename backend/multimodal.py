import base64
import httpx
import os
from rag import get_conn, get_embedding, cosine_similarity, RAGPipeline, OLLAMA_URL, LLM_MODEL

VISION_MODEL = os.getenv("VISION_MODEL", "llava:7b")

IMAGE_EXTS = {"jpg", "jpeg", "png", "gif", "bmp", "webp"}

_pipeline = RAGPipeline()


def is_image(filename: str) -> bool:
    return filename.rsplit(".", 1)[-1].lower() in IMAGE_EXTS


async def describe_image(image_bytes: bytes, filename: str) -> str:
    b64 = base64.b64encode(image_bytes).decode()
    async with httpx.AsyncClient(timeout=120) as client:
        res = await client.post(f"{OLLAMA_URL}/api/generate", json={
            "model": VISION_MODEL,
            "prompt": (
                "Describe this image in detail. "
                "Extract all visible text, objects, diagrams, charts, tables and their contents. "
                "Be thorough and precise."
            ),
            "images": [b64],
            "stream": False,
            "options": {"temperature": 0.1},
        })
        res.raise_for_status()
        return res.json()["response"].strip()


async def ingest_image(filename: str, image_bytes: bytes) -> dict:
    description = await describe_image(image_bytes, filename)
    embedding = await get_embedding(description)

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM document_chunks WHERE filename = %s", (filename,))
            cur.execute(
                "INSERT INTO document_chunks (filename, chunk_index, content, embedding, source_type) VALUES (%s, %s, %s, %s, %s)",
                (filename, 0, description, embedding, "image")
            )
        conn.commit()

    return {"filename": filename, "description": description, "chunks": 1}


async def multimodal_retrieve(query: str, top_k: int = 5) -> list[dict]:
    query_emb = await get_embedding(query)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT filename, chunk_index, content, source_type,
                       1 - (embedding <=> %s::vector) AS similarity
                FROM document_chunks
                ORDER BY embedding <=> %s::vector
                LIMIT %s
            """, (query_emb, query_emb, top_k))
            rows = cur.fetchall()
    return [
        {"filename": r[0], "chunk_index": r[1], "content": r[2], "source_type": r[3], "similarity": round(r[4], 4)}
        for r in rows
    ]


async def multimodal_answer(query: str, top_k: int = 5) -> dict:
    chunks = await multimodal_retrieve(query, top_k)
    if not chunks:
        return {"query": query, "answer": "Документы не найдены.", "sources": [], "cosine_similarity": 0.0}

    text_chunks  = [c for c in chunks if c["source_type"] != "image"]
    image_chunks = [c for c in chunks if c["source_type"] == "image"]

    context_parts = []
    for c in text_chunks:
        context_parts.append(f"[{c['filename']} | chunk {c['chunk_index']} | sim {c['similarity']}]\n{c['content']}")
    for c in image_chunks:
        context_parts.append(f"[IMAGE: {c['filename']} | sim {c['similarity']}]\nVisual description: {c['content']}")

    context = "\n\n".join(context_parts)
    prompt = (
        f"You have access to both text documents and image descriptions.\n"
        f"Use all available context to answer the question accurately.\n\n"
        f"=== Context ===\n{context}\n\n"
        f"=== Question ===\n{query}\n\n"
        f"=== Answer ==="
    )

    answer = await _pipeline.generate(prompt)
    score  = await _pipeline.evaluate(query, answer)
    sources = [{"filename": c["filename"], "chunk_index": c["chunk_index"], "similarity": c["similarity"], "source_type": c["source_type"]} for c in chunks]

    return {
        "query": query,
        "answer": answer,
        "sources": sources,
        "cosine_similarity": score,
        "text_sources": len(text_chunks),
        "image_sources": len(image_chunks),
    }


async def summarize_multimodal(chunks: list[dict]) -> str:
    text_parts  = [c["content"] for c in chunks if c["source_type"] != "image"]
    image_parts = [c["content"] for c in chunks if c["source_type"] == "image"]

    summary_prompt = "Summarize the following multimodal content concisely:\n\n"
    if text_parts:
        summary_prompt += "TEXT:\n" + "\n---\n".join(text_parts[:5]) + "\n\n"
    if image_parts:
        summary_prompt += "IMAGES:\n" + "\n---\n".join(image_parts[:3]) + "\n\n"
    summary_prompt += "Summary:"

    return await _pipeline.generate(summary_prompt)


async def get_dataset_stats() -> dict:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT source_type, COUNT(*), COUNT(DISTINCT filename) FROM document_chunks GROUP BY source_type")
            rows = cur.fetchall()

    stats = {}
    for source_type, chunks, docs in rows:
        stats[source_type] = {"chunks": chunks, "documents": docs}

    return {
        "modalities": stats,
        "total_chunks": sum(v["chunks"] for v in stats.values()),
        "total_documents": sum(v["documents"] for v in stats.values()),
        "vision_model": VISION_MODEL,
    }
