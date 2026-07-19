import psycopg2

conn = psycopg2.connect(
    host="127.0.0.1", port=5433,
    user="postgres", password="mysecurepassword123",
    database="offline_db"
)
cur = conn.cursor()
cur.execute("DROP TABLE IF EXISTS document_chunks CASCADE")
conn.commit()
cur.close()
conn.close()
print("Table document_chunks dropped")