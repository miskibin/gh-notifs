import type { ActivityEvent } from './types';

export interface FeedGroup {
  repo: string;
  events: ActivityEvent[];
  latestAt: string;
}

// Group only the already-filtered, loaded events. Never invent a total across pages.
export function groupFeed(events: ActivityEvent[]): FeedGroup[] {
  const groups = new Map<string, FeedGroup>();
  const ordered = [...events].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
  for (const event of ordered) {
    const group = groups.get(event.repo);
    if (group) group.events.push(event);
    else groups.set(event.repo, { repo: event.repo, events: [event], latestAt: event.createdAt });
  }
  return [...groups.values()];
}

const prActions: Record<string, string> = {
  synchronize: 'updated', edited: 'edited', ready_for_review: 'ready for review',
  converted_to_draft: 'draft', review_requested: 'review requested',
  review_request_removed: 'review removed', reviewed: 'reviewed', commented: 'comment',
};

export function eventLabel(event: ActivityEvent): string {
  if (event.kind === 'ci') return event.action === 'cancelled' ? 'CI cancelled' : 'CI failed';
  if (event.kind === 'pr') {
    const number = event.title.match(/^PR #(\d+)\b/)?.[1] || event.body.match(/pull request #(\d+)\b/i)?.[1];
    const action = prActions[event.action] || event.action.replaceAll('_', ' ');
    return `PR${number ? ` #${number}` : ''} ${action}`;
  }
  if (event.action === 'deleted') return 'Branch deleted';
  // A newly created branch may contain a real push. Keep its commit count.
  const count = event.title.match(/^(\d+) commits? pushed\b/i)?.[1]
    || event.body.match(/^Pushed (\d+) commits?\b/i)?.[1];
  const total = count ? Number(count) : event.commits?.length;
  if (total) return `${total} commit${total === 1 ? '' : 's'}`;
  return event.action === 'created' ? 'Branch created' : 'Push';
}

export function eventTitle(event: ActivityEvent): string {
  if (event.kind === 'pr') return event.title.replace(/^PR #\d+ [\w ]+:\s*/, '') || event.title;
  if (event.kind !== 'push' || event.action === 'deleted') return event.title;
  const message = event.commits?.find(commit => commit.message.trim())?.message.split('\n')[0].trim();
  if (message) return message;
  return event.title;
}

export function repositoryLabel(fullName: string, repositories: string[]): string {
  const basename = fullName.split('/').at(-1) || fullName;
  const owners = new Set(repositories.filter(repo => repo.split('/').at(-1)?.toLowerCase() === basename.toLowerCase()));
  return owners.size > 1 ? fullName : basename;
}
