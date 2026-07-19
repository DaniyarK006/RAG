import httpx
import psycopg2
import os
import io
import numpy as np
import asyncio
import logging
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

OLLAMA_URL    = os.getenv("OLLAMA_URL",  "http://localhost:11434")
EMBED_MODEL   = os.getenv("EMBED_MODEL", "bge-m3:latest")
LLM_MODEL     = os.getenv("LLM_MODEL",  "qwen2.5:7b")
CHUNK_SIZE    = 800
CHUNK_OVERLAP = 100
EMBEDDING_DIM = 1024

DB_CONFIG = {
    "host":     os.getenv("PG_HOST",     "127.0.0.1"),
    "port":     int(os.getenv("PG_PORT", 5433)),
    "user":     os.getenv("PG_USER",     "postgres"),
    "password": os.getenv("PG_PASSWORD", "mysecurepassword123"),
    "database": os.getenv("PG_DB",       "offline_db"),
}


def get_conn():
    conn = psycopg2.connect(**DB_CONFIG)
    conn.autocommit = False
    return conn


def init_vector_table():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS document_chunks (
                    id          serial PRIMARY KEY,
                    user_id     integer DEFAULT 0,
                    filename    text,
                    chunk_index int,
                    content     text,
                    embedding   vector({EMBEDDING_DIM}),
                    source_type text DEFAULT 'text'
                );
            """)
            cur.execute("ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS user_id integer DEFAULT 0;")
            cur.execute("ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'text';")
            cur.execute("CREATE INDEX IF NOT EXISTS idx_chunks_user ON document_chunks (user_id);")
        conn.commit()


def extract_text(filename: str, content: bytes) -> str:
    ext = filename.rsplit(".", 1)[-1].lower()
    if ext == "pdf":
        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(content))
            text = "\n".join(page.extract_text() or "" for page in reader.pages)
            # Remove null bytes and other non-printable characters
            return "".join(char for char in text if char.isprintable() or char in ['\n', '\t', ' '])
        except ImportError:
            pass
    if ext in ("docx", "doc"):
        try:
            import docx
            doc = docx.Document(io.BytesIO(content))
            return "\n".join(p.text for p in doc.paragraphs)
        except ImportError:
            pass
    if ext == "xlsx":
        max_rows  = int(os.getenv("XLSX_MAX_ROWS_PER_SHEET", "50"))
        max_cells = int(os.getenv("XLSX_MAX_TOTAL_CELLS",    "5000"))
        import openpyxl
        wb    = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        parts = []
        total = 0
        for sheet in wb.worksheets:
            parts.append(f"\n=== XLSX sheet: {getattr(sheet, 'title', 'Sheet')} ===")
            for idx, row in enumerate(sheet.iter_rows(values_only=True), 1):
                if idx > max_rows:
                    break
                cells = ["" if c is None else str(c) for c in row]
                if not any(c.strip() for c in cells):
                    continue
                total += len(cells)
                if total > max_cells:
                    parts.append("\n[... XLSX truncated ...]")
                    return "\n".join(parts).strip()
                parts.append("\t".join(cells).rstrip("\t"))
        return "\n".join(parts).strip()
    return content.decode("utf-8", errors="ignore")


def split_text(text: str) -> list[str]:
    chunks, start = [], 0
    while start < len(text):
        chunks.append(text[start:start + CHUNK_SIZE].strip())
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return [c for c in chunks if c]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    va, vb = np.array(a), np.array(b)
    return float(np.dot(va, vb) / (np.linalg.norm(va) * np.linalg.norm(vb) + 1e-10))


def get_all_files_info(user_id: int = 0) -> list[dict]:
    with get_conn() as conn:
        with conn.cursor() as cur:
            if user_id > 0:
                cur.execute("""
                    SELECT filename, COUNT(*) as chunk_count, source_type
                    FROM document_chunks
                    WHERE user_id = %s AND source_type != 'pending'
                    GROUP BY filename, source_type
                    ORDER BY filename
                """, (user_id,))
            else:
                cur.execute("""
                    SELECT filename, COUNT(*) as chunk_count, source_type
                    FROM document_chunks
                    WHERE source_type != 'pending'
                    GROUP BY filename, source_type
                    ORDER BY filename
                """)
            rows = cur.fetchall()
    return [{"filename": r[0], "chunk_count": r[1], "source_type": r[2]} for r in rows]


async def check_ollama_health() -> tuple[bool, str]:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            res = await client.get(f"{OLLAMA_URL}/api/tags")
            if res.status_code != 200:
                return False, f"Ollama returned status {res.status_code}"
            models      = res.json().get("models", [])
            model_names = [m.get("name", "") for m in models]
            if EMBED_MODEL not in model_names and not any(EMBED_MODEL in m for m in model_names):
                return False, f"Model '{EMBED_MODEL}' not found. Run: ollama pull {EMBED_MODEL}"
            return True, "ok"
    except httpx.ConnectError:
        return False, f"Cannot connect to Ollama at {OLLAMA_URL}"
    except Exception as e:
        return False, str(e)


async def get_embedding(text: str) -> list[float]:
    async with httpx.AsyncClient(timeout=60) as client:
        res = await client.post(f"{OLLAMA_URL}/api/embeddings", json={
            "model": EMBED_MODEL,
            "prompt": text,
        })
        res.raise_for_status()
        emb = res.json().get("embedding")
        if not emb:
            raise ValueError("Empty embedding returned")
        return emb


def rerank_chunks(chunks: list[dict]) -> list[dict]:
    if not chunks:
        return chunks
    counts: dict[str, int] = {}
    for c in chunks:
        counts[c["filename"]] = counts.get(c["filename"], 0) + 1
    top = max(counts, key=counts.get)
    out = []
    for c in chunks:
        bonus = 0.05 if c["filename"] == top else 0.0
        out.append({**c, "rerank_score": round(c["similarity"] + bonus, 4)})
    out.sort(key=lambda x: x["rerank_score"], reverse=True)
    return out


def diverse_retrieve(all_chunks: list[dict], top_k: int) -> list[dict]:
    """Берёт лучший чанк из каждого файла, потом добирает до top_k."""
    best_per_file: dict[str, dict] = {}
    for c in all_chunks:
        fn = c["filename"]
        if fn not in best_per_file or c["similarity"] > best_per_file[fn]["similarity"]:
            best_per_file[fn] = c
    diverse = sorted(best_per_file.values(), key=lambda x: x["similarity"], reverse=True)
    if len(diverse) < top_k:
        used = {(c["filename"], c["chunk_index"]) for c in diverse}
        for c in all_chunks:
            key = (c["filename"], c["chunk_index"])
            if key not in used:
                diverse.append(c)
                used.add(key)
            if len(diverse) >= top_k:
                break
    return diverse[:top_k]


class RAGPipeline:

    def prepare(self, filename: str, content: bytes) -> list[str]:
        return split_text(extract_text(filename, content))

    async def embed(self, chunks: list[str]) -> list[list[float]]:
        # High parallelism for fast embedding generation
        sem = asyncio.Semaphore(20)
        async def embed_one(chunk):
            async with sem:
                return await get_embedding(chunk)
        return await asyncio.gather(*[embed_one(c) for c in chunks])

    async def store(self, filename: str, chunks: list[str],
                    embeddings: list[list[float]],
                    user_id: int = 0, source_type: str = "text") -> int:
        init_vector_table()
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM document_chunks WHERE filename = %s AND user_id = %s",
                    (filename, user_id)
                )
                for i, (chunk, emb) in enumerate(zip(chunks, embeddings)):
                    cur.execute(
                        "INSERT INTO document_chunks "
                        "(user_id, filename, chunk_index, content, embedding, source_type) "
                        "VALUES (%s, %s, %s, %s, %s, %s)",
                        (user_id, filename, i, chunk, emb, source_type)
                    )
            conn.commit()
        return len(chunks)

    async def store_fast(self, filename: str, chunks: list[str],
                         user_id: int = 0, source_type: str = "text") -> int:
        """Store chunks immediately without embeddings for instant availability."""
        init_vector_table()
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "DELETE FROM document_chunks WHERE filename = %s",
                    (filename,)
                )
                deleted = cur.rowcount
                logger.info(f"Deleted {deleted} old chunks for {filename}")
                
                # Insert new chunks
                for i, chunk in enumerate(chunks):
                    # Clean chunk: remove null bytes and other problematic characters
                    clean_chunk = "".join(char for char in chunk if char.isprintable() or char in ['\n', '\t', ' '])
                    cur.execute(
                        "INSERT INTO document_chunks "
                        "(user_id, filename, chunk_index, content, embedding, source_type) "
                        "VALUES (%s, %s, %s, %s, %s, %s)",
                        (user_id, filename, i, clean_chunk, None, source_type)
                    )
            conn.commit()
        return len(chunks)

    async def retrieve(self, query: str, top_k: int = 10, user_id: int = 0) -> list[dict]:
        # Get query embedding vector
        emb = await get_embedding(query)
        fetch_k = max(top_k * 6, 60)
        
        with get_conn() as conn:
            with conn.cursor() as cur:
                if user_id > 0:
                    cur.execute("""
                        SELECT filename, chunk_index, content, source_type,
                               1 - (embedding <=> %s::vector) AS similarity
                        FROM document_chunks
                        WHERE user_id = %s AND embedding IS NOT NULL
                        ORDER BY embedding <=> %s::vector
                        LIMIT %s
                    """, (emb, user_id, emb, fetch_k))
                else:
                    cur.execute("""
                        SELECT filename, chunk_index, content, source_type,
                               1 - (embedding <=> %s::vector) AS similarity
                        FROM document_chunks
                        WHERE embedding IS NOT NULL
                        ORDER BY embedding <=> %s::vector
                        LIMIT %s
                    """, (emb, emb, fetch_k))
                
                rows = cur.fetchall()
                
        if not rows:
            keywords = set(query.lower().split())
            with get_conn() as conn:
                with conn.cursor() as cur:
                    cur.execute("""
                        SELECT filename, chunk_index, content, source_type
                        FROM document_chunks
                        WHERE user_id = %s AND embedding IS NULL
                        LIMIT %s
                    """, (user_id, fetch_k))
                    rows = cur.fetchall()
            
            # Score by keyword overlap
            scored = []
            for r in rows:
                content_words = set(r[2].lower().split())
                score = len(keywords & content_words)
                if score > 0:
                    scored.append({
                        "filename": r[0], "chunk_index": r[1], "content": r[2],
                        "source_type": r[3], "similarity": min(score * 0.1, 0.5)
                    })
            scored.sort(key=lambda x: x["similarity"], reverse=True)
            # Apply RBAC filtering
            try:
                from rbac import rbac
                filtered = rbac.filter_chunks_by_user(scored, user_id)
                if not filtered:
                    return []
                scored = filtered
            except ImportError:
                pass
            return rerank_chunks(scored[:top_k])
        
        all_chunks = [
            {"filename": r[0], "chunk_index": r[1], "content": r[2],
             "source_type": r[3], "similarity": round(r[4], 4)}
            for r in rows
        ]
        diverse = diverse_retrieve(all_chunks, top_k)
        # Apply RBAC filtering
        try:
            from rbac import rbac
            filtered = rbac.filter_chunks_by_user(diverse, user_id)
            if not filtered:
                return []
            diverse = filtered
        except ImportError:
            pass
        return rerank_chunks(diverse)

    def augment_prompt(self, query: str, chunks: list[dict],
                       all_files: list[dict] = None,
                       total_docs: int = 0, total_chunks: int = 0) -> str:

        if all_files:
            files_list = "\n".join(
                f"  {i+1}. {f['filename']} ({f['chunk_count']} чанков, тип: {f['source_type']})"
                for i, f in enumerate(all_files)
            )
            system_context = (
                f"СПИСОК ФАЙЛОВ ({total_docs} файлов, {total_chunks} чанков) — используй этот список для ответа, не говори 'представлен выше':\n"
                f"{files_list}\n"
            )
        else:
            system_context = f"Всего файлов в базе: {total_docs} | Всего чанков: {total_chunks}\n"

        # Контекст из релевантных чанков
        context = "\n\n".join(
            f"[Файл: {c['filename']} | Чанк: {c['chunk_index']} | Схожесть: {c['similarity']}]\n{c['content']}"
            for c in chunks
        )

        return (
            f"Ты — умный ИИ-ассистент базы знаний DocRAG. Отвечай строго по документам.\n\n"
            f"ПРАВИЛА:\n"
            f"1. Отвечай ТОЛЬКО на основе документов. Если ответа нет — честно скажи.\n"
            f"2. НЕ выдумывай факты которых нет в документах.\n"
            f"3. Отвечай на русском языке, развёрнуто и по делу.\n"
            f"ОТВЕЧАЙ ТОЛЬКО НА РУССКОМ ЯЗЫКЕ. НИ ОДНОГО СЛОВА НА ДРУГОМ ЯЗЫКЕ.\n\n"
            f"4. Используй Markdown: **жирный**, ## заголовки, - списки.\n"
            f"5. Вопросы про количество или список файлов — отвечай по ПОЛНОМУ СПИСКУ выше.\n"
            f"6. НИКОГДА не пиши 'представлен выше', 'указан выше', 'см. выше' — всегда давай конкретный ответ.\n"
            f"7. При вопросе 'расскажи про каждый файл' — опиши КАЖДЫЙ файл из полного списка.\n\n"
            f"{'='*50}\n"
            f"{system_context}"
            f"{'='*50}\n\n"
            f"РЕЛЕВАНТНЫЕ ФРАГМЕНТЫ ПО ЗАПРОСУ:\n{context}\n\n"
            f"ВОПРОС ПОЛЬЗОВАТЕЛЯ: {query}\n\n"
            f"ОТВЕТ:"
        )

    async def generate(self, prompt: str) -> str:
        async with httpx.AsyncClient(timeout=180) as client:
            res = await client.post(f"{OLLAMA_URL}/api/generate", json={
                "model": LLM_MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.1,
                    "num_predict": 2048,
                    "top_p": 0.9,
                },
            })
            res.raise_for_status()
            return res.json()["response"].strip()

    async def evaluate(self, query: str, answer: str) -> float:
        try:
            q_emb = await get_embedding(query)
            a_emb = await get_embedding(answer)
            return round(cosine_similarity(q_emb, a_emb), 4)
        except Exception:
            return 0.0

    async def run(self, query: str, top_k: int = 10, user_id: int = 0) -> dict:
        greetings = ['привет', 'hello', 'hi', 'здравствуй', 'здравствуйте', 'добрый день', 'добрый вечер', 'доброе утро', 'хай', 'салют']
        if query.lower().strip().rstrip('!.,') in greetings:
            return {
                "query": query,
                "answer": "Привет! Я готов помочь. Задайте вопрос по документам из базы знаний — найду точный ответ с источниками.",
                "sources": [],
                "cosine_similarity": 1.0,
            }

        info      = vector_store_info(user_id)
        all_files = get_all_files_info(user_id)
        chunks    = await self.retrieve(query, top_k, user_id)

        if not chunks:
            return {
                "query":             query,
                "answer":            f"По вашему запросу ничего не найдено в базе знаний. Попробуйте переформулировать вопрос.",
                "sources":           [],
                "cosine_similarity": 0.0,
            }

        prompt = self.augment_prompt(
            query, chunks,
            all_files=all_files,
            total_docs=info["total_documents"],
            total_chunks=info["total_chunks"],
        )
        answer = await self.generate(prompt)
        score  = await self.evaluate(query, answer)

        return {
            "query":  query,
            "answer": answer,
            "sources": [
                {
                    "filename":     c["filename"],
                    "chunk_index":  c["chunk_index"],
                    "similarity":   c["similarity"],
                    "rerank_score": c.get("rerank_score"),
                }
                for c in chunks
        ],
            
            "source_chunks": [
                {
                    "filename":   c["filename"],
                    "content":    c["content"][:500],
                    "similarity": c["similarity"],
                }
                for c in chunks
        ],
            
        "cosine_similarity": score,
    }

pipeline = RAGPipeline()


async def ingest_document(filename: str, content: bytes, user_id: int = 0) -> int:
    ext         = filename.rsplit(".", 1)[-1].lower()
    source_type = ext if ext in ("pdf", "docx", "txt") else "text"
    chunks      = pipeline.prepare(filename, content)
    embeddings  = await pipeline.embed(chunks)
    return await pipeline.store(filename, chunks, embeddings, user_id, source_type)


async def search_documents(query: str, top_k: int = 10, user_id: int = 0) -> list[dict]:
    return await pipeline.retrieve(query, top_k, user_id)


async def generate_answer(query: str, top_k: int = 10, user_id: int = 0) -> dict:
    return await pipeline.run(query, top_k, user_id)


def simple_rag(query: str, top_k: int = 5, user_id: int = 0) -> list[dict]:
    # No valid user - return empty (orphaned files are hidden)
    if user_id <= 0:
        return []
    
    keywords = set(query.lower().split())
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT filename, chunk_index, content FROM document_chunks 
                WHERE user_id = %s
            """, (user_id,))
            rows = cur.fetchall()
    scored = [
        {"filename": fn, "chunk_index": ci, "content": ct,
         "score": len(keywords & set(ct.lower().split()))}
        for fn, ci, ct in rows
        if len(keywords & set(ct.lower().split())) > 0
    ]
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]


async def modular_rag(query: str, top_k: int = 5) -> list[dict]:
    keyword_results = simple_rag(query, top_k)
    vector_results  = await search_documents(query, top_k)
    seen, merged    = set(), []
    for r in keyword_results + vector_results:
        key = (r["filename"], r["chunk_index"])
        if key not in seen:
            seen.add(key)
            merged.append(r)
    return merged[:top_k]

def vector_store_info(user_id: int = 0) -> dict:
    with get_conn() as conn:
        with conn.cursor() as cur:
            if user_id > 0:
                cur.execute("SELECT COUNT(*) FROM document_chunks WHERE source_type != 'pending' AND user_id = %s", (user_id,))
                total_chunks = cur.fetchone()[0]
                cur.execute("SELECT COUNT(DISTINCT filename) FROM document_chunks WHERE source_type != 'pending' AND filename IS NOT NULL AND user_id = %s", (user_id,))
                total_docs = cur.fetchone()[0]
                cur.execute("SELECT source_type, COUNT(*) FROM document_chunks WHERE source_type != 'pending' AND user_id = %s GROUP BY source_type", (user_id,))
                by_type = {r[0]: r[1] for r in cur.fetchall()}
            else:
                cur.execute("SELECT COUNT(*) FROM document_chunks WHERE source_type != 'pending'")
                total_chunks = cur.fetchone()[0]
                cur.execute("SELECT COUNT(DISTINCT filename) FROM document_chunks WHERE source_type != 'pending' AND filename IS NOT NULL")
                total_docs = cur.fetchone()[0]
                cur.execute("SELECT source_type, COUNT(*) FROM document_chunks WHERE source_type != 'pending' GROUP BY source_type")
                by_type = {r[0]: r[1] for r in cur.fetchall()}
    return {
        "total_chunks":    total_chunks,
        "total_documents": total_docs,
        "embed_model":     EMBED_MODEL,
        "embedding_dim":   EMBEDDING_DIM,
        "by_source_type":  by_type,
    }