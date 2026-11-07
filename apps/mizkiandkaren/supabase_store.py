"""Server-only Supabase metadata, with immutable private Drive photo references."""

import base64
import re

import requests

from .store import Conflict, Unavailable, cutoff


class SupabaseStore:
    def __init__(self, url, key, google):
        self.url = url.rstrip('/')
        self.key = key
        self.google = google

    def request(self, method, path, **kwargs):
        headers = {'apikey': self.key, 'Accept': 'application/json'}
        # Modern sb_secret keys belong in apikey only; legacy service_role is a JWT.
        if not self.key.startswith('sb_secret_'):
            headers['Authorization'] = 'Bearer ' + self.key
        try:
            response = requests.request(method, self.url + '/rest/v1/' + path,
                                        headers=headers, timeout=(5, 15),
                                        allow_redirects=False, **kwargs)
            if response.status_code == 409:
                raise Conflict
            if not response.ok:
                raise Unavailable
            return response.json()
        except (requests.RequestException, ValueError):
            # Do not leak response bodies, keys, private content or project URLs.
            raise Unavailable from None

    def list(self):
        result = []
        while True:
            rows = self.request('GET', 'mk_ideas', params={
                'select': '*', 'order': 'id', 'limit': 500, 'offset': len(result),
                'or': f'(deleted_at.is.null,deleted_at.gt.{cutoff()})',
            })
            if not isinstance(rows, list):
                raise Unavailable
            result.extend(rows)
            if len(rows) < 500:
                return result

    def get(self, idea_id):
        rows = self.request('GET', 'mk_ideas', params={
            'select': '*', 'id': 'eq.' + idea_id,
            'or': f'(deleted_at.is.null,deleted_at.gt.{cutoff()})',
        })
        if not isinstance(rows, list):
            raise Unavailable
        return rows[0] if rows else None

    def save(self, record, expected, photos=None, remove_photos=()):
        # A stale editor must fail before uploading new files. The DB still checks
        # the version atomically, since another editor can save during the upload.
        # Routes already fetched the current record. Reuse it rather than making
        # a second network round trip for every text-only edit.
        old = (record if 'version' in record else self.get(record['id'])) if expected else None
        if expected and (old is None or old['version'] != expected):
            raise Conflict
        refs = {kind: old.get(kind + '_photo_id') if old else None for kind in ('idea', 'memory')}
        for kind in remove_photos:
            refs[kind] = None
        for kind, data in (photos or {}).items():
            file_id = self.google.request('upload_file', id=record['id'], kind=kind,
                                           data=base64.b64encode(data).decode('ascii'))
            if not isinstance(file_id, str) or not re.fullmatch(r'[A-Za-z0-9_-]+', file_id):
                raise Unavailable
            refs[kind] = file_id
        # On timeout the commit may have succeeded. Never eagerly delete newly
        # uploaded files: the hourly worker removes only unreferenced files >24h.
        saved = self.request('POST', 'rpc/mk_save_idea', json={
            'p_id': record['id'], 'p_expected': expected,
            'p_payload': record['payload'], 'p_deleted_at': record['deleted_at'],
            'p_idea_photo_id': refs['idea'], 'p_memory_photo_id': refs['memory'],
        })
        if not isinstance(saved, dict) or saved.get('id') != record['id']:
            raise Unavailable
        return saved

    def photo(self, idea_id, kind):
        row = self.get(idea_id)
        file_id = row.get(kind + '_photo_id') if row else None
        if not file_id:
            return None
        data = self.google.request('read_file', file_id=file_id)
        try:
            return base64.b64decode(data, validate=True) if data else None
        except (ValueError, TypeError):
            raise Unavailable from None
