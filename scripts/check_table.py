import psycopg2

conn = psycopg2.connect(
    host="127.0.0.1", port=5433,
    user="postgres", password="mysecurepassword123",
    database="offline_db"
)
cur = conn.cursor()
cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name='document_chunks' ORDER BY ordinal_position")
print(cur.fetchall())
cur.close()
conn.close()