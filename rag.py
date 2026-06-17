import httpx
import psycopg2
import os
import io
import numpy as np
import asyncio
from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
EMBED_MODEL = os.getenv("EMBED_MODEL", "nomic-embed-text")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen2.5-coder:7b")
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50

DB_CONFIG = {
    "host": os.getenv("PG_HOST", "127.0.0.1"),
    "port": int(os.getenv("PG_PORT", 5433)),
    "user": os.getenv("PG_USER", "postgres"),
    "password": os.getenv("PG_PASSWORD", "mysecurepassword123"),
    "database": os.getenv("PG_DB", "offline_db"),
}


def get_conn():
    conn = psycopg2.connect(**DB_CONFIG)
    conn.autocommit = False
    return conn


def init_vector_table():
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS document_chunks (
                    id serial PRIMARY KEY,
                    user_id integer DEFAULT 0,
                    filename text,
                    chunk_index int,
                    content text,
                    embedding vector(1536),
                    source_type text DEFAULT 'text'
                );
            """)
            cur.execute("ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS user_id integer DEFAULT 0;")
            cur.execute("ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS source_type text DEFAULT 'text';")
            cur.execute("""
                CREATE INDEX IF NOT EXISTS document_chunks_embedding_idx
                ON document_chunks USING ivfflat (embedding vector_cosine_ops)
                WITH (lists = 100);
            """)
            # Index for user-based queries
            cur.execute("CREATE INDEX IF NOT EXISTS idx_chunks_user ON document_chunks (user_id);")
        conn.commit()


def extract_text(filename: str, content: bytes) -> str:
    ext = filename.rsplit(".", 1)[-1].lower()

    if ext == "pdf":
        try:
            import pypdf
            reader = pypdf.PdfReader(io.BytesIO(content))
            return "\n".join(page.extract_text() or "" for page in reader.pages)
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
        max_rows_per_sheet = int(os.getenv("XLSX_MAX_ROWS_PER_SHEET", "50"))
        max_total_cells = int(os.getenv("XLSX_MAX_TOTAL_CELLS", "5000"))

        import openpyxl

        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        out_parts: list[str] = []
        total_cells = 0

        for sheet in wb.worksheets:
            sheet_title = getattr(sheet, "title", "Sheet")
            out_parts.append(f"\n=== XLSX sheet: {sheet_title} ===")

            for row_idx, row in enumerate(sheet.iter_rows(values_only=True), start=1):
                if row_idx > max_rows_per_sheet:
                    break

                cells = ["" if c is None else str(c) for c in row]
                if not any(c.strip() for c in cells):
                    continue

                total_cells += len(cells)
                if total_cells > max_total_cells:
                    out_parts.append("\n[... XLSX truncated: too many cells ...]")
                    return "\n".join(out_parts).strip()

                out_parts.append("\t".join(cells).rstrip("\t"))

        return "\n".join(out_parts).strip()

    return content.decode("utf-8")



def split_text(text: str) -> list[str]:
    chunks, start = [], 0
    while start < len(text):
        end = start + CHUNK_SIZE
        chunks.append(text[start:end].strip())
        start += CHUNK_SIZE - CHUNK_OVERLAP
    return [c for c in chunks if c]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    va, vb = np.array(a), np.array(b)
    return float(np.dot(va, vb) / (np.linalg.norm(va) * np.linalg.norm(vb) + 1e-10))


async def get_embedding(text: str) -> list[float]:
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post(f"{OLLAMA_URL}/api/embeddings", json={
            "model": EMBED_MODEL,
            "prompt": text,
        })
        res.raise_for_status()
        return res.json()["embedding"]


class RAGPipeline:

    def prepare(self, filename: str, content: bytes) -> list[str]:
        text = extract_text(filename, content)
        return split_text(text)

    async def embed(self, chunks: list[str]) -> list[list[float]]:
        """Parallel embedding — 5x-10x faster for multi-chunk documents."""
        sem = asyncio.Semaphore(5)  # max 5 concurrent Ollama requests
        async def embed_one(chunk):
            async with sem:
                return await get_embedding(chunk)
        tasks = [embed_one(c) for c in chunks]
        return await asyncio.gather(*tasks)

    async def store(self, filename: str, chunks: list[str], embeddings: list[list[float]], user_id: int = 0, source_type: str = "text") -> int:
        init_vector_table()
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM document_chunks WHERE filename = %s AND user_id = %s", (filename, user_id))
                for i, (chunk, emb) in enumerate(zip(chunks, embeddings)):
                    cur.execute(
                        "INSERT INTO document_chunks (user_id, filename, chunk_index, content, embedding, source_type) VALUES (%s, %s, %s, %s, %s, %s)",
                        (user_id, filename, i, chunk, emb, source_type)
                    )
            conn.commit()
        return len(chunks)

    async def retrieve(self, query: str, top_k: int = 5, user_id: int = 0) -> list[dict]:
        emb = await get_embedding(query)
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("""
                    SELECT filename, chunk_index, content, source_type,
                           1 - (embedding <=> %s::vector) AS similarity
                    FROM document_chunks
                    WHERE user_id = %s
                    ORDER BY embedding <=> %s::vector
                    LIMIT %s
                """, (emb, user_id, emb, top_k))
                rows = cur.fetchall()
        return [
            {"filename": r[0], "chunk_index": r[1], "content": r[2], "source_type": r[3], "similarity": round(r[4], 4)}
            for r in rows
        ]

    def augment_prompt(self, query: str, chunks: list[dict]) -> str:
        context = "\n\n".join(
            f"[{c['filename']} | chunk {c['chunk_index']} | similarity {c['similarity']}]\n{c['content']}"
            for c in chunks
        )
        return (
            f"Use the following document fragments to answer the question.\n"
            f"If the answer is not in the documents, say so honestly.\n\n"
            f"=== Context ===\n{context}\n\n"
            f"=== Question ===\n{query}\n\n"
            f"=== Answer ==="
        )

    async def generate(self, prompt: str) -> str:
        async with httpx.AsyncClient(timeout=120) as client:
            res = await client.post(f"{OLLAMA_URL}/api/generate", json={
                "model": LLM_MODEL,
                "prompt": prompt,
                "stream": False,
                "options": {"temperature": 0.1},
            })
            res.raise_for_status()
            return res.json()["response"].strip()

    async def evaluate(self, query: str, answer: str) -> float:
        q_emb = await get_embedding(query)
        a_emb = await get_embedding(answer)
        return round(cosine_similarity(q_emb, a_emb), 4)

    async def run(self, query: str, top_k: int = 5, user_id: int = 0) -> dict:
        chunks = await self.retrieve(query, top_k, user_id)
        if not chunks:
            return {"query": query, "answer": "Документы не найдены в базе.", "sources": [], "cosine_similarity": 0.0}

        prompt = self.augment_prompt(query, chunks)
        answer = await self.generate(prompt)
        score = await self.evaluate(query, answer)
        sources = [{"filename": c["filename"], "chunk_index": c["chunk_index"], "similarity": c["similarity"]} for c in chunks]

        return {
            "query": query,
            "answer": answer,
            "sources": sources,
            "source_chunks": [{"filename": c["filename"], "content": c["content"][:500], "similarity": c["similarity"]} for c in chunks],
            "cosine_similarity": score,
        }


pipeline = RAGPipeline()


async def ingest_document(filename: str, content: bytes, user_id: int = 0) -> int:
    ext = filename.rsplit(".", 1)[-1].lower()
    source_type = ext if ext in ("pdf", "docx", "txt") else "text"
    chunks = pipeline.prepare(filename, content)
    embeddings = await pipeline.embed(chunks)
    return await pipeline.store(filename, chunks, embeddings, user_id, source_type)


async def search_documents(query: str, top_k: int = 5, user_id: int = 0) -> list[dict]:
    return await pipeline.retrieve(query, top_k, user_id)


async def generate_answer(query: str, top_k: int = 5, user_id: int = 0) -> dict:
    return await pipeline.run(query, top_k, user_id)


def simple_rag(query: str, top_k: int = 5) -> list[dict]:
    keywords = set(query.lower().split())
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT filename, chunk_index, content FROM document_chunks")
            rows = cur.fetchall()
    scored = []
    for filename, chunk_index, content in rows:
        score = len(keywords & set(content.lower().split()))
        if score > 0:
            scored.append({"filename": filename, "chunk_index": chunk_index, "content": content, "score": score})
    scored.sort(key=lambda x: x["score"], reverse=True)
    return scored[:top_k]


async def modular_rag(query: str, top_k: int = 5) -> list[dict]:
    keyword_results = simple_rag(query, top_k)
    vector_results = await search_documents(query, top_k)
    seen, merged = set(), []
    for r in keyword_results + vector_results:
        key = (r["filename"], r["chunk_index"])
        if key not in seen:
            seen.add(key)
            merged.append(r)
    return merged[:top_k]


def vector_store_info() -> dict:
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM document_chunks")
            total_chunks = cur.fetchone()[0]
            cur.execute("SELECT COUNT(DISTINCT filename) FROM document_chunks")
            total_docs = cur.fetchone()[0]
            cur.execute("""
                SELECT source_type, COUNT(*) FROM document_chunks
                GROUP BY source_type ORDER BY source_type
            """)
            by_type = {row[0]: