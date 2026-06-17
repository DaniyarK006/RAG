from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File

from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, HTMLResponse

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import httpx, os
from dotenv import load_dotenv

from database import get_db, init_db, User, DocumentFeedback
from models import RegisterRequest, LoginRequest, TokenResponse, UserResponse, FeedbackRequest, ChatRequest
from auth import hash_password, verify_password, create_token, decode_token
from rag import ingest_document, search_documents, generate_answer, simple_rag, modular_rag, vector_store_info, init_vector_table
from index import vector_index, tree_index, list_index, keyword_index, compare_indexes
from multimodal import is_image, ingest_image, multimodal_answer, summarize_multimodal, get_dataset_stats, multimodal_retrieve
from adaptive import adaptive_rag, AdaptiveRAG, init_adaptive_tables

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
GOOGLE_REDIRECT_URI = os.getenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/auth/google/callback")
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

GITHUB_CLIENT_ID = os.getenv("GITHUB_CLIENT_ID")
GITHUB_CLIENT_SECRET = os.getenv("GITHUB_CLIENT_SECRET")
GITHUB_REDIRECT_URI = os.getenv("GITHUB_REDIRECT_URI", "http://localhost:8000/auth/github/callback")

FACEBOOK_CLIENT_ID = os.getenv("FACEBOOK_CLIENT_ID")
FACEBOOK_CLIENT_SECRET = os.getenv("FACEBOOK_CLIENT_SECRET")
FACEBOOK_REDIRECT_URI = os.getenv("FACEBOOK_REDIRECT_URI", "http://localhost:8000/auth/facebook/callback")

from oauth_utils import oauth_login_token_redirect


app = FastAPI(title="DocRAG")

POPUP_CLOSE_HTML = """<!DOCTYPE html><html><body><script>
window.opener.postMessage({ token: "TOKEN_PLACEHOLDER" }, "http://localhost:5173");
window.close();
</script></body></html>"""

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


@app.on_event("startup")
async def startup():
    await init_db()
    init_vector_table()
    init_adaptive_tables()


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
            data={
                "code": code,
                "client_id": GOOGLE_CLIENT_ID,
                "client_secret": GOOGLE_CLIENT_SECRET,
                "redirect_uri": GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
        )
        token_res.raise_for_status()
        google_token = token_res.json()["access_token"]

        user_res = await client.get(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": f"Bearer {google_token}"},
        )
        user_res.raise_for_status()
        info = user_res.json()

    user = await db.scalar(select(User).where(User.oauth_id == info["id"]))
    if not user:
        user = User(
            username=info.get("email", info["id"]),
            email=info.get("email"),
            oauth_provider="google",
            oauth_id=info["id"],
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

    params = (
        f"?client_id={GITHUB_CLIENT_ID}"
        f"&redirect_uri={GITHUB_REDIRECT_URI}"
        f"&response_type=code"
        f"&scope=read:user user:email"
    )
    return RedirectResponse("https://github.com/login/oauth/authorize" + params)


@app.get("/auth/github/callback")
async def github_callback(code: str, db: AsyncSession = Depends(get_db)):
    async with httpx.AsyncClient() as client:
        token_res = await client.post(
            "https://github.com/login/oauth/access_token",
            data={
                "client_id": GITHUB_CLIENT_ID,
                "client_secret": GITHUB_CLIENT_SECRET,
                "code": code,
                "redirect_uri": GITHUB_REDIRECT_URI,
            },
            headers={"Accept": "application/json"},
        )
        token_res.raise_for_status()
        token_data = token_res.json()
        access_token = token_data["access_token"]

        user_res = await client.get(
            "https://api.github.com/user",
            headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
        )
        user_res.raise_for_status()
        info = user_res.json()

        email = None
        if info.get("email"):
            email = info.get("email")
        else:
            # GitHub may require a separate call for primary email
            emails_res = await client.get(
                "https://api.github.com/user/emails",
                headers={"Authorization": f"Bearer {access_token}", "Accept": "application/json"},
            )
            if emails_res.status_code == 200:
                emails = emails_res.json()
                primary = next((e for e in emails if e.get("primary")), None)
                if primary:
                    email = primary.get("email")

    user = await db.scalar(select(User).where(User.oauth_id == str(info["id"])) )
    if not user:
        username = email or info.get("login") or str(info["id"])
        user = User(
            username=username,
            email=email,
            oauth_provider="github",
            oauth_id=str(info["id"]),
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    token = create_token({"sub": str(user.id), "username": user.username})
    return HTMLResponse(POPUP_CLOSE_HTML.replace("TOKEN_PLACEHOLDER", token))


@app.get("/auth/facebook")
async def facebook_login():
    if not FACEBOOK_CLIENT_ID:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "FACEBOOK_CLIENT_ID is not set")

    params = (
        f"?client_id={FACEBOOK_CLIENT_ID}"
        f"&redirect_uri={FACEBOOK_REDIRECT_URI}"
        f"&response_type=code"
        f"&scope=email public_profile"
        f"&state=facebook"
    )
    return RedirectResponse("https://www.facebook.com/v19.0/dialog/oauth" + params)


@app.get("/auth/facebook/callback")
async def facebook_callback(code: str, db: AsyncSession = Depends(get_db)):
    async with httpx.AsyncClient() as client:
        token_res = await client.get(
            "https://graph.facebook.com/v19.0/oauth/access_token",
            params={
                "client_id": FACEBOOK_CLIENT_ID,
                "client_secret": FACEBOOK_CLIENT_SECRET,
                "redirect_uri": FACEBOOK_REDIRECT_URI,
                "code": code,
            },
        )
        token_res.raise_for_status()
        token_data = token_res.json()
        access_token = token_data["access_token"]

        user_res = await client.get(
            "https://graph.facebook.com/me",
            params={"fields": "id,name,email", "access_token": access_token},
        )
        user_res.raise_for_status()
        info = user_res.json()

    fb_id = str(info["id"])
    user = await db.scalar(select(User).where(User.oauth_id == fb_id))
    if not user:
        username = info.get("email") or info.get("name") or fb_id
        user = User(
            username=username,
            email=info.get("email"),
            oauth_provider="facebook",
            oauth_id=fb_id,
        )
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


@app.post("/documents/upload")
async def upload_document(file: UploadFile = File(...), token: str = ""):
    # Extract user_id from token (default 0 for anonymous)
    user_id = 0
    if token:
        try:
            payload = decode_token(token)
            user_id = int(payload["sub"])
        except:
            pass
    
    content = await file.read()
    if is_image(file.filename):
        result = await ingest_image(file.filename, content)
        return {"filename": result["filename"], "chunks": result["chunks"], "source_type": "image"}
    try:
        count = await ingest_document(file.filename, content, user_id)
    except UnicodeDecodeError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Cannot decode file")
    return {"filename": file.filename, "chunks": count, "source_type": "text"}


@app.get("/documents/info")
async def documents_info():
    return vector_store_info()


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/health/dashboard")
async def health_dashboard():
    # Берем базовые метрики БД и состояние приложения.
    from rag import get_conn, vector_store_info
    try:
        info = vector_store_info()
    except Exception as e:
        info = {"error": str(e)}

    db_ok = True
    db_err = None
    try:
        with get_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1")
                cur.fetchone()
    except Exception as e:
        db_ok = False
        db_err = str(e)

    return {
        "service": "DocRAG",
        "status": "ok" if db_ok else "degraded",
        "db": {"ok": db_ok, "error": db_err},
        "documents": {
            "total_chunks": info.get("total_chunks") if isinstance(info, dict) else None,
            "total_documents": info.get("total_documents") if isinstance(info, dict) else None,
            "embed_model": info.get("embed_model") if isinstance(info, dict) else None,
            "embedding_dim": info.get("embedding_dim") if isinstance(info, dict) else None,
            "by_source_type": info.get("by_source_type") if isinstance(info, dict) else None,
        },
    }


@app.get("/documents/ask")
async def ask(q: str, top_k: int = 5, token: str = ""):

    if not q.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Query cannot be empty")
    user_id = 0
    if token:
        try:
            payload = decode_token(token)
            user_id = int(payload["sub"])
        except:
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


@app.get("/documents/search")
async def search(q: str, top_k: int = 5, mode: str = "advanced"):
    if not q.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Query cannot be empty")
    if mode == "simple":
        results = simple_rag(q, top_k)
    elif mode == "modular":
        results = await modular_rag(q, top_k)
    else:
        results = await search_documents(q, top_k)
    return {"query": q, "mode": mode, "results": results}


@app.post("/documents/numeric-search")
async def numeric_search(body: dict):
    """Векторный поиск по числовым данным — ищет документы с похожими цифровыми паттернами."""
    numbers = body.get("numbers", [])
    top_k = int(body.get("top_k", 5))
    threshold = float(body.get("threshold", 0.5))

    if not numbers:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "numbers array is required")

    # Формируем числовой запрос как текст для эмбеддинга
    query_text = " ".join(str(n) for n in numbers)

    from rag import get_embedding, get_conn
    emb = await get_embedding(query_text)

    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT filename, chunk_index, content, source_type,
                       1 - (embedding <=> %s::vector) AS similarity
                FROM document_chunks
                WHERE 1 - (embedding <=> %s::vector) >= %s
                ORDER BY embedding <=> %s::vector
                LIMIT %s
            """, (emb, emb, threshold, emb, top_k))
            rows = cur.fetchall()

    results = []
    for r in rows:
        content = r[2]
        # Извлекаем числа из чанка для подсветки совпадений
        import re
        found_nums = re.findall(r'[-+]?\d*\.?\d+', content)
        matched = [n for n in numbers if str(n) in found_nums]
        results.append({
            "filename":    r[0],
            "chunk_index": r[1],
            "content":     content[:300],
            "source_type": r[3],
            "similarity":  round(r[4], 4),
            "matched_numbers": matched,
        })

    return {
        "query_numbers": numbers,
        "threshold": threshold,
        "results": results,
        "total": len(results),
    }


@app.delete("/documents/{filename}")
async def delete_document(filename: str):
    from rag import get_conn
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM document_chunks WHERE filename = %s", (filename,))
            deleted = cur.rowcount
        conn.commit()
    if deleted == 0:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Document not found")
    return {"filename": filename, "deleted_chunks": deleted}


@app.get("/documents")
async def list_documents():
    from rag import get_conn
    with get_conn() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT filename, COUNT(*) as chunks
                FROM document_chunks
                GROUP BY filename
                ORDER BY filename
            """)
            rows = cur.fetchall()
    return {"documents": [{"filename": r[0], "chunks": r[1]} for r in rows]}


@app.get("/adaptive/ask")
async def adaptive_ask(q: str, index: str = "auto"):
    if not q.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Query cannot be empty")
    return await adaptive_rag.run(q, index)


@app.post("/adaptive/feedback")
async def adaptive_feedback(body: dict):
    required = {"query", "answer", "index_type", "top_k", "cosine_similarity", "latency_ms", "expert_score"}
    if not required.issubset(body):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Missing required fields")
    if not 1 <= int(body["expert_score"]) <= 5:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "expert_score must be 1-5")
    adaptive_rag.evaluator.save_feedback(
        query=body["query"],
        answer=body["answer"],
        index_type=body["index_type"],
        top_k=int(body["top_k"]),
        cosine=float(body["cosine_similarity"]),
        latency=int(body["latency_ms"]),
        expert_score=int(body["expert_score"]),
        expert_comment=body.get("expert_comment", ""),
    )
    return {"status": "ok"}


@app.get("/adaptive/stats")
async def adaptive_stats():
    return adaptive_rag.evaluator.stats()


@app.get("/adaptive/best-index")
async def adaptive_best_index():
    return {"best_index": adaptive_rag.evaluator.best_index()}


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
    chunks = await multimodal_retrieve(q, top_k)
    summary = await summarize_multimodal(chunks)
    return {"query": q, "summary": summary, "sources_used": len(chunks)}


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
            user_id = 0

    idx_map = {"vector": vector_index, "tree": tree_index, "list": list_index, "keyword": keyword_index}
    if index not in idx_map:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unknown index type. Choose from: {list(idx_map)}")
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
            user_id = 0

    return await compare_indexes(q, top_k, user_id)



@app.post("/documents/feedback")
async def submit_feedback(body: FeedbackRequest, db: AsyncSession = Depends(get_db)):
    if not 1 <= body.score <= 5:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Score must be between 1 and 5")
    feedback = DocumentFeedback(
        query=body.query,
        answer=body.answer,
        score=body.score,
        comment=body.comment,
    )
    db.add(feedback)
    await db.commit()
    return {"status": "ok", "score": body.score}


@app.get("/documents/feedback")
async def get_feedback(db: AsyncSession = Depends(get_db)):
    from sqlalchemy import select as sa_select
    rows = await db.execute(sa_select(DocumentFeedback).order_by(DocumentFeedback.id.desc()).limit(50))
    items = rows.scalars().all()
    avg = sum(i.score for i in items) / len(items) if items else 0
    return {
        "average_score": round(avg, 2),
        "total": len(items),
        "feedback": [{"query": i.query, "score": i.score, "comment": i.comment} for i in items],
    }
