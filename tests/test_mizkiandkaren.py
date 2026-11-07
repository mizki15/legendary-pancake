import base64
import hashlib
import hmac
import io
import json
import re
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch

import requests
from PIL import Image
from werkzeug.security import generate_password_hash

from app import app
from apps.mizkiandkaren.routes import attempts
from apps.mizkiandkaren.store import GoogleStore, SQLiteStore, Unavailable

PASSWORD = 'test journal passphrase only'
PASSWORD_HASH = generate_password_hash(PASSWORD, method='pbkdf2:sha256:1000')


class JournalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.previous = app.config.copy()
        self.path = str(Path(self.temp.name) / 'journal.sqlite3')
        app.config.update(TESTING=True, MIZKI_KAREN_LOCAL_DB=self.path,
                          MIZKI_KAREN_SECRET_KEY='test-only-secret-key-' * 3,
                          MIZKI_KAREN_PASSPHRASE_HASH=PASSWORD_HASH,
                          MIZKI_KAREN_GAS_URL='', MIZKI_KAREN_GAS_SECRET='')
        attempts.clear()
        self.client = app.test_client()

    def tearDown(self):
        app.config.clear()
        app.config.update(self.previous)
        self.temp.cleanup()

    def login(self, client=None):
        client = client or self.client
        page = client.get('/mizkiandkaren/login')
        token = re.search(r'name="login_token" value="([^"]+)"', page.text)[1]
        response = client.post('/mizkiandkaren/login', data={'login_token': token, 'passphrase': PASSWORD})
        self.assertEqual(response.status_code, 302)
        page = client.get('/mizkiandkaren/date_idea')
        return {'X-CSRF-Token': re.search(r'name="csrf-token" content="([^"]+)"', page.text)[1]}

    def create(self, headers, **data):
        response = self.client.post('/mizkiandkaren/api/ideas', json={'title': '海の見えるカフェ', **data}, headers=headers)
        self.assertEqual(response.status_code, 201, response.text)
        return response.json['idea']

    def test_private_pages_and_csrf(self):
        self.assertEqual(self.client.get('/mizkiandkaren/').status_code, 302)
        self.assertEqual(self.client.get('/mizkiandkaren/api/ideas').status_code, 401)
        headers = self.login()
        self.assertEqual(self.client.post('/mizkiandkaren/api/ideas', json={'title': 'test'}).status_code, 403)
        self.assertEqual(self.client.post('/mizkiandkaren/api/ideas', json={'title': 'test'}, headers={'X-CSRF-Token': '不正な値'}).status_code, 403)
        cross = {**headers, 'Origin': 'https://unrelated.example'}
        self.assertEqual(self.client.post('/mizkiandkaren/api/ideas', json={'title': 'test'}, headers=cross).status_code, 403)
        for path in ('/mizkiandkaren/', '/mizkiandkaren/date_idea'):
            page = self.client.get(path)
            self.assertEqual(page.status_code, 200)
            self.assertIn('no-store', page.headers['Cache-Control'])
            self.assertIn("frame-ancestors 'none'", page.headers['Content-Security-Policy'])
        self.assertEqual(self.client.post('/mizkiandkaren/logout', headers=headers).status_code, 302)
        self.assertEqual(self.client.get('/mizkiandkaren/api/ideas').status_code, 401)

    def test_optional_fields_validation_and_versions(self):
        headers = self.login()
        idea = self.create(headers)
        self.assertIsNone(idea['budget'])
        self.assertEqual(idea['seasons'], [])
        self.assertFalse(idea['has_idea_photo'])
        for bad in ({'title': '  '}, {'budget': -1}, {'budget': True}, {'seasons': ['monsoon']}, {'reference_url': 'javascript:alert(1)'}, {'reference_url': 'https://user:pass@example.com'}, {'completed_on': '2999-11-18'}, {'favorite': 'yes'}):
            response = self.client.patch(f"/mizkiandkaren/api/ideas/{idea['id']}", json={**bad, 'version': idea['version']}, headers=headers)
            self.assertEqual(response.status_code, 400, response.text)
        edited = self.client.patch(f"/mizkiandkaren/api/ideas/{idea['id']}", json={'favorite': True, 'budget': 0, 'seasons': ['spring', 'summer', 'autumn', 'winter'], 'version': 1}, headers=headers)
        self.assertEqual(edited.status_code, 200)
        self.assertEqual(edited.json['idea']['version'], 2)
        stale = self.client.patch(f"/mizkiandkaren/api/ideas/{idea['id']}", json={'title': 'stale overwrite', 'version': 1}, headers=headers)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(self.client.get('/mizkiandkaren/api/ideas').json['ideas'][0]['title'], idea['title'])

    def test_archive_trash_restore_and_thirty_day_expiry(self):
        headers = self.login()
        idea = self.create(headers)
        path = f"/mizkiandkaren/api/ideas/{idea['id']}"
        self.assertEqual(self.client.post(path + '/trash', json=['invalid'], headers=headers).status_code, 400)
        archived = self.client.patch(path, json={'version': 1, 'completed_on': '2026-01-01', 'memory': '楽しかった'}, headers=headers).json['idea']
        self.assertEqual(archived['completed_on'], '2026-01-01')
        trashed = self.client.post(path + '/trash', json={'version': 2}, headers=headers).json['idea']
        self.assertTrue(trashed['deleted_at'])
        restored = self.client.post(path + '/restore', json={'version': 3}, headers=headers).json['idea']
        self.assertIsNone(restored['deleted_at'])
        self.assertEqual(restored['memory'], '楽しかった')
        again = self.client.patch(path, json={'version': 4, 'completed_on': None}, headers=headers).json['idea']
        self.assertIsNone(again['completed_on'])
        self.assertEqual(again['memory'], '楽しかった')
        self.client.post(path + '/trash', json={'version': 5}, headers=headers)
        with SQLiteStore(self.path).connection() as db:
            db.execute('UPDATE mk_ideas SET deleted_at=?', ((datetime.now(timezone.utc) - timedelta(days=31)).isoformat(),))
        self.assertEqual(self.client.get('/mizkiandkaren/api/ideas').json['ideas'], [])
        self.assertEqual(self.client.post(path + '/restore', json={'version': 6}, headers=headers).status_code, 400)

    def test_two_photos_compressed_private_and_replaced_independently(self):
        headers = self.login()
        def image():
            out = io.BytesIO()
            photo = Image.new('RGB', (2400, 1600), '#c0b080')
            exif = photo.getexif(); exif[270] = 'private location note'
            photo.save(out, format='JPEG', exif=exif); out.seek(0)
            return out
        response = self.client.post('/mizkiandkaren/api/ideas', data={
            'data': json.dumps({'title': '写真つき', 'completed_on': '2026-01-01'}),
            'idea_photo': (image(), 'idea.jpg'), 'memory_photo': (image(), 'memory.jpg'),
        }, headers=headers)
        self.assertEqual(response.status_code, 201, response.text)
        idea = response.json['idea']
        for kind in ('idea', 'memory'):
            url = idea[f'{kind}_photo_url']
            loaded = self.client.get(url)
            self.assertEqual(loaded.status_code, 200)
            self.assertLessEqual(len(loaded.data), 350000)
            result = Image.open(io.BytesIO(loaded.data))
            self.assertLessEqual(max(result.size), 1400)
            self.assertFalse(result.getexif())
            self.assertEqual(app.test_client().get(url).status_code, 401)
        edited = self.client.patch(f"/mizkiandkaren/api/ideas/{idea['id']}", json={'version': 1, 'remove_photos': ['idea']}, headers=headers).json['idea']
        self.assertIsNone(edited['idea_photo_url'])
        self.assertTrue(edited['memory_photo_url'])
        self.assertEqual(self.client.get(idea['idea_photo_url']).status_code, 404)
        with SQLiteStore(self.path).connection() as db:
            db.execute('UPDATE mk_ideas SET deleted_at=?', ((datetime.now(timezone.utc) - timedelta(days=31)).isoformat(),))
        self.assertEqual(self.client.get(idea['memory_photo_url']).status_code, 404)
        self.client.get('/mizkiandkaren/api/ideas')
        with SQLiteStore(self.path).connection() as db:
            self.assertEqual(db.execute('SELECT count(*) FROM mk_photos').fetchone()[0], 0)

    def test_fail_closed_and_never_use_ephemeral_render_disk(self):
        headers = self.login()
        with patch.dict('os.environ', {'RENDER': 'true'}):
            self.assertEqual(self.client.get('/mizkiandkaren/api/ideas').status_code, 503)
        app.config['MIZKI_KAREN_PASSPHRASE_HASH'] = ''
        self.assertEqual(self.client.get('/mizkiandkaren/login').status_code, 503)
        self.assertEqual(self.client.get('/mizkiandkaren/api/ideas').status_code, 401)

    def test_passphrase_rotation_invalidates_old_cookie(self):
        self.login()
        app.config['MIZKI_KAREN_PASSPHRASE_HASH'] = generate_password_hash('new test passphrase', method='pbkdf2:sha256:1000')
        self.assertEqual(self.client.get('/mizkiandkaren/api/ideas').status_code, 401)

    def test_anniversary_is_only_embedded_after_login(self):
        value = '2020-02-03T00:00:00+09:00'
        app.config['MIZKI_KAREN_ANNIVERSARY_START'] = value
        public = self.client.get('/mizkiandkaren/login')
        self.assertNotIn(value, public.text)
        self.assertNotIn('2020/02/03', public.text)
        self.login()
        private = self.client.get('/mizkiandkaren/')
        self.assertIn('data-anniversary="' + value + '"', private.text)
        self.assertIn('2020/02/03', private.text)
        self.assertIn('no-store', private.headers['Cache-Control'])

    def test_photo_cache_revalidates_after_authentication_and_expires(self):
        headers = self.login()
        image = io.BytesIO()
        Image.new('RGB', (40, 30), '#9e7279').save(image, format='PNG')
        image.seek(0)
        response = self.client.post('/mizkiandkaren/api/ideas', data={
            'data': json.dumps({'title': 'キャッシュの確認'}),
            'idea_photo': (image, 'photo.png'),
        }, headers=headers)
        url = response.json['idea']['idea_photo_url']
        original = SQLiteStore.photo
        with patch.object(SQLiteStore, 'photo', autospec=True, side_effect=original) as download:
            with patch('apps.mizkiandkaren.photo_cache.time.monotonic', return_value=100):
                first = self.client.get(url)
                self.assertEqual(first.status_code, 200)
                etag = first.headers['ETag']
                self.assertIn('private', first.headers['Cache-Control'])
                self.assertIn('no-cache', first.headers['Cache-Control'])
                second = self.client.get(url, headers={'If-None-Match': etag})
                self.assertEqual(second.status_code, 304)
                self.assertEqual(second.data, b'')
                self.assertEqual(download.call_count, 1)
                anonymous = app.test_client().get(url, headers={'If-None-Match': etag})
                self.assertEqual(anonymous.status_code, 401)
                self.assertIn('no-store', anonymous.headers['Cache-Control'])
            with patch('apps.mizkiandkaren.photo_cache.time.monotonic', return_value=161):
                self.assertEqual(self.client.get(url).status_code, 200)
                self.assertEqual(download.call_count, 2)
        self.client.post('/mizkiandkaren/logout', headers=headers)
        self.assertEqual(self.client.get(url, headers={'If-None-Match': etag}).status_code, 401)

    def test_cached_photo_is_invalidated_by_removal_and_storage_change(self):
        headers = self.login()
        image = io.BytesIO()
        Image.new('RGB', (40, 30), '#9e7279').save(image, format='PNG')
        image.seek(0)
        first = self.client.post('/mizkiandkaren/api/ideas', data={
            'data': json.dumps({'title': '保存先の確認'}),
            'idea_photo': (image, 'photo.png'),
        }, headers=headers).json['idea']
        url = first['idea_photo_url']
        original = self.client.get(url).data
        other = str(Path(self.temp.name) / 'other-account.sqlite3')
        image = io.BytesIO()
        Image.new('RGB', (40, 30), '#4c6479').save(image, format='WEBP')
        payload = {'title': '別の保存先', 'has_idea_photo': True}
        SQLiteStore(other).save({'id': first['id'], 'payload': payload, 'deleted_at': None}, 0, {'idea': image.getvalue()})
        app.config['MIZKI_KAREN_LOCAL_DB'] = other
        self.assertNotEqual(self.client.get(url).data, original)
        app.config['MIZKI_KAREN_LOCAL_DB'] = self.path
        removed = self.client.patch(f"/mizkiandkaren/api/ideas/{first['id']}", json={'version': 1, 'remove_photos': ['idea']}, headers=headers)
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(self.client.get(url).status_code, 404)

    def test_login_rate_limit(self):
        for i in range(11):
            page = self.client.get('/mizkiandkaren/login')
            token = re.search(r'name="login_token" value="([^"]+)"', page.text)[1]
            response = self.client.post('/mizkiandkaren/login', data={'login_token': token, 'passphrase': 'wrong'})
            self.assertEqual(response.status_code, 401 if i < 10 else 429)


class GoogleTransportTests(unittest.TestCase):
    @patch('apps.mizkiandkaren.store.requests.post')
    def test_signed_request_preserves_unicode_and_keeps_secrets_out_of_payload(self, post):
        post.return_value = Mock(ok=True, json=lambda: {'ok': True, 'result': []})
        secret = 'transport-test-secret-' * 3
        self.assertEqual(GoogleStore('https://script.google.com/macros/s/test/exec', secret).list(), [])
        envelope = post.call_args.kwargs['json']
        expected = hmac.new(secret.encode(), f"{envelope['timestamp']}\n{envelope['nonce']}\n{envelope['payload']}".encode(), hashlib.sha256).hexdigest()
        self.assertEqual(envelope['signature'], expected)
        self.assertEqual(json.loads(base64.b64decode(envelope['payload'])), {'action': 'list'})
        self.assertNotIn(secret, json.dumps(envelope))

    @patch('apps.mizkiandkaren.store.requests.post', side_effect=requests.Timeout)
    def test_timeout_does_not_fallback_or_retry_a_write(self, post):
        with self.assertRaises(Unavailable):
            GoogleStore('https://script.google.com/macros/s/test/exec', 'x' * 32).save({'id': 'test', 'payload': {}, 'deleted_at': None}, 0)
        self.assertEqual(post.call_count, 1)


if __name__ == '__main__':
    unittest.main()
