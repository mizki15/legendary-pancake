import copy
import unittest
from unittest.mock import Mock, patch

import requests

from app import app
from apps.mizkiandkaren.routes import store, photo_namespace, signer
from apps.mizkiandkaren.store import Conflict, Unavailable
from apps.mizkiandkaren.supabase_store import SupabaseStore


class SupabaseTests(unittest.TestCase):
    def setUp(self):
        self.google = Mock()
        self.storage = SupabaseStore('https://test-project.supabase.co', 'sb_secret_' + 'x' * 40, self.google)
        self.record = {'id': '1d3650ac-a84f-4b51-b45f-a3eea5a4f917', 'version': 2,
                       'payload': {'title': '散歩'}, 'deleted_at': None,
                       'idea_photo_id': 'old-idea', 'memory_photo_id': 'old-memory'}

    def test_text_only_operations_never_contact_google(self):
        with patch.object(self.storage, 'request', side_effect=[[self.record], {**self.record, 'version': 3}]) as call:
            self.assertEqual(self.storage.list(), [self.record])
            saved = self.storage.save(self.record, 2)
            self.assertEqual(saved['version'], 3)
            params = call.call_args.kwargs['json']
            self.assertEqual(params['p_idea_photo_id'], 'old-idea')
            self.assertEqual(params['p_memory_photo_id'], 'old-memory')
            self.assertEqual(params['p_expected'], 2)
        self.google.request.assert_not_called()

    def test_stale_editor_does_not_upload_and_timeout_does_not_delete(self):
        with patch.object(self.storage, 'get', return_value=self.record):
            with self.assertRaises(Conflict):
                self.storage.save(self.record, 1, {'idea': b'photo'})
        self.google.request.assert_not_called()
        self.google.request.return_value = 'new-file'
        with patch.object(self.storage, 'get', return_value=self.record), patch.object(self.storage, 'request', side_effect=Unavailable):
            with self.assertRaises(Unavailable):
                self.storage.save(self.record, 2, {'idea': b'photo'})
        self.assertEqual(self.google.request.call_count, 1)
        self.assertEqual(self.google.request.call_args.args[0], 'upload_file')

    def test_new_photo_and_removal_preserve_the_other_slot(self):
        self.google.request.return_value = 'new-file'
        with patch.object(self.storage, 'get', return_value=self.record), patch.object(self.storage, 'request', return_value=self.record) as call:
            self.storage.save(self.record, 2, {'idea': b'photo'}, ['memory'])
            data = call.call_args.kwargs['json']
            self.assertEqual(data['p_idea_photo_id'], 'new-file')
            self.assertIsNone(data['p_memory_photo_id'])

    def test_expired_or_missing_record_never_reads_drive(self):
        with patch.object(self.storage, 'get', return_value=None):
            self.assertIsNone(self.storage.photo(self.record['id'], 'idea'))
        self.google.request.assert_not_called()
        with patch.object(self.storage, 'get', return_value=self.record):
            self.google.request.return_value = 'cGhvdG8='
            self.assertEqual(self.storage.photo(self.record['id'], 'memory'), b'photo')
            self.google.request.assert_called_with('read_file', file_id='old-memory')

    def test_pagination_and_expiry_filter(self):
        with patch.object(self.storage, 'request', side_effect=[[self.record] * 500, [self.record]]) as call:
            self.assertEqual(len(self.storage.list()), 501)
            self.assertEqual(call.call_args.kwargs['params']['offset'], 500)
            self.assertIn('deleted_at.gt.', call.call_args.kwargs['params']['or'])

    def test_server_keys_and_safe_network_errors(self):
        with patch('apps.mizkiandkaren.supabase_store.requests.request', return_value=Mock(ok=True, status_code=200, json=lambda: [])) as call:
            self.storage.list()
            self.assertNotIn('Authorization', call.call_args.kwargs['headers'])
            self.assertEqual(call.call_args.kwargs['headers']['apikey'], self.storage.key)
            self.assertFalse(call.call_args.kwargs['allow_redirects'])
            self.storage.key = 'legacy-service-role-jwt'
            self.storage.list()
            self.assertEqual(call.call_args.kwargs['headers']['Authorization'], 'Bearer legacy-service-role-jwt')
        for failure in [requests.Timeout('private key in upstream exception'), ValueError('private response')]:
            with patch('apps.mizkiandkaren.supabase_store.requests.request', side_effect=failure):
                with self.assertRaises(Unavailable) as caught:
                    self.storage.list()
                self.assertEqual(str(caught.exception), '')
        with patch('apps.mizkiandkaren.supabase_store.requests.request', return_value=Mock(ok=False, status_code=409)):
            with self.assertRaises(Conflict):
                self.storage.save(self.record, 0)

    def test_explicit_backend_does_not_fall_back_on_configuration_failure(self):
        settings = dict(MIZKI_KAREN_LOCAL_DB='', MIZKI_KAREN_STORAGE='supabase',
                        MIZKI_KAREN_GAS_URL='https://script.google.com/macros/s/test/exec',
                        MIZKI_KAREN_GAS_SECRET='x'*40,
                        MIZKI_KAREN_SUPABASE_URL=self.storage.url,
                        MIZKI_KAREN_SUPABASE_KEY=self.storage.key)
        with app.app_context(), patch.dict(app.config, settings):
            self.assertIsInstance(store(), SupabaseStore)
            original = photo_namespace()
            app.config['MIZKI_KAREN_SUPABASE_URL'] = 'https://another.supabase.co'
            self.assertNotEqual(photo_namespace(), original)
            app.config['MIZKI_KAREN_SUPABASE_KEY'] = ''
            with self.assertRaises(Unavailable):
                store()
            app.config['MIZKI_KAREN_STORAGE'] = 'typo'
            with self.assertRaises(Unavailable):
                store()

    def test_flask_metadata_workflow_keeps_keys_private_and_never_calls_google(self):
        settings = dict(MIZKI_KAREN_LOCAL_DB='', MIZKI_KAREN_STORAGE='supabase',
                        MIZKI_KAREN_SECRET_KEY='test-cookie-secret-'*3,
                        MIZKI_KAREN_PASSPHRASE_HASH='test-cookie-salt-only',
                        MIZKI_KAREN_GAS_URL='https://script.google.com/macros/s/test/exec',
                        MIZKI_KAREN_GAS_SECRET='x'*40,
                        MIZKI_KAREN_SUPABASE_URL=self.storage.url,
                        MIZKI_KAREN_SUPABASE_KEY=self.storage.key)
        rows = {}

        def http(method, url, **kwargs):
            status = 200
            if method == 'GET':
                result = list(rows.values())
                requested = kwargs['params'].get('id')
                if requested:
                    result = [row for row in result if row['id'] == requested[3:]]
            else:
                self.assertTrue(url.endswith('/rpc/mk_save_idea'))
                data = kwargs['json']
                previous = rows.get(data['p_id'])
                if data['p_expected'] != (previous['version'] if previous else 0):
                    result, status = {}, 409
                else:
                    result = dict(id=data['p_id'], version=data['p_expected']+1,
                                  payload=data['p_payload'], deleted_at=data['p_deleted_at'],
                                  idea_photo_id=data['p_idea_photo_id'], memory_photo_id=data['p_memory_photo_id'])
                    rows[result['id']] = copy.deepcopy(result)
            return Mock(ok=status==200, status_code=status, json=lambda: copy.deepcopy(result))

        with patch.dict(app.config, settings), app.app_context(), \
                patch('apps.mizkiandkaren.supabase_store.requests.request', side_effect=http), \
                patch('apps.mizkiandkaren.store.GoogleStore.request', side_effect=AssertionError('Google called')):
            client = app.test_client()
            self.assertEqual(client.get('/mizkiandkaren/api/ideas').status_code, 401)
            client.set_cookie('mk_journal', signer().dumps({'csrf':'test-csrf'}), path='/mizkiandkaren')
            headers = {'X-CSRF-Token':'test-csrf'}
            for path in ['/mizkiandkaren/', '/mizkiandkaren/date_idea']:
                html = client.get(path).text
                self.assertNotIn(self.storage.key, html)
                self.assertNotIn(self.storage.url, html)
            self.assertEqual(client.post('/mizkiandkaren/api/ideas', json={'title':'散歩'}).status_code,403)
            created = client.post('/mizkiandkaren/api/ideas', json={'title':'散歩'},headers=headers)
            self.assertEqual(created.status_code,201)
            idea = created.json['idea']
            self.assertNotIn('idea_photo_id',idea)
            self.assertNotIn('memory_photo_id',idea)
            path = '/mizkiandkaren/api/ideas/'+idea['id']
            self.assertEqual(client.patch(path,json={'version':1,'favorite':True},headers=headers).status_code,200)
            self.assertEqual(client.patch(path,json={'version':1,'title':'stale'},headers=headers).status_code,409)
            self.assertEqual(client.post(path+'/trash',json={'version':2},headers=headers).status_code,200)
            self.assertEqual(client.post(path+'/restore',json={'version':3},headers=headers).status_code,200)
            listed = client.get('/mizkiandkaren/api/ideas').json['ideas']
            self.assertEqual(listed[0]['version'],4)
            self.assertTrue(listed[0]['favorite'])
