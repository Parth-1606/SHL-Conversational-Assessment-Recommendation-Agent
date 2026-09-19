import json
import os
from fastapi import APIRouter
from pathlib import Path

router = APIRouter()

# Resolve catalog path relative to repo root
CATALOG_PATH = Path(__file__).resolve().parent.parent / "catalog" / "data" / "catalog.json"


def _load_catalog():
    env_path = os.getenv("CATALOG_JSON_PATH")
    path = Path(env_path) if env_path else CATALOG_PATH
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data
    except Exception:
        return []


@router.get("/catalog", summary="Full SHL catalog with details")
async def get_catalog():
    """Returns the full assessment catalog for the frontend explorer."""
    items = _load_catalog()
    test_types = sorted({i.get("test_type", "General") for i in items})
    return {
        "count": len(items),
        "test_types": test_types,
        "items": items,
    }


@router.get("/catalog/stats", summary="Catalog stats for dashboard")
async def get_catalog_stats():
    items = _load_catalog()
    by_type = {}
    remote_count = 0
    adaptive_count = 0
    for i in items:
        t = i.get("test_type", "General")
        by_type[t] = by_type.get(t, 0) + 1
        if str(i.get("remote_testing", "")).lower() == "yes":
            remote_count += 1
        if str(i.get("adaptive", "")).lower() == "yes":
            adaptive_count += 1
    return {
        "total": len(items),
        "by_type": by_type,
        "remote_friendly": remote_count,
        "adaptive": adaptive_count,
    }
