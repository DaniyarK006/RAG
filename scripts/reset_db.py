import sys
sys.path.insert(0, 'backend')
from rag import get_conn, EMBEDDING_DIM

conn = get_conn()
cur = conn.cursor()

# Drop old table
cur.execute("DROP TABLE IF EXISTS document_chunks CASCADE")
conn.commit()
print("table dropped")

# Ensure vector extension
cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
conn.commit()

# Create table with vector(1024)
cur.execute(f"""
    CREATE TABLE document_chunks (
        id          serial PRIMARY KEY,
        user_id     integer DEFAULT 0,
        filename    text,
        chunk_index int,
        content     text,
        embedding   vector({EMBEDDING_DIM}),
        source_type text DEFAULT 'text'
    )
""")
conn.commit()
print(f"table created with vector({EMBEDDING_DIM})")

# Verify
cur.execute("SELECT column_name, udt_name FROM information_schema.columns WHERE table_name='document_chunks' AND column_name='embedding'")
r = cur.fetchone()
print(f"OK: {r[0]} = {r[1]}({EMBEDDING_DIM})")

# Test embedding
import asyncio
import httpx
async def test_emb():
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post("http://localhost:11434/api/embeddings", json={
            "model": "bge-m3:latest",
            "prompt": "test"
        })
        d = res.json()
        emb = d["embedding"]
        print(f"embedding dim: {len(emb)} (should be {EMBEDDING_DIM})")
asyncio.run(test_emb())

cur.close()
conn.close()