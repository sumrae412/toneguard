"""ToneGuard Supabase sync client — async httpx-based.

Port of src/sync/supabase-client.js + src/sync/sync-manager.js.
No WebSocket subscription (poll-only for MCP server simplicity).
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from learning_store import LearningStore, STORAGE_KEYS
from merge import (
    merge_decisions,
    merge_voice_samples,
    merge_relationships,
    merge_custom_rules,
    merge_stats_history,
)

logger = logging.getLogger("toneguard.sync")

SUPABASE_URL = "https://jimjfaaaccqtcbbxsrys.supabase.co"
SUPABASE_ANON_KEY = "sb_publishable_NyUr9I9amTiVVWT5H8ysvg_lB054qK0"
TABLE = "sync_data"
DEBOUNCE_SECONDS = 5.0
POLL_INTERVAL_SECONDS = 300  # 5 minutes

DATA_TYPES = ["decisions", "voice_samples", "relationships", "custom_rules", "stats_history"]


def hash_api_key(api_key: str) -> str:
    """SHA-256 hex digest — must match JS hashApiKey."""
    return hashlib.sha256(api_key.encode()).hexdigest()


class SyncClient:
    """Lightweight Supabase REST client using httpx."""

    def __init__(self, url: str = SUPABASE_URL, anon_key: str = SUPABASE_ANON_KEY):
        self.url = url
        self.anon_key = anon_key
        self.jwt: Optional[str] = None
        self._client = httpx.AsyncClient(timeout=30.0)

    def _headers(self) -> dict[str, str]:
        return {
            "Content-Type": "application/json",
            "apikey": self.anon_key,
            "Authorization": f"Bearer {self.jwt or self.anon_key}",
        }

    async def authenticate(self, api_key_hash: str) -> str:
        """POST to /functions/v1/auth-by-hash, store JWT."""
        resp = await self._client.post(
            f"{self.url}/functions/v1/auth-by-hash",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {self.anon_key}",
            },
            json={"hash": api_key_hash},
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"Sync auth failed: {resp.status_code}")
        data = resp.json()
        self.jwt = data["token"]
        return self.jwt

    async def pull(self, user_hash: str) -> dict[str, dict]:
        """GET from REST API, return {data_type: {payload, version, updatedAt}}."""
        params = {
            "user_hash": f"eq.{user_hash}",
            "select": "data_type,payload,version,updated_at",
        }
        resp = await self._client.get(
            f"{self.url}/rest/v1/{TABLE}",
            headers=self._headers(),
            params=params,
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"Sync pull failed: {resp.status_code}")

        rows = resp.json()
        result: dict[str, dict] = {}
        for row in rows:
            result[row["data_type"]] = {
                "payload": row["payload"],
                "version": row["version"],
                "updatedAt": row["updated_at"],
            }
        return result

    async def push(self, user_hash: str, data_type: str, payload: Any, version: int) -> None:
        """POST with Prefer: resolution=merge-duplicates."""
        resp = await self._client.post(
            f"{self.url}/rest/v1/{TABLE}",
            headers={
                **self._headers(),
                "Prefer": "resolution=merge-duplicates",
            },
            json={
                "user_hash": user_hash,
                "data_type": data_type,
                "payload": payload,
                "version": (version or 0) + 1,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        if resp.status_code >= 400:
            raise RuntimeError(f"Sync push failed: {resp.status_code}")

    async def close(self) -> None:
        await self._client.aclose()


class SyncManager:
    """Orchestrates local-first sync with Supabase (poll-based, no WebSocket)."""

    def __init__(self, learning_store: LearningStore, client: Optional[SyncClient] = None):
        self.store = learning_store
        self.client = client or SyncClient()
        self.user_hash: Optional[str] = None
        self._remote_versions: dict[str, int] = {}
        self._pending_push: set[str] = set()
        self._debounce_task: Optional[asyncio.Task] = None
        self._poll_task: Optional[asyncio.Task] = None
        self._last_sync_at: Optional[str] = None
        self._connected = False

    @property
    def connected(self) -> bool:
        return self._connected

    @property
    def last_sync_at(self) -> Optional[str]:
        return self._last_sync_at

    async def init(self, api_key: str) -> None:
        """Authenticate + pull + start poll."""
        if not api_key:
            return
        self.user_hash = hash_api_key(api_key)
        try:
            await self.client.authenticate(self.user_hash)
            self._connected = True
            await self.pull()
            self._start_polling()
        except Exception as e:
            logger.error("Sync init failed: %s", e)
            self._connected = False

    async def pull(self) -> None:
        """Pull all remote data and merge with local."""
        if not self.user_hash:
            return
        try:
            remote_data = await self.client.pull(self.user_hash)
        except Exception as e:
            logger.error("Sync pull failed: %s", e)
            return

        for data_type in DATA_TYPES:
            remote = remote_data.get(data_type)
            if not remote:
                continue
            self._remote_versions[data_type] = remote["version"]
            storage_key = STORAGE_KEYS.get(data_type, data_type)
            local_data = self.store.get(data_type)
            merged = self._merge(data_type, local_data, remote["payload"])
            if merged is not None:
                self.store.set(data_type, merged)

        self._last_sync_at = datetime.now(timezone.utc).isoformat()

    def schedule_push(self, data_type: str) -> None:
        """Debounced push (5s)."""
        self._pending_push.add(data_type)
        if self._debounce_task and not self._debounce_task.done():
            self._debounce_task.cancel()
        self._debounce_task = asyncio.ensure_future(self._debounced_push())

    async def _debounced_push(self) -> None:
        await asyncio.sleep(DEBOUNCE_SECONDS)
        await self._flush_push()

    async def _flush_push(self) -> None:
        if not self.user_hash:
            return
        types = list(self._pending_push)
        self._pending_push.clear()

        for data_type in types:
            try:
                storage_key = STORAGE_KEYS.get(data_type, data_type)
                payload = self.store.get(data_type)
                if data_type == "custom_rules" and isinstance(payload, str):
                    payload = {"rules": payload, "updatedAt": datetime.now(timezone.utc).isoformat()}
                version = self._remote_versions.get(data_type, 0)
                await self.client.push(self.user_hash, data_type, payload, version)
                self._remote_versions[data_type] = version + 1
            except Exception as e:
                logger.error("Sync push failed for %s: %s", data_type, e)
                self._pending_push.add(data_type)

        self._last_sync_at = datetime.now(timezone.utc).isoformat()

    def _merge(self, data_type: str, local: Any, remote: Any) -> Any:
        if data_type == "decisions":
            return merge_decisions(local, remote)
        elif data_type == "voice_samples":
            return merge_voice_samples(local, remote)
        elif data_type == "relationships":
            return merge_relationships(local, remote)
        elif data_type == "custom_rules":
            local_wrapped = (
                {"rules": local, "updatedAt": ""}
                if isinstance(local, str)
                else (local or {"rules": "", "updatedAt": ""})
            )
            remote_wrapped = remote or {"rules": "", "updatedAt": ""}
            result = merge_custom_rules(local_wrapped, remote_wrapped)
            return result["rules"]
        elif data_type == "stats_history":
            return merge_stats_history(local, remote)
        else:
            return remote

    def _start_polling(self) -> None:
        if self._poll_task and not self._poll_task.done():
            self._poll_task.cancel()
        self._poll_task = asyncio.ensure_future(self._poll_loop())

    async def _poll_loop(self) -> None:
        while True:
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            await self.pull()

    async def stop(self) -> None:
        """Cancel poll task, flush pending pushes."""
        if self._poll_task and not self._poll_task.done():
            self._poll_task.cancel()
        if self._debounce_task and not self._debounce_task.done():
            self._debounce_task.cancel()
        if self._pending_push:
            await self._flush_push()
        await self.client.close()
