import urllib.request
import json
import sys

# Параметры подключения 
DB_CONFIG = {
    "host": "127.0.0.1",
    "port": 5433,
    "user": "postgres",
    "password": "mysecurepassword123",
    "database": "offline_db"
}

def get_embedding(text):
    """Генерация эмбеддинга через Ollama API (nomic-embed-text: 768 измерений)"""
    url = "http://localhost:11434/api/embeddings"
    data = json.dumps({
        "model": "nomic-embed-text",
        "prompt": text
    }).encode("utf-8")
    
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req) as res:
            response_data = json.loads(res.read().decode())
            return response_data["embedding"]
    except Exception as e:
        print(f"Ошибка генерации эмбеддинга через Ollama: {e}")
        return None

def main():
    print("Начало теста интеграции...")
    
    # 1. Проверяем генерацию эмбеддингов
    test_text = "Конфиденциальные документы этого проекта хранятся в безопасности."
    print(f"1. Генерируем вектор для текста: '{test_text}'")
    vector = get_embedding(test_text)
    if not vector:
        print("Тест провален на этапе генерации вектора.")
        sys.exit(1)
    print(f"Успешно! Длина вектора: {len(vector)} измерений (ожидалось 768)")

    # 2. Пытаемся подключиться 
    print("\n2. Проверяем библиотеку psycopg2...")
    try:
        import psycopg2
    except ImportError:
        print("Библиотека 'psycopg2' не установлена.")
        print("Установите её командой в терминале: pip install psycopg2-binary")
        sys.exit(1)
        
    print("psycopg2 импортирован!")

    # 3. Работа с БД
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        cur = conn.cursor()
        
        # Включаем расширение pgvector в сессии (на всякий случай)
        cur.execute("CREATE EXTENSION IF NOT EXISTS vector;")
        
        # Создаем тестовую таблицу
        cur.execute("DROP TABLE IF EXISTS test_documents;")
        cur.execute("""
            CREATE TABLE test_documents (
                id serial PRIMARY KEY,
                content text,
                embedding vector(768)
            );
        """)
        conn.commit()
        print("Таблица 'test_documents' успешно создана в PostgreSQL.")

        # Данные для вставки
        documents = [
            "Разработка ведется на ноутбуке ASUS TUF с видеокартой RTX 4060.",
            "Все секретные документы должны обрабатываться строго локально без интернета.",
            "Система защиты от падения серверов включает ограничение размера логов в Docker.",
            "СУБД PostgreSQL используется для хранения связей проектов и метаданных."
        ]
        
        # Вставка документов с их эмбеддингами
        print("\n3. Вставка тестовых документов в БД...")
        for doc in documents:
            emb = get_embedding(doc)
            if emb:
                cur.execute(
                    "INSERT INTO test_documents (content, embedding) VALUES (%s, %s);",
                    (doc, emb)
                )
        conn.commit()
        print(f"Вставлено документов: {len(documents)}")

        # 4. Выполняем семантический поиск
        query = "безопасность конфиденциальных файлов и отсутствие интернета"
        print(f"\n4. Выполняем семантический поиск для запроса: '{query}'")
        query_vector = get_embedding(query)

        cur.execute("""
            SELECT content, 1 - (embedding <=> %s::vector) as similarity
            FROM test_documents
            ORDER BY embedding <=> %s::vector
            LIMIT 2;
        """, (query_vector, query_vector))
        
        results = cur.fetchall()
        print("Результаты поиска (топ-2 по сходству):")
        for i, (content, similarity) in enumerate(results, 1):
            print(f"   [{i}] Сходство: {similarity:.4f} | Текст: {content}")
            
        cur.close()
        conn.close()
        print("\n Тест интеграции успешно пройден! Все компоненты работают слаженно.")
        
    except Exception as e:
        print(f"Ошибка при работе с PostgreSQL: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
