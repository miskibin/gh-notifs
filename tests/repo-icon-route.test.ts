import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/repo-icon/route';
import { COOKIE, signSession } from '../lib/auth';

test('repository images require a valid session before storage or conditional cache handling', async () => {
  for (const cookie of ['', `${COOKIE}=invalid`]) {
    const response = await GET(new Request('https://inbox.example/api/repo-icon?repo=owner/private', {
      headers: { cookie, 'if-none-match': '"cached-image"' },
    }));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
  }
});

test('authenticated image requests reject malformed repository names before storage', async () => {
  process.env.SESSION_SECRET = 'unit-test-icon-route-secret';
  process.env.ALLOWED_GITHUB_LOGIN = 'miskibin';
  const cookie = `${COOKIE}=${signSession('miskibin')}`;
  for (const repo of ['', '../private', 'owner/repo/extra', 'https://localhost/private', 'owner/..']) {
    const response = await GET(new Request(`https://inbox.example/api/repo-icon?repo=${encodeURIComponent(repo)}`, { headers: { cookie } }));
    assert.equal(response.status, 400);
  }
});
