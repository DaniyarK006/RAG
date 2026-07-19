import httpx


def oauth_login_token_redirect(frontend_url: str, create_token, user_id: str, username: str):
    token = create_token({"sub": str(user_id), "username": username})
    return f"{frontend_url}?token={token}"


async def fetch_json(client: httpx.AsyncClient, url: str, headers: dict | None = None, params: dict | None = None):
    r = await client.get(url, headers=headers, params=params)
    r.raise_for_status()
    return r.json()

