import sys
sys.path.insert(0, 'backend')
from rag import get_conn

conn = get_conn()
cur = conn.cursor()

# Check vector extension
cur.execute("SELECT * FROM pg_extension WHERE extname='vector'")
r = cur.fetchone()
print("vector extension:", r)

# Drop old table
cur.execute("DROP TABLE IF EXISTS document_chunks CASCADE")
conn.commit()
print("table dropped")

# Create extension
cur.execute("CREATE EXTENSION IF NOT EXISTS vector")
conn.commit()
print("vector extension ensured")

# Create table with correct dim
cur.execute("""
    CREATE TABLE document_chunks (
        id          serial PRIMARY KEY,
        user_id     integer DEFAULT 0,
        filename    text,
        chunk_index int,
        content     text,
        embedding   vector(768),
        source_type text DEFAULT 'text'
    )
""")
conn.commit()
print("table created with vector(768)")

# Verify
cur.execute("SELECT column_name, udt_name FROM information_schema.columns WHERE table_name='document_chunks' AND column_name='embedding'")
r = cur.fetchone()
print(f"column: {r[0]}, type: {r[1]}")

cur.close()
conn.close()