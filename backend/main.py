from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, WebSocket, WebSocketDisconnect, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, HTMLResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import httpx, os, json, asyncio, logging, traceback
from dotenv import load_dotenv

from database import get_db, init_db, User, DocumentFeedback
from models import RegisterRequest, LoginRequest, TokenResponse, UserResponse, FeedbackRequest, ChatRequest
from auth import hash_password, verify_password, create_token, decode_token
from rag import (ingest_document, search_documents, generate_answer, simple_rag,
                 modular_rag, vector_store_info, init_vector_table, get_embedding,
                 get_conn, pipeline, OLLAMA_URL, LLM_MODEL, check_ollama_health)
from index import vector_index, tree_index, list_index, keyword_index, compare_indexes
from multimodal import is_image, ingest_image, multimodal_answer, summarize_multimodal, get_dataset_stats, multimodal_retrieve
from adaptive import adaptive_rag, AdaptiveRAG, init_adaptive_tables
from rbac import rbac, init_rbac_tables
from connectors import connector, start_connector_scheduler

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

try:
    from adaptive import adaptive_rag
    logger.info("adaptive imported")
except Exception as e:
    logger.error(f"adaptive import error: {e}")
    adaptive_rag = None

try:
    from rag import pipeline
    logger.info("rag imported")
except Exception as e:
    logger.error(f"rag import error: {e}")

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

GOOGLE_CLIENT_ID     = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI  = os.getenv("GOOGLE_REDIRECT_URI",   "http://localhost:8000/auth/google/callback")
GITHUB_CLIENT_ID     = os.getenv("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET")
GITHUB_REDIRECT_URI  = os.getenv("GITHUB_REDIRECT_URI",   "http://localhost:8000/auth/github/callback")
FACEBOOK_CLIENT_ID   = os.getenv("FACEBOOK_CLIENT_ID")
FACEBOOK_CLIENT_SECRET = os.getenv("FACEBOOK_CLIENT_SECRET")
FACEBOOK_REDIRECT_URI  = os.getenv("FACEBOOK_REDIRECT_URI", "http://localhost:8000/auth/facebook/callback")
FRONTEND_URL         = os.getenv("FRONTEND_URL", "http://localhost:5173")

from oauth_utils import oauth_login_token_redirect

POPUP_CLOSE_HTML = """<!DOCTYPE html><html><body><script>
window.opener.postMessage({ token: "TOKEN_PLACEHOLDER" }, "*");
window.close();
</script></body></html>"""

from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    init_vector_table()
    try:
        init_adaptive_tables()
    except Exception as e:
        logger.warning(f"init_adaptive_tables: {e}")
    try:
        init_rbac_tables()
        logger.info("RBAC tables initialized")
    except Exception as e:
        logger.warning(f"init_rbac_tables: {e}")
    try:
        start_connector_scheduler()
        logger.info("Connector scheduler started")
    except Exception as e:
        logger.warning(f"Connector scheduler: {e}")
    yield

app = FastAPI(title="DocRAG", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        os.getenv("FRONTEND_URL", "http://localhost:5173"),
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/auth/register", response_model=TokenResponse)
async def register(body: RegisterRequest, db: AsyncSession = Depends(get_db)):
    existing = await db.scalar(select(User).where(User.username == body.username))
    if existing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Username taken")
    user = User(username=body.username, email=body.email, hashed_password=hash_password(body.password))
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return TokenResponse(access_token=create_token({"sub": str(user.id), "username": user.username}))


@app.post("/auth/login", response_model=TokenResponse)
async def login(body: LoginRequest, db: AsyncSession = Depends(get_db)):
    user = await db.scalar(select(User).where(User.username == body.username))
    if not user or not verify_password(body.password, user.hashed_password or ""):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")
    return TokenResponse(access_token=create_token({"sub": str(user.id), "username": user.username}))


@app.get("/auth/google")
async def google_login():
    params = (
        f"?client_id={GOOGLE_CLIENT_ID}"
        f"&redirect_uri={GOOGLE_REDIRECT_URI}"
        f"&response_type=code"
        f"&scope=openid email profile"
        f"&access_type=offline"
    )
    return RedirectResponse("https://accounts.google.com/o/oauth2/v2/auth" + params)


@app.get("/auth/google/callback")
async def google_callback(code: str, db: AsyncSession = Depends(get_db)):
    async with httpx.AsyncClient() as client:
        token_res = await client.post(
            "https://oauth2.googleapis.com/token",
            data={"code": code, "client_id": GOOGLE_CLIENT_ID,
                  "client_secret": GOOGLE_CLIENT_SECRET,
                  "redirect_uri": GOOGLE_REDIRECT_URI, "grant_type": "authorization_code"},
        )
        if token_res.status_code != 200:
            logger.error(f"GOOGLE TOKEN ERROR: {token_res.text}")
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Google OAuth error: {token_res.text}")

        google_token = token_res.json()["access_token"]
        user_res = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {google_token}"},
        )
        user_res.raise_for_status()
        info = user_res.json()

        user = await db.scalar(select(User).where(User.oauth_id == info["id"]))

        if not user and info.get("email"):
            user = await db.scalar(select(User).where(User.email == info["email"]))
            if not user:
                user = await db.scalar(select(User).where(User.username == info["email"]))

        if user and not user.oauth_id:
            user.oauth_id = info["id"]
            user.oauth_provider = "google"
            await db.commit()

        if not user:
            user = User(
                username=info.get("email", info["id"]),
                email=info.get("email"),
                oauth_provider="google",
                oauth_id=info["id"]
            )
            db.add(user)
            await db.commit()
            await db.refresh(user)

    token = create_token({"sub": str(user.id), "username": user.username})
    return HTMLResponse(POPUP_CLOSE_HTML.replace("TOKEN_PLACEHOLDER", token))


@app.get("/auth/github")
async def github_login():
    if not GITHUB_CLIENT_ID:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "GITHUB_CLIENT_ID is not set")
    params = (f"?client_id={GITHUB_CLIENT_ID}&redirect_uri={GITHUB_REDIRECT_URI}"
              f"&response_type=code&scope=read:user user:email")
    return RedirectResponse("https://github.com/login/oauth/authorize" + params)


@app.get("/auth/github/callback")
async def github_callback(code: str, db: AsyncSession = Depends(get_db)):
    async with httpx.AsyncClient() as client:
        token_res = await client.post(
            "https://github.com/login/oauth/access_token",
            data={"client_id": GITHUB_CLIENT_ID, "client_secret": GITHUB_CLIENT_SECRET,
                  "code": code, "redirect_uri": GITHUB_REDIRECT_URI},
            headers={"Accept": "application/json"},
        )
        token_res.raise_for_status()
        token_json = token_res.json()
        if "access_token" not in token_json:
            logger.error(f"GITHUB TOKEN ERROR: {token_json}")
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"GitHub OAuth error: {token_json}")

        access_token = token_json["access_token"]
        user_res = await client.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
        user_res.raise_for_status()
        info = user_res.json()
        email = info.get("email")
        if not email:
            emails_res = await client.get(
                "https://api.github.com/user/emails",
                headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
            )
            if emails_res.status_code == 200:
                primary = next((e for e in emails_res.json() if e.get("primary")), None)
                if primary:
                    email = primary.get("email")

        user = await db.scalar(select(User).where(User.oauth_id == str(info["id"])))

        if not user and email:
            user = await db.scalar(select(User).where(User.email == email))
            if not user:
                user = await db.scalar(select(User).where(User.username == email))

        if user and not user.oauth_id:
            user.oauth_id = str(info["id"])
            user.oauth_provider = "github"
            await db.commit()

        if not user:
            user = User(username=email or info.get("login") or str(info["id"]),
                        email=email, oauth_provider="github", oauth_id=str(info["id"]))
            db.add(user)
            await db.commit()
            await db.refresh(user)

    token = create_token({"sub": str(user.id), "username": user.username})
    return HTMLResponse(POPUP_CLOSE_HTML.replace("TOKEN_PLACEHOLDER", token))


@app.get("/auth/facebook")
async def facebook_login():
    if not FACEBOOK_CLIENT_ID:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "FACEBOOK_CLIENT_ID is not set")
    params = (f"?client_id={FACEBOOK_CLIENT_ID}&redirect_uri={FACEBOOK_REDIRECT_URI}"
              f"&response_type=code&scope=email public_profile&state=facebook")
    return RedirectResponse("https://www.facebook.com/v19.0/dialog/oauth" + params)


@app.get("/auth/facebook/callback")
async def facebook_callback(code: str, db: AsyncSession = Depends(get_db)):
    async with httpx.AsyncClient() as client:
        token_res = await client.get(
            "https://graph.facebook.com/v19.0/oauth/access_token",
            params={"client_id": FACEBOOK_CLIENT_ID, "client_secret": FACEBOOK_CLIENT_SECRET,
                    "redirect_uri": FACEBOOK_REDIRECT_URI, "code": code},
        )
        if token_res.status_code != 200:
            logger.error(f"FACEBOOK TOKEN ERROR: {token_res.text}")
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Facebook OAuth error: {token_res.text}")

        access_token = token_res.json()["access_token"]
        user_res = await client.get(
            "https://graph.facebook.com/me",
            params={"fields": "id,name,email", "access_token": access_token},
        )
        user_res.raise_for_status()
        info = user_res.json()

        fb_id = str(info["id"])
        email = info.get("email")

        user = await db.scalar(select(User).where(User.oauth_id == fb_id))

        if not user and email:
            user = await db.scalar(select(User).where(User.email == email))
            if not user:
                user = await db.scalar(select(User).where(User.username == email))

        if user and not user.oauth_id:
            user.oauth_id = fb_id
            user.oauth_provider = "facebook"
            await db.commit()

        if not user:
            user = User(username=email or info.get("name") or fb_id,
                        email=email, oauth_provider="facebook", oauth_id=fb_id)
            db.add(user)
            await db.commit()
            await db.refresh(user)

    token = create_token({"sub": str(user.id), "username": user.username})
    return HTMLResponse(POPUP_CLOSE_HTML.replace("TOKEN_PLACEHOLDER", token))


@app.get("/auth/me", response_model=UserResponse)
async def me(token: str, db: AsyncSession = Depends(get_db)):
    try:
        payload = decode_token(token)
    except Exception:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")
    user = await db.get(User, int(payload["sub"]))
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user


async def _process_document(file: UploadFile, user_id: int):
    try:
        content = await file.read()
        if not content:
            return
        chunks = pipeline.prepare(file.filename, content)
        chunks_to_embed = chunks[:20]
        if chunks_to_embed:
            embeddings = await pipeline.embed(chunks_to_embed)
            init_vector_table()
            with get_conn() as conn:
                with conn.cursor() as cur:
                    for i, (chunk, emb) in enumerate(zip(chunks_to_embed, embeddings)):
                        cur.execute(
                            "UPDATE document_chunks SET embedding = %s "
                            "WHERE filename = %s AND user_id = %s AND chunk_index = %s",
                            (emb, file.filename, user_id, i)
                        )
                conn.commit()
            logger.info(f"Embedded first {len(chunks_to_embed)} chunks of {file.filename} for user {user_id}")
    except Exception as e:
        logger.error(f"Background embedding error for {file.filename}: {e}\n{traceback.format_exc()}")


@app.post("/documents/upload")
async def upload_document(file: UploadFile = File(...), token: str = "", background_tasks: BackgroundTasks = BackgroundTasks()):
    user_id = 0
    if token:
        try:
            payload = decode_token(token)
            user_id = int(payload["sub"])
            logger.info(f"Upload from user_id={user_id}, username={payload.get('username')}")
        except Exception as e:
            logger.warning(f"Invalid token: {e}")
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token")

    if not file.filename:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File name is required")

    content = await file.read()
    if not content:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File is empty")

    if is_image(file.filename):
        try:
            result = await ingest_image(file.filename, content)
            return {"filename": result["filename"], "chunks": result["chunks"], "source_type": "image", "status": "done"}
        except Exception as e:
            logger.error(f"Image ingestion error for {file.filename}: {e}\n{traceback.format_exc()}")
            raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, f"Image processing error: {str(e)}")

    ext = file.filename.rsplit(".", 1)[-1].lower()
    source_type = ext if ext in ("pdf", "docx", "txt") else "text"

    try:
        chunks = pipeline.prepare(file.filename, content)
        chunk_count = await pipeline.store_fast(file.filename, chunks, user_id, source_type)

        from io import BytesIO
        from fastapi import UploadFile as FastAPIFile
        bg_file = FastAPIFile(filename=file.filename, file=BytesIO(content))
        background_tasks.add_task(_process_document, bg_file, user_id)

        return {
            "filename": file.filename,
            "chunks": chunk_count,
            "source_type": source_type,
            "status": "done",
            "message": "File indexed and ready to use"
        }
    except Exception as e:
        logger.error(f"Upload error for {file.filename}: {e}\n{traceback.format_exc()}")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(e))


@app.get("/documents/info")
async def documents_info(token: str = ""):
    user_id = 0
    if token:
        try:
            payload = decode_token(token)
            user_id = int(payload["sub"])
        except Exception:
            pass
    return vector_store_info(user_id)

@app.get("/documents")
async def list_documents(token: str = ""):
    user_id = 0
    if token:
        try:
            payload = decode_token(token)
            user_id = int(payload["sub"])
        except Exception:
            pass
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT filename, COUNT(*) as chunks
                FROM document_chunks
                WHERE source_type != 'pending' AND user_id = %s
                GROUP BY filename ORDER BY filename
            """, (user_id,))
            rows = cur.fetchall()
    return {"documents": [{"filename": r[0], "chunks": r[1]} for r in rows]}

@app.get("/documents/{filename}/chunks")
async def get_document_chunks(filename: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT chunk_index, content FROM document_chunks WHERE filename = %s ORDER BY chunk_index",
                (filename,)
            )
            rows = cur.fetchall()
    return {"chunks": [{"chunk_index": r[0], "content": r[1]} for r in rows]}


@app.delete("/documents/{filename}")
async def delete_document(filename: str):
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM document_chunks WHERE filename = %s", (filename,))
            deleted = cur.rowcount
        conn.commit()
    if deleted == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return {"filename": filename, "deleted_chunks": deleted}


@app.get("/documents/ask")
async def ask(q: str, top_k: int = 5, token: str = ""):
    if not q.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Query cannot be empty")
    user_id = 0
    if token:
        try:
            payload = decode_token(token)
            user_id = int(payload["sub"])
        except Exception:
            pass
    return await generate_answer(q, top_k, user_id)


@app.post("/api/chat")
async def chat(body: ChatRequest):
    if not body.message.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Message cannot be empty")
    result = await generate_answer(body.message)
    return {
        "answer": result["answer"],
        "sources": [
            f"{s['filename']} (чанк {s['chunk_index']}, схожесть {s['similarity']})"
            for s in result.get("sources", [])
        ],
        "cosine_similarity": result.get("cosine_similarity"),
    }


@app.get("/api/chat/stream")
async def chat_stream(q: str, token: str = ""):
    if not q.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Query cannot be empty")

    user_id = 0
    if token:
        try:
            payload = decode_token(token)
            user_id = int(payload["sub"])
        except Exception:
            pass

    async def event_generator():
        chunks = await pipeline.retrieve(q, top_k=5, user_id=user_id)
        if not chunks:
            yield f"data: {json.dumps({'token': 'Документы не найдены в базе.', 'done': True})}\n\n"
            return

        prompt = pipeline.augment_prompt(q, chunks)
        sources = [
            {"filename": c["filename"], "chunk_index": c["chunk_index"], "similarity": c["similarity"]}
            for c in chunks
        ]

        async with httpx.AsyncClient(timeout=120) as client:
            async with client.stream("POST", f"{OLLAMA_URL}/api/generate", json={
                "model": LLM_MODEL,
                "prompt": prompt,
                "stream": True,
                "options": {"temperature": 0.1},
            }) as resp:
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        data = json.loads(line)
                        token_text = data.get("response", "")
                        done = data.get("done", False)
                        yield f"data: {json.dumps({'token': token_text, 'done': done})}\n\n"
                        if done:
                            yield f"data: {json.dumps({'sources': sources, 'done': True})}\n\n"
                            break
                    except Exception:
                        continue

    return StreamingResponse(event_generator(), media_type="text/event-stream",
                              headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.websocket("/ws/chat")
async def websocket_chat(websocket: WebSocket):
    await websocket.accept()
    try:
        while True:
            data = await websocket.receive_json()
            query   = data.get("query", "").strip()
            token   = data.get("token", "")
            top_k   = int(data.get("top_k", 5))

            if not query:
                await websocket.send_json({"error": "empty query"})
                continue

            user_id = 0
            if token:
                try:
                    payload = decode_token(token)
                    user_id = int(payload["sub"])
                except Exception:
                    pass

            chunks = await pipeline.retrieve(query, top_k=top_k, user_id=user_id)
            if not chunks:
                await websocket.send_json({"token": "Документы не найдены в базе.", "done": True})
                continue

            prompt  = pipeline.augment_prompt(query, chunks)
            sources = [
                {"filename": c["filename"], "chunk_index": c["chunk_index"], "similarity": c["similarity"]}
                for c in chunks
            ]

            async with httpx.AsyncClient(timeout=120) as client:
                async with client.stream("POST", f"{OLLAMA_URL}/api/generate", json={
                    "model": LLM_MODEL,
                    "prompt": prompt,
                    "stream": True,
                    "options": {"temperature": 0.1},
                }) as resp:
                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            obj = json.loads(line)
                            await websocket.send_json({
                                "token": obj.get("response", ""),
                                "done":  obj.get("done", False),
                            })
                            if obj.get("done"):
                                await websocket.send_json({"sources": sources, "done": True})
                                break
                        except Exception:
                            continue

    except WebSocketDisconnect:
        pass


@app.get("/documents/search")
async def search(q: str, top_k: int = 5, mode: str = "advanced", token: str = ""):
    if not q.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Query cannot be empty")
    user_id = 0
    if token:
        try:
            payload = decode_token(token)
            user_id = int(payload["sub"])
        except Exception:
            pass
    if mode == "simple":
        results = simple_rag(q, top_k)
    elif mode == "modular":
        results = await modular_rag(q, top_k)
    else:
        results = await search_documents(q, top_k, user_id)
    return {"query": q, "mode": mode, "results": results}


@app.post("/documents/numeric-search")
async def numeric_search(body: dict, token: str = ""):
    numbers   = body.get("numbers", [])
    top_k     = int(body.get("top_k", 5))
    threshold = float(body.get("threshold", 0.5))
    if not numbers:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "numbers array is required")

    user_id = 0
    if token:
        try:
            payload = decode_token(token)
            user_id = int(payload["sub"])
        except Exception:
            pass

    query_text = " ".join(str(n) for n in numbers)
    emb = await get_embedding(query_text)

    with get_conn() as conn:
        with conn.cursor() as cur:
            if user_id > 0:
                cur.execute("""
                    SELECT filename, chunk_index, content, source_type,
                           1 - (embedding <=> %s::vector) AS similarity
                    FROM document_chunks
                    WHERE user_id = %s
                      AND 1 - (embedding <=> %s::vector) >= %s
                    ORDER BY embedding <=> %s::vector
                    LIMIT %s
                """, (emb, user_id, emb, threshold, emb, top_k))
            else:
                cur.execute("""
                    SELECT filename, chunk_index, content, source_type,
                           1 - (embedding <=> %s::vector) AS similarity
                    FROM document_chunks
                    WHERE 1 - (embedding <=> %s::vector) >= %s
                    ORDER BY embedding <=> %s::vector
                    LIMIT %s
                """, (emb, emb, threshold, emb, top_k))
            rows = cur.fetchall()

    import re
    results = []
    for r in rows:
        found_nums = re.findall(r'[-+]?\d*\.?\d+', r[2])
        matched    = [n for n in numbers if str(n) in found_nums]
        results.append({
            "filename": r[0], "chunk_index": r[1], "content": r[2][:300],
            "source_type": r[3], "similarity": round(r[4], 4),
            "matched_numbers": matched,
        })
    return {"query_numbers": numbers, "threshold": threshold, "results": results, "total": len(results)}


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/health/ollama")
async def health_ollama():
    ok, msg = await check_ollama_health()
    return {"ok": ok, "message": msg}


@app.get("/health/dashboard")
async def health_dashboard():
    try:
        info = vector_store_info()
    except Exception as e:
        info = {"error": str(e)}

    db_ok, db_err = True, None
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
    except Exception as e:
        db_ok, db_err = False, str(e)

    return {
        "service": "DocRAG",
        "status": "ok" if db_ok else "degraded",
        "db": {"ok": db_ok, "error": db_err},
        "documents": {k: info.get(k) if isinstance(info, dict) else None
                      for k in ("total_chunks", "total_documents", "embed_model",
                                "embedding_dim", "by_source_type")},
    }


@app.get("/index/query")
async def index_query(q: str, index: str = "vector", top_k: int = 5, token: str = ""):
    if not q.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Query cannot be empty")

    user_id = 0
    if token:
        try:
            payload = decode_token(token)
            user_id = int(payload["sub"])
        except Exception:
            pass

    q_lower = q.lower()
    is_count_query = any(kw in q_lower for kw in ["сколько", "количество", "число", "count", "how many"])
    is_compare_query = any(kw in q_lower for kw in ["одинаков", "схож", "похож", "сравн", "same", "similar", "compare"])

    greetings = ["привет", "здравствуй", "хай", "hello", "hi", "добрый день",
                 "добрый вечер", "доброе утро", "салам", "ассалам"]
    if any(q_lower.strip().startswith(g) for g in greetings) and len(q_lower.split()) <= 4:
        return {
            "query": q,
            "answer": "Привет! Я ваш ИИ-ассистент базы знаний DocRAG. Задайте вопрос по загруженным документам — найду точный ответ с источниками.",
            "sources": [],
            "index_type": "greeting",
            "top_k": 0,
            "cosine_similarity": 1.0,
            "temperature": 0.1,
            "latency_ms": 0,
        }

    is_content_query = any(kw in q_lower for kw in [
        "содержит", "содержимое", "что в файл", "что находится", "расскажи про",
        "опиши файл", "что есть в", "о чём", "о чем", "про каждый", "каждый файл",
        "все файлы", "каждого файла", "что хранится"
    ])

    if is_content_query:
        result = await generate_answer(q, top_k=17, user_id=user_id)
        return {
            "query": q,
            "answer": result.get("answer", "Нет ответа"),
            "sources": result.get("sources", []),
            "index_type": "vector",
            "top_k": 17,
            "cosine_similarity": result.get("cosine_similarity", 0),
            "temperature": 0.1,
            "latency_ms": 0,
        }

    if is_count_query or is_compare_query:
        return await handle_comparison_query(q, is_count_query, is_compare_query, user_id)

    idx_map = {"vector": vector_index, "tree": tree_index, "list": list_index, "keyword": keyword_index}
    if index not in idx_map:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown index. Choose: {list(idx_map)}")
    return await idx_map[index].query(q, top_k, user_id)

@app.get("/index/compare")
async def index_compare(q: str, top_k: int = 3, token: str = ""):
    if not q.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Query cannot be empty")
    user_id = 0
    if token:
        try:
            payload = decode_token(token)
            user_id = int(payload["sub"])
        except Exception:
            pass
    return await compare_indexes(q, top_k, user_id)



@app.get("/adaptive/ask")
async def adaptive_ask(q: str, index: str = "auto", token: str = ""):
    try:
        if not q.strip():
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Query cannot be empty")

        user_id = 0
        if token:
            try:
                payload = decode_token(token)
                user_id = int(payload["sub"])
            except Exception:
                pass

        q_lower = q.lower()
        is_count_query = any(kw in q_lower for kw in ["сколько", "количество", "число", "count", "how many"])
        is_compare_query = any(kw in q_lower for kw in ["одинаков", "схож", "похож", "сравн", "same", "similar", "compare"])

        if is_count_query or is_compare_query:
            return await handle_comparison_query(q, is_count_query, is_compare_query, user_id)

        result = await generate_answer(q, top_k=5, user_id=user_id)
        return {
            "query": q,
            "answer": result.get("answer", "Нет ответа"),
            "sources": result.get("sources", []),
            "index_type": "vector (fallback)",
            "top_k": 5,
            "cosine_similarity": result.get("cosine_similarity", 0),
            "temperature": 0.1,
            "latency_ms": 0
        }

    except Exception as e:
        logger.error(f"adaptive_ask error: {e}")
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, str(e))


async def handle_comparison_query(q: str, is_count_query: bool, is_compare_query: bool, user_id: int = 0) -> dict:
    import time
    t0 = time.perf_counter()

    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                if user_id > 0:
                    cur.execute("""
                        SELECT DISTINCT filename FROM document_chunks 
                        WHERE source_type != 'pending' AND user_id = %s
                        ORDER BY filename
                    """, (user_id,))
                else:
                    cur.execute("""
                        SELECT DISTINCT filename FROM document_chunks 
                        WHERE 1 = 0
                    """)
                files = [r[0] for r in cur.fetchall()]

        if not files:
            return {
                "query": q,
                "answer": "В базе нет документов для анализа.",
                "sources": [],
                "index_type": "comparison",
                "top_k": 0,
                "cosine_similarity": 0.0,
                "temperature": 0.1,
                "latency_ms": 0
            }

        try:
            query_emb = await get_embedding(q)
        except Exception as e:
            logger.error(f"Failed to get query embedding: {e}")
            return {
                "query": q,
                "answer": "Ошибка при обработке запроса. Не удалось получить эмбеддинг.",
                "sources": [],
                "index_type": "comparison",
                "top_k": 0,
                "cosine_similarity": 0.0,
                "temperature": 0.1,
                "latency_ms": 0
            }

        with get_conn() as conn:
            with conn.cursor() as cur:
                if user_id > 0:
                    cur.execute("""
                        SELECT DISTINCT ON (filename) filename, content, embedding
                        FROM document_chunks
                        WHERE source_type != 'pending' AND user_id = %s AND embedding IS NOT NULL
                        ORDER BY filename, chunk_index
                    """, (user_id,))
                else:
                    cur.execute("""
                        SELECT DISTINCT ON (filename) filename, content, embedding
                        FROM document_chunks
                        WHERE source_type != 'pending' AND embedding IS NOT NULL
                        ORDER BY filename, chunk_index
                    """)
                rows = cur.fetchall()

        if not rows:
            return {
                "query": q,
                "answer": "Документы найдены, но эмбеддинги отсутствуют. Переиндексируйте документы.",
                "sources": [],
                "index_type": "comparison",
                "top_k": 0,
                "cosine_similarity": 0.0,
                "temperature": 0.1,
                "latency_ms": 0
            }

        try:
            import numpy as np
        except ImportError:
            logger.error("numpy not installed")
            return {
                "query": q,
                "answer": "Ошибка: numpy не установлен. Установите: pip install numpy",
                "sources": [],
                "index_type": "comparison",
                "top_k": 0,
                "cosine_similarity": 0.0,
                "temperature": 0.1,
                "latency_ms": 0
            }

        file_scores = []
        for row in rows:
            filename, content, embedding_str = row
            try:
                if not embedding_str or not content:
                    continue

                emb_str = str(embedding_str).strip()
                if emb_str.startswith('[') and emb_str.endswith(']'):
                    emb = [float(x.strip()) for x in emb_str[1:-1].split(',') if x.strip()]
                else:
                    emb = [float(x.strip()) for x in emb_str.split(',') if x.strip()]

                if len(emb) != len(query_emb):
                    logger.warning(f"Embedding dimension mismatch for {filename}: {len(emb)} vs {len(query_emb)}")
                    continue

                emb_arr = np.array(emb, dtype=np.float64)
                query_arr = np.array(query_emb, dtype=np.float64)
                sim = float(np.dot(query_arr, emb_arr) / (np.linalg.norm(query_arr) * np.linalg.norm(emb_arr) + 1e-10))

                file_scores.append({
                    "filename": filename,
                    "similarity": round(sim, 4),
                    "preview": content[:200] if content else ""
                })
            except Exception as e:
                logger.warning(f"Error processing embedding for {filename}: {e}")
                continue

        file_scores.sort(key=lambda x: x["similarity"], reverse=True)

        threshold = 0.2
        matching = [f for f in file_scores if f["similarity"] >= threshold]

        latency = round((time.perf_counter() - t0) * 1000)

        if is_count_query:
            answer = f"Найдено {len(matching)} файлов, соответствующих запросу.\n\n"
            if matching:
                answer += "Список файлов:\n"
                for i, f in enumerate(matching[:10], 1):
                    answer += f"{i}. {f['filename']} (схожесть: {f['similarity']:.2%})\n"
                if len(matching) > 10:
                    answer += f"\n... и ещё {len(matching) - 10} файлов"
        else:
            answer = f"Анализ документов завершён.\n\n"
            answer += f"Всего документов в базе: {len(files)}\n"
            answer += f"Документов с высокой семантической схожестью: {len(matching)}\n\n"
            if matching:
                answer += "Наиболее похожие документы:\n"
                for i, f in enumerate(matching[:5], 1):
                    answer += f"{i}. {f['filename']} ({f['similarity']:.2%})\n"

        sources = [
            {
                "filename": f["filename"],
                "chunk_index": 0,
                "similarity": f["similarity"]
            }
            for f in matching[:20]
        ]

        return {
            "query": q,
            "answer": answer,
            "sources": sources,
            "index_type": "comparison",
            "top_k": len(sources),
            "cosine_similarity": matching[0]["similarity"] if matching else 0.0,
            "temperature": 0.1,
            "latency_ms": latency
        }

    except Exception as e:
        logger.error(f"handle_comparison_query error: {e}\n{traceback.format_exc()}")
        return {
            "query": q,
            "answer": f"Ошибка при обработке запроса: {str(e)}",
            "sources": [],
            "index_type": "comparison",
            "top_k": 0,
            "cosine_similarity": 0.0,
            "temperature": 0.1,
            "latency_ms": 0
        }

@app.get("/adaptive/best-index")
async def adaptive_best_index():
    if adaptive_rag is not None:
        return {"best_index": adaptive_rag.evaluator.best_index()}
    return {"best_index": "vector"}


@app.get("/multimodal/ask")
async def multimodal_ask(q: str, top_k: int = 5):
    if not q.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Query cannot be empty")
    return await multimodal_answer(q, top_k)


@app.get("/multimodal/stats")
async def multimodal_stats():
    return await get_dataset_stats()


@app.get("/multimodal/summarize")
async def multimodal_summarize(q: str, top_k: int = 6):
    if not q.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Query cannot be empty")
    chunks  = await multimodal_retrieve(q, top_k)
    summary = await summarize_multimodal(chunks)
    return {"query": q, "summary": summary, "sources_used": len(chunks)}


@app.post("/documents/feedback")
async def submit_feedback(body: FeedbackRequest, db: AsyncSession = Depends(get_db)):
    if not 1 <= body.score <= 5:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Score must be between 1 and 5")
    feedback = DocumentFeedback(query=body.query, answer=body.answer,
                                score=body.score, comment=body.comment)
    db.add(feedback)
    await db.commit()
    return {"status": "ok", "score": body.score}


@app.get("/documents/feedback")
async def get_feedback(db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select as sa_select
    rows  = await db.execute(sa_select(DocumentFeedback).order_by(DocumentFeedback.id.desc()).limit(50))
    items = rows.scalars().all()
    avg   = sum(i.score for i in items) / len(items) if items else 0
    return {
        "average_score": round(avg, 2),
        "total": len(items),
        "feedback": [{"query": i.query, "score": i.score, "comment": i.comment} for i in items],
    }


@app.post("/api/users/create")
async def create_user(email: str, password: str, role: str = "employee", department: str = "general"):
    from auth import hash_password
    user_id = rbac.create_user(email, hash_password(password), role, department)
    return {"user_id": user_id, "email": email, "role": role, "department": department}


@app.post("/api/documents/set-permissions")
async def set_permissions(document_id: str, allowed_roles: list[str] = None,
                         allowed_departments: list[str] = None,
                         confidentiality: str = "internal"):
    rbac.set_document_permissions(document_id, allowed_roles, allowed_departments, confidentiality)
    return {"status": "ok", "document": document_id}


@app.get("/api/documents/view/{filename}")
async def view_document(filename: str, chunk_index: int = 0, user_id: int = 0):
    if not rbac.check_access(user_id, filename):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    rbac.log_access(user_id, filename, action='view')
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT content, chunk_index FROM document_chunks WHERE filename = %s AND chunk_index = %s",
                (filename, chunk_index)
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Чанк не найден")
    return {
        "filename": filename,
        "chunk_index": chunk_index,
        "content": row[0],
        "similarity": 1.0
    }


@app.get("/api/documents/download/{filename}")
async def download_document(filename: str, user_id: int = 0):
    if not rbac.check_access(user_id, filename):
        raise HTTPException(status_code=403, detail="Доступ запрещён")
    rbac.log_access(user_id, filename, action='download')
    from fastapi.responses import FileResponse
    import os as os_module
    upload_dir = os_module.path.join(os_module.path.dirname(__file__), "..", "uploads")
    file_path = os_module.path.join(upload_dir, filename)
    if os_module.path.exists(file_path):
        return FileResponse(file_path)
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT content FROM document_chunks WHERE filename = %s ORDER BY chunk_index LIMIT 1",
                (filename,)
            )
            row = cur.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="Документ не найден")
    return {"filename": filename, "content": row[0][:5000]}


@app.get("/api/rbac/users")
async def get_rbac_users():
    return {"users": rbac.get_all_users()}


@app.get("/api/rbac/documents")
async def get_rbac_documents():
    return {"documents": rbac.get_all_documents_with_permissions()}


@app.get("/api/rbac/access-log")
async def get_access_log(limit: int = 50):
    return {"entries": rbac.get_access_log(limit)}


@app.get("/api/rbac/check-access")
async def check_access(user_id: int, document_id: str):
    return {"has_access": rbac.check_access(user_id, document_id)}


@app.get("/debug/adaptive")
async def debug_adaptive():
    return {
        "adaptive_rag_exists": adaptive_rag is not None,
        "adaptive_rag_type": str(type(adaptive_rag)) if adaptive_rag else None,
        "llm_model": LLM_MODEL,
        "ollama_url": OLLAMA_URL
    }


@app.get("/graph/similarities")
async def graph_similarities(token: str = ""):
    user_id = 0
    if token:
        try:
            payload = decode_token(token)
            user_id = int(payload["sub"])
        except Exception:
            pass

    from rag import get_conn, get_embedding, cosine_similarity
    import asyncio

    with get_conn() as conn:
        with conn.cursor() as cur:
            if user_id > 0:
                cur.execute("""
                    SELECT filename, content FROM (
                        SELECT filename, content,
                               ROW_NUMBER() OVER (PARTITION BY filename ORDER BY chunk_index) as rn
                        FROM document_chunks
                        WHERE source_type != 'pending' AND user_id = %s
                          AND filename IS NOT NULL AND filename != ''
                    ) r WHERE rn <= 2
                """, (user_id,))
            else:
                cur.execute("""
                    SELECT filename, content FROM (
                        SELECT filename, content,
                               ROW_NUMBER() OVER (PARTITION BY filename ORDER BY chunk_index) as rn
                        FROM document_chunks
                        WHERE 1 = 0
                          AND filename IS NOT NULL AND filename != ''
                    ) r WHERE rn <= 2
                """)
            rows = cur.fetchall()

    by_file: dict[str, str] = {}
    for filename, content in rows:
        if filename not in by_file:
            by_file[filename] = content
        else:
            by_file[filename] += " " + content

    if len(by_file) < 2:
        return {"edges": []}

    filenames = list(by_file.keys())

    sem = asyncio.Semaphore(5)
    async def embed_one(text):
        async with sem:
            return await get_embedding(text[:500])

    embeddings = await asyncio.gather(*[embed_one(by_file[f]) for f in filenames])
    emb_map = dict(zip(filenames, embeddings))

    edges = []
    for i in range(len(filenames)):
        for j in range(i + 1, len(filenames)):
            a, b = filenames[i], filenames[j]
            sim = cosine_similarity(emb_map[a], emb_map[b])
            edges.append({
                "source": a,
                "target": b,
                "weight": round(sim, 4),
            })

    return {"edges": edges, "nodes": filenames}