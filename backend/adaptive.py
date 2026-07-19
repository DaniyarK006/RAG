import time
import httpx
from rag import get_conn, get_embedding, cosine_similarity, RAGPipeline, OLLAMA_URL, LLM_MODEL

_pipeline = RAGPipeline()


def init_adaptive_tables():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS adaptive_feedback (
                    id serial PRIMARY KEY,
                    query text,
                    answer text,
                    index_type text,
                    top_k int,
                    cosine_similarity float,
                    expert_score int,
                    expert_comment text,
                    latency_ms int,
                    created_at timestamp DEFAULT now()
                );
            """)
            cur.execute("""
                CREATE TABLE IF NOT EXISTS query_history (
                    id serial PRIMARY KEY,
                    query text,
                    index_type text,
                    top_k int,
                    cosine_similarity float,
                    latency_ms int,
                    created_at timestamp DEFAULT now()
                );
            """)
        conn.commit()


class AdaptiveRetriever:

    DEFAULT_TOP_K = 5
    MIN_TOP_K     = 3
    MAX_TOP_K     = 10

    def _avg_score(self, index_type: str) -> float | None:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT AVG(expert_score) FROM adaptive_feedback
                    WHERE index_type = %s AND expert_score IS NOT NULL
                """, (index_type,))
                val = cur.fetchone()[0]
        return float(val) if val is not None else None

    def _top_k(self, avg: float | None) -> int:
        if avg is None:
            return self.DEFAULT_TOP_K
        if avg >= 4.0:
            return self.MIN_TOP_K
        if avg <= 2.0:
            return self.MAX_TOP_K
        return round(self.DEFAULT_TOP_K + (2.0 - avg) * 2)

    async def retrieve(self, query: str, index_type: str) -> tuple[list[dict], int]:
        top_k  = self._top_k(self._avg_score(index_type))
        chunks = await _pipeline.retrieve(query, top_k)
        return chunks, top_k


class AdaptiveGenerator:

    BASE_TEMP = 0.1
    MAX_TEMP  = 0.7

    def _variance(self, index_type: str) -> float | None:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT VARIANCE(expert_score) FROM adaptive_feedback
                    WHERE index_type = %s AND expert_score IS NOT NULL
                """, (index_type,))
                val = cur.fetchone()[0]
        return float(val) if val is not None else None

    def _temperature(self, variance: float | None) -> float:
        if variance is None:
            return self.BASE_TEMP
        return round(self.BASE_TEMP + min(variance * 0.15, self.MAX_TEMP - self.BASE_TEMP), 2)

    async def generate(self, prompt: str, index_type: str) -> tuple[str, float]:
        temperature = self._temperature(self._variance(index_type))
        async with httpx.AsyncClient(timeout=120) as client:
            res = await client.post(f"{OLLAMA_URL}/api/generate", json={
                "model": LLM_MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": temperature, "num_predict": 600},
            })
            res.raise_for_status()
        return res.json()["response"].strip(), temperature


class AdaptiveEvaluator:

    def save_result(self, query: str, index_type: str, top_k: int, cosine: float, latency: int) -> int:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO query_history (query, index_type, top_k, cosine_similarity, latency_ms)
                    VALUES (%s, %s, %s, %s, %s) RETURNING id
                """, (query, index_type, top_k, cosine, latency))
                row_id = cur.fetchone()[0]
            conn.commit()
        return row_id

    def save_feedback(self, query: str, answer: str, index_type: str,
                      top_k: int, cosine: float, latency: int,
                      expert_score: int, expert_comment: str = ""):
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    INSERT INTO adaptive_feedback
                        (query, answer, index_type, top_k, cosine_similarity, expert_score, expert_comment, latency_ms)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """, (query, answer, index_type, top_k, cosine, expert_score, expert_comment, latency))
            conn.commit()

    def best_index(self) -> str:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT index_type FROM adaptive_feedback
                    WHERE expert_score IS NOT NULL
                    GROUP BY index_type
                    HAVING COUNT(*) >= 3
                    ORDER BY AVG(expert_score) DESC
                    LIMIT 1
                """)
                row = cur.fetchone()
        return row[0] if row else "vector"

    def stats(self) -> dict:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT index_type,
                           ROUND(AVG(expert_score)::numeric, 2),
                           ROUND(AVG(cosine_similarity)::numeric, 4),
                           ROUND(AVG(latency_ms)::numeric, 0),
                           COUNT(*)
                    FROM adaptive_feedback
                    WHERE expert_score IS NOT NULL
                    GROUP BY index_type
                    ORDER BY AVG(expert_score) DESC
                """)
                rows = cur.fetchall()
                cur.execute("SELECT COUNT(*) FROM query_history")
                total = cur.fetchone()[0]
        return {
            "total_queries": total,
            "best_index": self.best_index(),
            "by_index": [
                {
                    "index_type":       r[0],
                    "avg_expert_score": float(r[1]) if r[1] else None,
                    "avg_cosine":       float(r[2]) if r[2] else None,
                    "avg_latency_ms":   float(r[3]) if r[3] else None,
                    "total_feedback":   r[4],
                }
                for r in rows
            ],
        }


class AdaptiveRAG:

    def __init__(self):
        self.retriever = AdaptiveRetriever()
        self.generator = AdaptiveGenerator()
        self.evaluator = AdaptiveEvaluator()

    async def run(self, query: str, index_type: str = "auto") -> dict:
        if index_type == "auto":
            index_type = self.evaluator.best_index()

        t0 = time.perf_counter()
        chunks, top_k = await self.retriever.retrieve(query, index_type)

        if not chunks:
            return {
                "query":            query,
                "answer":           "Документы не найдены в базе.",
                "sources":          [],
                "index_type":       index_type,
                "top_k":            top_k,
                "cosine_similarity": 0.0,
                "temperature":      self.generator.BASE_TEMP,
                "latency_ms":       0,
            }

        context = "\n\n".join(
            f"[Файл: {c['filename']} | Чанк: {c['chunk_index']} | Схожесть: {c['similarity']}]\n{c['content']}"
            for c in chunks
        )

        # ── ИСПРАВЛЕНО: жёсткий grounding-промпт, запрещающий домысливание ──
        prompt = (
            f"Ты — умный ИИ-ассистент базы знаний. Отвечай на вопрос пользователя РАЗВЁРНУТО и ОСМЫСЛЕННО,\n"
            f"но СТРОГО НА ОСНОВЕ приведённого ниже содержимого документов.\n\n"
            f"ЖЁСТКИЕ ПРАВИЛА:\n"
            f"1. Используй ТОЛЬКО факты, термины, названия и цифры, которые есть в разделе '=== СОДЕРЖИМОЕ ДОКУМЕНТОВ ==='.\n"
            f"2. ЗАПРЕЩЕНО добавлять любую информацию из общих знаний — даже если она кажется уместной или общеизвестной.\n"
            f"3. Если в содержимом документов нет ответа на вопрос (полностью или частично) — прямо напиши:\n"
            f"   'В загруженных документах нет информации об этом' и НЕ добавляй ничего от себя после этой фразы.\n"
            f"4. Не пиши фразы вида 'на практике часто используют...', 'обычно применяют...' — это признак домысливания, а не ответа по документам.\n"
            f"5. НЕ перечисляй файлы и схожесть — пользователю это не нужно\n"
            f"6. Отвечай на русском языке\n"
            f"ОТВЕЧАЙ ТОЛЬКО НА РУССКОМ ЯЗЫКЕ. НИ ОДНОГО СЛОВА НА ДРУГОМ ЯЗЫКЕ.\n\n"
            f"7. Используй Markdown: **жирный**, ## заголовки, - списки\n\n"
            f"=== СОДЕРЖИМОЕ ДОКУМЕНТОВ ===\n{context}\n\n"
            f"=== ВОПРОС ПОЛЬЗОВАТЕЛЯ ===\n{query}\n\n"
            f"=== ТВОЙ ОТВЕТ (только на основе документов выше) ==="
        )

        answer, temp    = await self.generator.generate(prompt, index_type)
        cosine          = await _pipeline.evaluate(query, answer)
        latency         = round((time.perf_counter() - t0) * 1000)

        self.evaluator.save_result(query, index_type, top_k, cosine, latency)

        return {
            "query":             query,
            "answer":            answer,
            "sources":           [{"filename": c["filename"], "chunk_index": c["chunk_index"], "similarity": c["similarity"]} for c in chunks],
            "index_type":        index_type,
            "top_k":             top_k,
            "cosine_similarity": cosine,
            "temperature":       temp,
            "latency_ms":        latency,
        }


adaptive_rag = AdaptiveRAG()