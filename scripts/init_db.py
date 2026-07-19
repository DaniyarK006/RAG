import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from database import init_db  # type: ignore

if __name__ == "__main__":
    asyncio.run(init_db())
    print("Database initialized successfully.")
