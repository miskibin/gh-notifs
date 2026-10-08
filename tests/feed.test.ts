import test from 'node:test';
import assert from 'node:assert/strict';
import { chronologicalFeed, eventTitle, eventLabel, repositoryLabel } from '../lib/feed';
import type { ActivityEvent } from '../lib/types';

const event = (id: string, repo: string, minute: number, changes: Partial<ActivityEvent> = {}): ActivityEvent => ({
  id, repo, kind: 'push', createdAt: `2026-10-08T11:${String(minute).padStart(2, '0')}:00.000Z`,
  title: 'Push to main', body: 'Branch pushed', actor: 'agent', branch: 'main', action: 'pushed', url: 'https://github.com', ...changes,
});

test('timeline interleaves repositories by event time without losing events or mutating input', () => {
  const input = [event('1', 'one/app', 10), event('2', 'two/api', 40), event('3', 'one/app', 50), event('4', 'two/api', 20)];
  const result = chronologicalFeed(input);
  assert.deepEqual(result.map(item => item.id), ['3', '2', '4', '1']);
  assert.deepEqual(result.map(item => item.repo), ['one/app', 'two/api', 'two/api', 'one/app']);
  assert.deepEqual(input.map(item => item.id), ['1', '2', '3', '4']);
  assert.deepEqual(chronologicalFeed([]), []);
});

test('feed promotes actual commit content and keeps total even when GitHub truncates the commit array', () => {
  const push = event('1', 'one/app', 10, { title: '103 commits pushed to main', commits: [{ sha: 'a', message: 'Fix offline sync\nImplementation details', url: 'https://github.com' }] });
  assert.equal(eventTitle(push), 'Fix offline sync');
  assert.equal(eventLabel(push), '103 commits');
  assert.equal(eventLabel({ ...push, action: 'created' }), '103 commits');
  assert.equal(eventTitle({ ...push, action: 'deleted', title: 'Deleted feature' }), 'Deleted feature');
  assert.equal(eventLabel(event('2', 'one/app', 10)), 'Push');
});

test('PR action and number remain visible while the main title loses boilerplate', () => {
  const pr = event('1', 'one/app', 10, { kind: 'pr', action: 'ready_for_review', title: 'PR #42 ready_for_review: Fix navigation: keyboard focus' });
  assert.equal(eventTitle(pr), 'Fix navigation: keyboard focus');
  assert.equal(eventLabel(pr), 'PR #42 ready for review');
  assert.equal(eventLabel({ ...pr, action: 'merged' }), 'PR #42 merged');
});

test('same-name repositories retain the owner to prevent ambiguous group headings', () => {
  assert.equal(repositoryLabel('one/app', ['one/app', 'two/api']), 'app');
  assert.equal(repositoryLabel('one/app', ['one/app', 'one/app']), 'app');
  assert.equal(repositoryLabel('one/app', ['one/app', 'two/app']), 'one/app');
});
