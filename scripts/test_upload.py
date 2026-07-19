import httpx, asyncio

async def main():
    # Create test file
    with open("test_upload.txt", "w", encoding="utf-8") as f:
        f.write("Привет мир\n" * 100)
    
    # Upload
    async with httpx.AsyncClient(timeout=120) as client:
        with open("test_upload.txt", "rb") as f:
            files = {"file": ("test_upload.txt", f, "text/plain")}
            res = await client.post("http://localhost:8000/documents/upload", files=files)
            print(f"Status: {res.status_code}")
            print(f"Response: {res.json()}")
    
    # Check DB
    info_res = await client.get("http://localhost:8000/documents/info")
    print(f"Info: {info_res.json()}")

asyncio.run(main())