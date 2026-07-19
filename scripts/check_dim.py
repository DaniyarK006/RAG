import sys, json, httpx, asyncio
async def main():
    async with httpx.AsyncClient(timeout=30) as client:
        res = await client.post("http://localhost:11434/api/embeddings", json={
            "model": "bge-m3:latest",
            "prompt": "test dimension"
        })
        d = res.json()
        emb = d["embedding"]
        print(f"bge-m3 dimension: {len(emb)}")
        
        res2 = await client.post("http://localhost:11434/api/embeddings", json={
            "model": "mxbai-embed-large",
            "prompt": "test dimension"
        })
        d2 = res2.json()
        emb2 = d2["embedding"]
        print(f"mxbai-embed-large dimension: {len(emb2)}")
        
        res3 = await client.post("http://localhost:11434/api/embeddings", json={
            "model": "nomic-embed-text",
            "prompt": "test dimension"
        })
        d3 = res3.json()
        emb3 = d3["embedding"]
        print(f"nomic-embed-text dimension: {len(emb3)}")
asyncio.run(main())