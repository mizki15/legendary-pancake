"""A small, process-local cache of already authenticated photo downloads."""

import threading
import time
from collections import OrderedDict


class PhotoCache:
    def __init__(self, ttl=60, max_bytes=16 * 1024 * 1024, max_entries=48):
        self.ttl = ttl
        self.max_bytes = max_bytes
        self.max_entries = max_entries
        self.entries = OrderedDict()
        self.size = 0
        self.lock = threading.Lock()

    def _remove(self, key):
        _, data = self.entries.pop(key)
        self.size -= len(data)

    def get(self, key):
        with self.lock:
            entry = self.entries.get(key)
            if entry is None:
                return None
            expires, data = entry
            if expires <= time.monotonic():
                self._remove(key)
                return None
            self.entries.move_to_end(key)
            return data

    def put(self, key, data):
        if len(data) > self.max_bytes:
            return
        with self.lock:
            if key in self.entries:
                self._remove(key)
            now = time.monotonic()
            for stale in [k for k, (expires, _) in self.entries.items() if expires <= now]:
                self._remove(stale)
            self.entries[key] = (now + self.ttl, data)
            self.size += len(data)
            while self.size > self.max_bytes or len(self.entries) > self.max_entries:
                self._remove(next(iter(self.entries)))

    def invalidate(self, namespace, idea_id):
        with self.lock:
            for key in [key for key in self.entries if key[:2] == (namespace, idea_id)]:
                self._remove(key)

    def reconcile(self, namespace, rows):
        """A list refresh also observes edits made by other workers or devices."""
        records = {row["id"]: row for row in rows}
        with self.lock:
            for key in list(self.entries):
                space, idea_id, kind, version = key
                if space != namespace:
                    continue
                row = records.get(idea_id)
                if row is None or str(row["version"]) != version or not row["payload"].get(f"has_{kind}_photo"):
                    self._remove(key)
