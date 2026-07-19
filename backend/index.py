import time
import re
import asyncio
from collections import defaultdict

from rag import get_conn, get_embedding, cosine_similarity, RAGPipeline

_pipeline = RAGPipeline()


def _all_chunks_balanced(chunks_per_file: int = 3) -> list[dict]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT filename, chunk_index, content
                FROM (
                    SELECT filename, chunk_index, content,
                           ROW_NUMBER() OVER (PARTITION BY filename ORDER BY chunk_index) as rn
                    FROM document_chunks
                    WHERE source_type != 'pending'
                ) ranked
                WHERE rn <= %s
                ORDER BY filename, chunk_index
            """, (chunks_per_file,))
            rows = cur.fetchall()
    return [{"filename": r[0], "chunk_index": r[1], "content": r[2]} for r in rows]


def _build_prompt(query: str, chunks: list[dict]) -> str:
    context = "\n\n".join(
        f"[Файл: {c['filename']} | Чанк: {c['chunk_index']} | Схожесть: {c.get('similarity', 0)}]\n{c['content']}"
        for c in chunks
    )
    return (
        f"ОТВЕЧАЙ ТОЛЬКО НА РУССКОМ ЯЗЫКЕ. НИ ОДНОГО СЛОВА НА ДРУГОМ ЯЗЫКЕ.\n\n"
        f"Ты — умный ИИ-ассистент. Отвечай на вопрос пользователя РАЗВЁРНУТО и ОСМЫСЛЕННО.\n\n"
        f"ВАЖНО:\n"
        f"- В КОНЦЕ ответа ОБЯЗАТЕЛЬНО перечисли ИСТОЧНИКИ: файлы, из которых взята информация\n"
        f"- Формат источников: `📄 НазваниеФайла (схожесть: X%)`\n"
        f"- Анализируй СОДЕРЖИМОЕ документов и давай умный ответ\n"
        f"- Отвечай ТОЛЬКО на русском языке\n"
        f"ОТВЕЧАЙ ТОЛЬКО НА РУССКОМ ЯЗЫКЕ. НИ ОДНОГО СЛОВА НА ДРУГОМ ЯЗЫКЕ.\n\n"
        f"- Используй Markdown: **жирный**, ## заголовки, - списки\n"
        f"- Если ответа нет в документах — честно скажи: 'В загруженных документах нет информации по этому запросу'\n"
        f"- НИКОГДА не выдумывай информацию которой нет в документах выше\n"
        f"- НЕ используй свои общие знания — только то что написано в документах\n"
        f"=== СОДЕРЖИМОЕ ДОКУМЕНТОВ ===\n{context}\n\n"
        f"=== ВОПРОС ПОЛЬЗОВАТЕЛЯ ===\n{query}\n\n"
        f"=== ТВОЙ ОТВЕТ НА РУССКОМ ЯЗЫКЕ ==="
    )


class VectorIndex:
    async def query(self, query: str, top_k: int = 5, user_id: int = 0) -> dict:
        t0 = time.perf_counter()
        chunks = await _pipeline.retrieve(query, top_k, user_id)

        if not chunks:
            return {"answer": "Документы не найдены.", "sources": [],
                    "index_type": "vector", "latency_ms": 0, "cosine_similarity": 0.0}

        prompt  = _build_prompt(query, chunks)
        answer  = await _pipeline.generate(prompt)
        score   = await _pipeline.evaluate(query, answer)
        latency = round((time.perf_counter() - t0) * 1000)
        sources = [{"filename": c["filename"], "chunk_index": c["chunk_index"],
                    "similarity": c["similarity"], "content": c["content"][:1500]} for c in chunks]
        return {"answer": answer, "sources": sources, "index_type": "vector",
                "latency_ms": latency, "cosine_similarity": score}


class TreeIndex:
    async def query(self, query: str, top_k: int = 5, user_id: int = 0) -> dict:
        t0 = time.perf_counter()

        # Векторный поиск с запасом
        chunks = await _pipeline.retrieve(query, top_k * 3, user_id)
        if not chunks:
            return {"answer": "Документы не найдены.", "sources": [],
                    "index_type": "tree", "latency_ms": 0, "cosine_similarity": 0.0}

        # Лучший чанк из каждого файла — иерархия по файлам
        by_doc: dict[str, dict] = {}
        for c in chunks:
            fn = c["filename"]
            if fn not in by_doc or c["similarity"] > by_doc[fn]["similarity"]:
                by_doc[fn] = c

        top     = sorted(by_doc.values(), key=lambda x: x["similarity"], reverse=True)[:top_k]
        prompt  = _build_prompt(query, top)
        answer  = await _pipeline.generate(prompt)
        score   = await _pipeline.evaluate(query, answer)
        latency = round((time.perf_counter() - t0) * 1000)
        sources = [{"filename": c["filename"], "chunk_index": c["chunk_index"],
                    "similarity": c["similarity"], "content": c["content"][:1500]} for c in top]
        return {"answer": answer, "sources": sources, "index_type": "tree",
                "latency_ms": latency, "cosine_similarity": score}


class ListIndex:
    async def query(self, query: str, top_k: int = 5, user_id: int = 0) -> dict:
        t0 = time.perf_counter()

        # Равномерно по 2 чанка из каждого файла
        all_chunks = _all_chunks_balanced(chunks_per_file=2)
        if not all_chunks:
            return {"answer": "Документы не найдены.", "sources": [],
                    "index_type": "list", "latency_ms": 0, "cosine_similarity": 0.0}

        query_emb = await get_embedding(query)

        # Все embeddings параллельно
        sem = asyncio.Semaphore(10)
        async def embed_one(c):
            async with sem:
                emb = await get_embedding(c["content"])
                sim = cosine_similarity(query_emb, emb)
                return {**c, "similarity": round(sim, 4)}

        scored  = await asyncio.gather(*[embed_one(c) for c in all_chunks])
        scored  = sorted(scored, key=lambda x: x["similarity"], reverse=True)
        top     = scored[:top_k]

        prompt  = _build_prompt(query, top)
        answer  = await _pipeline.generate(prompt)
        score   = await _pipeline.evaluate(query, answer)
        latency = round((time.perf_counter() - t0) * 1000)
        sources = [{"filename": c["filename"], "chunk_index": c["chunk_index"],
                    "similarity": c["similarity"], "content": c["content"][:1500]} for c in top]
        return {"answer": answer, "sources": sources, "index_type": "list",
                "latency_ms": latency, "cosine_similarity": score}


class KeywordTableIndex:
    def _build_index(self, chunks: list[dict]) -> dict[str, list[dict]]:
        index: dict[str, list[dict]] = defaultdict(list)
        for c in chunks:
            words = set(re.findall(r"[a-zA-Zа-яА-ЯёЁ0-9]{2,}", c["content"].lower()))
            for word in words:
                index[word].append(c)
        return index

    async def query(self, query: str, top_k: int = 5, user_id: int = 0) -> dict:
        t0 = time.perf_counter()

        # Равномерно по 3 чанка из каждого файла
        all_chunks = _all_chunks_balanced(chunks_per_file=3)
        if not all_chunks:
            return {"answer": "Документы не найдены.", "sources": [],
                    "index_type": "keyword", "latency_ms": 0, "cosine_similarity": 0.0}

        index    = self._build_index(all_chunks)
        keywords = set(re.findall(r"[a-zA-Zа-яА-ЯёЁ0-9]{2,}", query.lower()))

        scores: dict[tuple, dict] = {}
        for kw in keywords:
            for index_word, chunks in index.items():
                if kw in index_word or index_word in kw:
                    for chunk in chunks:
                        key = (chunk["filename"], chunk["chunk_index"])
                        if key not in scores:
                            scores[key] = {**chunk, "score": 0}
                        scores[key]["score"] += 1

        ranked = sorted(scores.values(), key=lambda x: x["score"], reverse=True)[:top_k]

        if not ranked:
            # Fallback на векторный поиск
            fallback = await _pipeline.retrieve(query, top_k, 0)
            if not fallback:
                return {"answer": "Ничего не найдено по ключевым словам.", "sources": [],
                        "index_type": "keyword",
                        "latency_ms": round((time.perf_counter() - t0) * 1000),
                        "cosine_similarity": 0.0}
            ranked = fallback
        else:
            for r in ranked:
                r["similarity"] = round(r["score"] / max(len(keywords), 1), 4)

        prompt  = _build_prompt(query, ranked)
        answer  = await _pipeline.generate(prompt)
        score   = await _pipeline.evaluate(query, answer)
        latency = round((time.perf_counter() - t0) * 1000)
        sources = [{"filename": c["filename"], "chunk_index": c["chunk_index"],
                    "similarity": c.get("similarity", 0), "content": c.get("content", "")[:1500]} for c in ranked]
        return {"answer": answer, "sources": sources, "index_type": "keyword",
                "latency_ms": latency, "cosine_similarity": score}


async def compare_indexes(query: str, top_k: int = 3, user_id: int = 0) -> dict:
    results = {}
    for name, idx in [("vector", VectorIndex()), ("keyword", KeywordTableIndex())]:
        results[name] = await idx.query(query, top_k, user_id)
    best = max(results, key=lambda k: results[k]["cosine_similarity"])
    return {"query": query, "results": results, "best_index": best}


vector_index  = VectorIndex()
tree_index    = TreeIndex()
list_index    = ListIndex()
keyword_index = KeywordTableIndex()