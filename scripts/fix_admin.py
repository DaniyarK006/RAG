#!/usr/bin/env python3
"""Quick fix: Reset Admin account password"""
import sys
import asyncio
sys.path.insert(0, './backend')

from database import get_db, User
from auth import hash_password
from sqlalchemy import select

async def fix_admin():
    gen = get_db()
    db = await gen.__anext__()
    try:
        result = await db.execute(select(User).where(User.username == "Admin"))
        admin = result.scalar_one_or_none()
        
        if not admin:
            print("Admin user not found, creating...")
            admin = User(
                username="Admin",
                email="admin@localhost",
                hashed_password=hash_password("Admin123")
            )
            db.add(admin)
        else:
            print(f"Admin found (id={admin.id}), resetting password...")
            admin.hashed_password = hash_password("Admin123")
        
        await db.commit()
        print("✓ Admin account fixed! Username: Admin, Password: Admin123")
    finally:
        await db.close()

if __name__ == "__main__":
    asyncio.run(fix_admin())