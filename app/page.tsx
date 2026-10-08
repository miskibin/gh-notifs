'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Activity, ArrowDownToLine, ArrowUpRight, Bell, BellOff, Check, CheckCheck, ChevronRight, ExternalLink, GitBranch, GitCommitHorizontal, GitPullRequest, Github, LoaderCircle, LockKeyhole, LogOut, RefreshCw, Search, Settings2, ShieldCheck, X, XCircle } from 'lucide-react';
import type { ActivityEvent, AppStatus, RepoStatus } from '@/lib/types';

type Screen = 'activity' | 'repos' | 'settings';
type Filter = 'all' | 'push' | 'pr' | 'ci';
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const demoRepos: RepoStatus[] = [
  { id: 1, fullName: 'michal/atlas-web', private: true, muted: false, mode: 'live', url: 'https://github.com' },
  { id: 2, fullName: 'michal/agent-toolkit', private: false, muted: false, mode: 'live', url: 'https://github.com' },
  { id: 3, fullName: 'michal/orbit-api', private: true, muted: false, mode: 'live', url: 'https://github.com' },
  { id: 4, fullName: 'michal/dotfiles', private: false, muted: true, mode: 'delayed', url: 'https://github.com' },
];
function samples(): ActivityEvent[] {
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60000).toISOString();
  return [
    { id: 'demo-ci-1', kind: 'ci', repo: 'michal/atlas-web', title: 'Production build failed', body: 'Build & deploy · 1 failed job', actor: 'github-actions', branch: 'agent/navigation', url: 'https://github.com', createdAt: ago(3), action: 'failure' },
    { id: 'demo-pr-1', kind: 'pr', repo: 'michal/atlas-web', title: 'Simplify the mobile navigation', body: 'Opened pull request #42', actor: 'codex', branch: 'agent/navigation', url: 'https://github.com', createdAt: ago(8), action: 'opened' },
    { id: 'demo-push-1', kind: 'push', repo: 'michal/agent-toolkit', title: 'Add retry handling to the task runner', body: 'Pushed 3 commits', actor: 'codex', branch: 'main', url: 'https://github.com', createdAt: ago(18), action: 'pushed', commits: [{sha:'a3f82c1',message:'Add retry handling to the task runner',url:'https://github.com'},{sha:'8d271b0',message:'Cover interrupted jobs with regression tests',url:'https://github.com'},{sha:'e9120ac',message:'Update runner documentation',url:'https://github.com'}] },
    { id: 'demo-pr-2', kind: 'pr', repo: 'michal/orbit-api', title: 'Cache frequently requested endpoints', body: 'Merged pull request #18', actor: 'codex', branch: 'agent/cache', url: 'https://github.com', createdAt: ago(52), action: 'merged' },
    { id: 'demo-push-2', kind: 'push', repo: 'michal/atlas-web', title: 'Improve keyboard focus states', body: 'Pushed 1 commit', actor: 'codex', branch: 'main', url: 'https://github.com', createdAt: ago(81), action: 'pushed', commits: [{sha:'f6b298d',message:'Improve keyboard focus states',url:'https://github.com'}] },
  ];
}
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options?.headers }, cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data as T;
}
function timeAgo(value: string) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}
function EventIcon({ event, size = 19 }: { event: ActivityEvent; size?: number }) {
  return event.kind === 'push' ? <GitCommitHorizontal size={size} /> : event.kind === 'pr' ? <GitPullRequest size={size} /> : failure(event) ? <XCircle size={size} /> : <Check size={size} />;
}
function RepoAvatar({ repo, demo, event, large = false }: { repo: string; demo: boolean; event?: ActivityEvent; large?: boolean }) {
  const [failedRepo, setFailedRepo] = useState<string | null>(null);
  const unavailable = failedRepo === repo;
  const name = repo.split('/').pop() || repo;
  const words = name.split(/[-_.\s]+/).filter(Boolean);
  const initials = (words.length > 1 ? words[0][0] + words[1][0] : name.slice(0, 2)).toUpperCase();
  const tone = [...name].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 4;
  const label = event ? failure(event) ? 'Failed CI' : event.kind === 'push' ? 'Push' : event.kind === 'pr' ? 'Pull request' : 'CI' : '';
  return <span className={`repo-avatar avatar-tone-${tone}${large ? ' avatar-large' : ''}`}>
    {!demo && !unavailable ? <img src={`/api/repo-icon?repo=${encodeURIComponent(repo)}`} alt="" width={large ? 44 : 36} height={large ? 44 : 36} loading="lazy" decoding="async" onError={() => setFailedRepo(repo)} /> : <span className="repo-initials" aria-hidden="true">{initials}</span>}
    {event && <span className={`event-badge ${failure(event) ? 'failed' : event.kind === 'pr' ? 'pull-request' : event.kind === 'ci' ? 'passed' : ''}`} aria-label={label} title={label}><EventIcon event={event} size={12}/></span>}
  </span>;
}
function failure(event: ActivityEvent) { return event.kind === 'ci' && ['failed', 'failure', 'timed_out', 'cancelled', 'action_required', 'startup_failure'].includes(event.action); }
function safeLink(value: string) { try { const parsed = new URL(value); return parsed.protocol === 'https:' && parsed.hostname === 'github.com' ? value : 'https://github.com'; } catch { return 'https://github.com'; } }
function vapidBytes(key: string) { const decoded = atob(key.replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(decoded, (char) => char.charCodeAt(0)); }

export default function Home() {
  const [demo, setDemo] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [syncPending, setSyncPending] = useState(false);
  const [repos, setRepos] = useState<RepoStatus[]>([]);
  const [screen, setScreen] = useState<Screen>('activity');
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [read, setRead] = useState<string[]>([]);
  const [selected, setSelected] = useState<ActivityEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [token, setToken] = useState('');
  const [installed, setInstalled] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);

  const load = useCallback(async (preserve = false) => {
    const next = await api<AppStatus>('/api/status');
    setStatus(next);
    if (next.authenticated) {
      const [feed, list] = await Promise.all([api<{ events: ActivityEvent[]; cursor: string | null }>('/api/events'), api<{ repos: RepoStatus[] }>('/api/repos')]);
      setEvents((old) => preserve ? [...new Map([...feed.events, ...old].map((event) => [event.id, event])).values()].sort((a,b) => b.createdAt.localeCompare(a.createdAt)) : feed.events); if (!preserve) setCursor(feed.cursor); setRepos(list.repos);
    } else { setEvents([]); setRepos([]); setSelected(null); }
  }, []);

  useEffect(() => {
    const isDemo = new URLSearchParams(location.search).get('demo') === '1';
    setDemo(isDemo);
    try { const stored = JSON.parse(localStorage.getItem(isDemo ? 'pulse-demo-read' : 'pulse-read') || '[]'); if (Array.isArray(stored)) setRead(stored.filter((id): id is string => typeof id === 'string')); } catch { /* a corrupt local preference can be ignored */ }
    setInstalled(matchMedia('(display-mode: standalone)').matches);
    if (isDemo) { setStatus({authenticated:true,login:'michal',pushConfigured:true,lastSync:new Date().toISOString()}); setEvents(samples()); setRepos(demoRepos); setReady(true); }
    else load().catch((err) => setError(err.message)).finally(() => setReady(true));
    const handlePrompt = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt); };
    const handleInstalled = () => { setInstalled(true); setInstallPrompt(null); };
    window.addEventListener('beforeinstallprompt', handlePrompt);
    window.addEventListener('appinstalled', handleInstalled);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').then((registration) => registration.pushManager.getSubscription()).then((subscription) => setPushEnabled(!!subscription)).catch(() => {});
    return () => { window.removeEventListener('beforeinstallprompt', handlePrompt); window.removeEventListener('appinstalled', handleInstalled); };
  }, [load]);

  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(demo ? 'pulse-demo-read' : 'pulse-read', JSON.stringify(read.slice(-2000))); } catch { /* local storage is optional */ }
  }, [read, ready, demo]);
  useEffect(() => {
    const eventId = new URLSearchParams(location.search).get('event');
    if (eventId && events.length) { const event = events.find((item) => item.id === eventId); if (event) { setSelected(event); setRead((items) => [...new Set([...items, event.id])]); } }
  }, [events]);
  useEffect(() => {
    if (!status?.authenticated || demo) return;
    const timer = setInterval(() => load(true).catch(() => {}), 60000);
    return () => clearInterval(timer);
  }, [status?.authenticated, demo, load]);
  useEffect(() => {
    if (!selected) return;
    const original = document.body.style.overflow; document.body.style.overflow = 'hidden';
    const previousFocus = document.activeElement as HTMLElement | null;
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
      if (event.key === 'Tab') {
        const items = [...document.querySelectorAll<HTMLElement>('.detail-sheet button:not([disabled]), .detail-sheet a[href]')];
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', close);
    return () => { document.body.style.overflow = original; window.removeEventListener('keydown', close); previousFocus?.focus(); };
  }, [selected]);

  useEffect(() => {
    if (!syncPending || busy || demo) return;
    const timer = setTimeout(() => { void refresh(); }, 5000);
    return () => clearTimeout(timer);
  }, [syncPending, busy, demo]);

  const unread = events.filter((event) => !read.includes(event.id)).length;
  const visible = useMemo(() => events.filter((event) => (filter === 'all' || event.kind === filter) && `${event.repo} ${event.title} ${event.actor} ${event.branch}`.toLowerCase().includes(query.toLowerCase())), [events, filter, query]);
  const activeRepos = repos.filter((repo) => !repo.muted).length;
  const openEvent = (event: ActivityEvent) => { setSelected(event); setRead((items) => [...new Set([...items, event.id])]); };
  async function refresh() {
    setBusy(true); setError('');
    try { if (demo) { setNotice('Demo is up to date.'); } else { const result = await api<{complete:boolean}>('/api/sync', {method:'POST'}); setSyncPending(!result.complete); setNotice(result.complete ? 'Activity refreshed.' : 'Repository sync is still running. Continuing automatically…'); await load(); } } catch (err) { setSyncPending(false); setError((err as Error).message); } finally { setBusy(false); }
  }
  async function loadMore() {
    if (!cursor || demo) return;
    setMoreBusy(true); setError('');
    try { const page = await api<{events:ActivityEvent[];cursor:string|null}>(`/api/events?cursor=${encodeURIComponent(cursor)}`); setEvents((old) => [...new Map([...old, ...page.events].map((event) => [event.id,event])).values()]); setCursor(page.cursor); }
    catch (err) { setError((err as Error).message); } finally { setMoreBusy(false); }
  }
  async function login(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    const submitted = token.trim(); setToken('');
    try { await api('/api/login', {method:'POST',body:JSON.stringify({token:submitted})}); await load(); setNotice('GitHub connected. Your activity is on its way.'); }
    catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function logout() {
    setBusy(true); setError('');
    try {
      if (!demo) {
        if ('serviceWorker' in navigator) { const registration = await navigator.serviceWorker.getRegistration(); const sub = await registration?.pushManager.getSubscription(); if (sub) { await api('/api/push', {method:'DELETE',body:JSON.stringify({endpoint:sub.endpoint})}); await sub.unsubscribe(); } }
        await api('/api/logout', {method:'POST'});
      }
      setPushEnabled(false); setStatus({authenticated:false,pushConfigured:false}); setEvents([]); setRepos([]); setSelected(null); setRead([]); setCursor(null); setSyncPending(false); setDemo(false); history.replaceState(null, '', '/'); setScreen('activity');
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  async function toggleRepo(repo: RepoStatus) {
    setError('');
    try { if (!demo) await api('/api/repos', {method:'POST',body:JSON.stringify({id:repo.id,muted:!repo.muted})}); setRepos((items) => items.map((item) => item.id === repo.id ? {...item,muted:!item.muted} : item)); }
    catch (err) { setError((err as Error).message); }
  }
  async function togglePush() {
    setPushBusy(true); setError(''); setNotice('');
    try {
      if (demo) { setNotice('Notification setup is available when you connect GitHub.'); return; }
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('This browser does not support push notifications. Open Pulse in Chrome on your phone.');
      if (!status?.pushConfigured || !status.publicKey) throw new Error('Push delivery is not configured on this server yet.');
      const registration = await navigator.serviceWorker.ready;
      const current = await registration.pushManager.getSubscription();
      if (current) { await api('/api/push', {method:'DELETE',body:JSON.stringify({endpoint:current.endpoint})}); await current.unsubscribe(); setPushEnabled(false); }
      else {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') throw new Error('Notifications are blocked. Allow notifications for this site in your browser settings, then try again.');
        const subscription = await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapidBytes(status.publicKey)});
        try { await api('/api/push', {method:'POST',body:JSON.stringify({subscription:subscription.toJSON()})}); }
        catch (err) { await subscription.unsubscribe(); throw err; }
        setPushEnabled(true); setNotice('Notifications enabled on this device.');
      }
    } catch (err) { setError((err as Error).message); } finally { setPushBusy(false); }
  }
  async function install() {
    if (installPrompt) { await installPrompt.prompt(); const choice = await installPrompt.userChoice; if (choice.outcome === 'accepted') setInstallPrompt(null); }
    else setNotice('In Chrome, open the ⋮ menu and choose “Add to Home screen” → “Install”.');
  }
  async function testPush() {
    setPushBusy(true); setError('');
    try { await api('/api/push/test', {method:'POST'}); setNotice('Test notification sent.'); } catch (err) { setError((err as Error).message); } finally { setPushBusy(false); }
  }

  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="/" aria-label="Pulse home"><span className="brand-mark"><Activity size={22} strokeWidth={2.5}/></span>pulse<span className="brand-period">.</span></a><div className="topbar-right">{demo && <span className="demo-tag">DEMO</span>}<span className="github-label"><Github size={15}/> GitHub activity</span><button className="avatar" onClick={() => setScreen('settings')} aria-label="Account settings">{status?.login?.slice(0,1).toUpperCase() || <Github size={18}/>}</button></div></header>
    <main>
      {error && <div className="alert error" role="alert"><XCircle size={17}/><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}><X size={16}/></button></div>}
      {notice && <div className="alert" role="status"><Check size={17}/><span>{notice}</span><button aria-label="Dismiss message" onClick={() => setNotice('')}><X size={16}/></button></div>}
      {!ready ? <div className="loading-view"><LoaderCircle className="spin" size={26}/><p>Connecting the dots…</p></div> : !status?.authenticated ? <section className="connect-view"><h1>Connect GitHub<span>.</span></h1><p className="connect-description">Pushes, pull requests and failed checks across your repos.</p><form className="connect-form" onSubmit={login}><label htmlFor="token">Personal access token</label><p>Token needs repo access. Organizations may require SSO approval.</p><input id="token" type="password" value={token} onChange={(event) => setToken(event.target.value)} placeholder="GitHub personal access token" autoComplete="off" required spellCheck={false}/><button className="primary-button" disabled={busy || !token.trim()}>{busy ? <LoaderCircle size={18} className="spin"/> : <Github size={18}/>} {busy ? 'Connecting…' : 'Connect GitHub'}<ArrowUpRight size={18}/></button><div className="security-note"><ShieldCheck size={14}/><span>Token is not stored on this device.</span></div><a className="text-link" href="https://github.com/settings/tokens" target="_blank" rel="noopener noreferrer">Create a GitHub token <ExternalLink size={12}/></a></form></section> : <>
        {screen === 'activity' && <section className="activity-screen"><div className="page-heading"><div><h1>Activity<span>.</span></h1></div><button className="icon-button refresh-button" aria-label="Refresh activity" onClick={refresh} disabled={busy}><RefreshCw size={19} className={busy ? 'spin' : ''}/></button></div><div className="feed-summary"><span><span className="live-dot"/>{activeRepos} repositories followed</span><span>{unread > 0 ? `${unread} unread` : 'All caught up'}</span></div><div className="feed-toolbar"><div className="filters" aria-label="Filter activity">{(['all','push','pr','ci'] as Filter[]).map((item) => <button key={item} className={filter === item ? 'active' : ''} onClick={() => setFilter(item)}>{item === 'all' ? 'All activity' : item === 'push' ? 'Pushes' : item === 'pr' ? 'PRs' : 'CI'}{item === 'ci' && events.some(failure) && <span className="filter-dot"/>}</button>)}</div><button className={`icon-button ${showSearch ? 'active' : ''}`} onClick={() => { setShowSearch(!showSearch); setQuery(''); }} aria-label={showSearch ? 'Close search' : 'Search activity'}>{showSearch ? <X size={18}/> : <Search size={18}/>}</button></div>{showSearch && <div className="search-box"><Search size={16}/><input autoFocus aria-label="Search activity" placeholder="Search repositories, commits, agents…" value={query} onChange={(event) => setQuery(event.target.value)}/></div>}<div className="section-caption"><span>RECENT ACTIVITY</span><button onClick={() => setRead(events.map((event) => event.id))} disabled={!unread}><CheckCheck size={14}/> Mark all read</button></div><div className="event-list">{visible.length ? visible.map((event, index) => <button className={`event-row ${read.includes(event.id) ? 'is-read' : ''}`} key={event.id} onClick={() => openEvent(event)} style={{animationDelay:`${Math.min(index,8)*35}ms`}}><RepoAvatar repo={event.repo} demo={demo} event={event}/><span className="event-content"><span className="event-topline"><span className="repo-name">{event.repo}</span><span className="event-time">{timeAgo(event.createdAt)}{!read.includes(event.id) && <span className="unread-dot"/>}</span></span><span className="event-title">{event.title}</span><span className="event-description">{event.body}</span><span className="event-footer"><span className="actor-avatar">{event.actor.toLowerCase().includes('actions') ? <Github size={10}/> : event.actor.slice(0,1).toUpperCase()}</span><span>{event.actor}</span><span className="meta-divider">/</span><GitBranch size={11}/><span className="branch-name">{event.branch || 'default'}</span></span></span></button>) : <div className="empty-state"><CheckCheck size={30}/><h2>{query ? 'No matching activity' : filter === 'all' ? 'A little quiet, for now' : 'Nothing here yet'}</h2><p>{query ? 'Try another repository, branch, or commit.' : 'New repository activity will appear here. Use refresh to check for updates.'}</p></div>}</div>{cursor && !demo && <button className="load-more secondary-button" onClick={loadMore} disabled={moreBusy}>{moreBusy ? <LoaderCircle size={15} className="spin"/> : null}{moreBusy ? 'Loading…' : 'Load more activity'}</button>}<div className="feed-end"><span className="end-line"/><Activity size={14}/><span className="end-line"/></div><p className="sync-caption">{demo ? 'Preview with fictional activity' : status.lastSync ? `Last synced ${timeAgo(status.lastSync)} ago · Refreshes every minute` : 'Your next update is on its way'}</p></section>}
        {screen === 'repos' && <section><div className="page-heading"><div><h1>Repositories<span>.</span></h1></div><button className="icon-button" onClick={refresh} aria-label="Refresh repositories" disabled={busy}><RefreshCw size={19} className={busy ? 'spin' : ''}/></button></div><p className="page-description">Follow the work that matters. Mute a repository to pause its notifications.</p><div className="section-caption"><span>{repos.length} REPOSITORIES</span><span>{activeRepos} followed</span></div><div className="repo-list">{repos.map((repo) => <div className={`repo-row ${repo.muted ? 'muted' : ''}`} key={repo.id}><RepoAvatar repo={repo.fullName} demo={demo}/><div className="repo-detail"><span className="repo-title">{repo.fullName}{repo.private && <LockKeyhole size={12}/>}</span><span className="repo-mode"><span className={`mode-dot ${repo.mode}`}/>{repo.muted ? 'Muted' : repo.mode === 'live' ? 'Live updates' : repo.mode === 'delayed' ? 'Polling updates' : 'Needs attention'}</span>{repo.reason && <span className="repo-reason">{repo.reason}</span>}</div><button className={`icon-button mute-button ${repo.muted ? '' : 'following'}`} onClick={() => toggleRepo(repo)} aria-label={`${repo.muted ? 'Unmute' : 'Mute'} ${repo.fullName}`} aria-pressed={!repo.muted}>{repo.muted ? <BellOff size={18}/> : <Bell size={18}/>}</button></div>)}</div>{!repos.length && <div className="empty-state"><GitBranch size={30}/><h2>No repositories found</h2><p>Check your token’s repository access, then refresh.</p></div>}<div className="info-note"><ShieldCheck size={17}/><p>Only repositories your GitHub token can access appear here. Notification delivery depends on repository permissions.</p></div></section>}
        {screen === 'settings' && <section className="settings-screen"><div className="page-heading"><div><h1>Settings<span>.</span></h1></div></div><div className="account-panel"><span className="account-avatar">{status.login?.slice(0,1).toUpperCase()}</span><div><h2>{status.login}</h2><p><span className="live-dot"/>GitHub connected{demo ? ' · demo' : ''}</p></div><Github size={24}/></div><div className="section-caption"><span>ON THIS DEVICE</span></div><div className="settings-group"><div className="setting-row"><span className="setting-icon"><Bell size={21}/></span><div><h3>Push notifications</h3><p>{pushEnabled ? 'Updates arrive in the background.' : 'Keep up without opening the app.'}</p></div></div>{!status.pushConfigured && !demo && <p className="configuration-note">Push delivery needs server setup. Your activity feed still works.</p>}<button className={pushEnabled ? 'secondary-button' : 'primary-button'} onClick={togglePush} disabled={pushBusy || (!status.pushConfigured && !demo)}>{pushBusy ? <LoaderCircle className="spin" size={16}/> : pushEnabled ? <BellOff size={16}/> : <Bell size={16}/>} {pushEnabled ? 'Turn off notifications' : 'Enable notifications'}<ChevronRight size={16}/></button>{pushEnabled && <button className="text-link test-button" disabled={pushBusy} onClick={testPush}>Send a test notification <ArrowUpRight size={13}/></button>}</div><div className="settings-group"><div className="setting-row"><span className="setting-icon"><ArrowDownToLine size={21}/></span><div><h3>{installed ? 'Installed on your device' : 'Install app'}</h3><p>{installed ? 'Available from your home screen.' : 'Add Pulse to your home screen.'}</p></div></div><button className="secondary-button" onClick={install} disabled={installed}><ArrowDownToLine size={16}/>{installed ? 'App installed' : 'Install Pulse'}{installed ? <Check size={16}/> : <ChevronRight size={16}/>}</button></div><div className="section-caption"><span>ACCOUNT</span></div><div className="settings-group compact"><div className="setting-row"><span className="setting-icon"><ShieldCheck size={21}/></span><div><h3>Secure session</h3><p>Your GitHub token stays on the server. This device uses a secure session.</p></div></div><button className="logout-button" onClick={logout} disabled={busy}><LogOut size={16}/>Disconnect GitHub<ArrowUpRight size={15}/></button></div><div className="settings-footer"><span className="mini-brand">pulse.</span></div></section>}
      </>}
    </main>
    {ready && status?.authenticated && <nav className="bottom-nav" aria-label="Main navigation"><div>{([{id:'activity',label:'Activity',icon:Activity},{id:'repos',label:'Repositories',icon:GitBranch},{id:'settings',label:'Settings',icon:Settings2}] as const).map(({id,label,icon:Icon}) => <button key={id} className={screen === id ? 'selected' : ''} onClick={() => setScreen(id)} aria-current={screen === id ? 'page' : undefined}><span className="nav-icon"><Icon size={21}/>{id === 'activity' && unread > 0 && <span className="nav-dot"/>}</span><span>{label}</span></button>)}</div></nav>}
    {selected && status?.authenticated && <div className="sheet-backdrop" onClick={() => setSelected(null)}><section className="detail-sheet" role="dialog" aria-modal="true" aria-label="Activity details" onClick={(event) => event.stopPropagation()}><div className="sheet-handle"/><div className="sheet-header"><RepoAvatar repo={selected.repo} demo={demo} event={selected} large/><button className="icon-button" onClick={() => setSelected(null)} aria-label="Close details" autoFocus><X size={20}/></button></div><span className="eyebrow">{selected.repo}</span><h2>{selected.title}</h2><p className="detail-description">{selected.body}</p><div className="detail-meta"><span><Github size={14}/>{selected.actor}</span><span><GitBranch size={14}/>{selected.branch}</span><span>{new Date(selected.createdAt).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'})}</span></div>{selected.commits?.length ? <div className="commit-list"><div className="section-caption"><span>{selected.commits.length} COMMITS</span></div>{selected.commits.map((commit) => <a key={commit.sha} className="commit-row" href={safeLink(commit.url)} target="_blank" rel="noopener noreferrer"><GitCommitHorizontal size={17}/><span>{commit.message}<code>{commit.sha.slice(0,7)}</code></span><ArrowUpRight size={16}/></a>)}</div> : null}<a className="primary-button" href={safeLink(selected.url)} target="_blank" rel="noopener noreferrer"><Github size={18}/>Open in GitHub<ArrowUpRight size={18}/></a></section></div>}
  </div>;
}
