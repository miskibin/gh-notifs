import { github, verifyServerIdentity, GitHubError } from './github';
import { HttpError, required } from './auth';
import { all, read, update, key } from './storage';
import { normalize, type Payload } from './normalize';
import { ingest } from './events';
import type { RepoStatus } from './types';
export interface StoredRepo extends RepoStatus {defaultBranch:string;admin:boolean;discoveredAt:string;lastPolled?:string;trackingSince?:string;hookId?:number;hookFingerprint?:string;}
export interface SyncState {lastSync?:string;lastCron?:string;discoveryPage?:number;discoveryOffset?:number;discoveryStarted?:string;pollCursor?:number;error?:string;}
const webhookEvents=['push','pull_request','pull_request_review','pull_request_review_comment','issue_comment','workflow_run','check_run','status'];
export const repoPath=(name:string)=>`repos/${key(name)}.json`;
export const listRepos=()=>all<StoredRepo>('repos/');
export const syncState=async()=>(await read<SyncState>('config/sync.json'))?.value||{};
async function configureHook(repo:Payload,old?:StoredRepo):Promise<Pick<StoredRepo,'mode'|'reason'|'hookId'|'hookFingerprint'>> {
 if(!repo.permissions?.admin)return {mode:'delayed',reason:'No repository admin permission. Changes are checked by scheduled polling; pushes may arrive late and can be missed beyond GitHub history limits.'};
 if(!process.env.APP_URL||!process.env.WEBHOOK_SECRET)return {mode:'delayed',reason:'Webhook URL or secret is missing on the server.'};
 const address=new URL('/api/webhook',required('APP_URL')).href;if(!address.startsWith('https://'))throw new HttpError(503,'APP_URL must use HTTPS.');
 try {
  const hooks:Payload[]=[];for(let page=1;page<=5;page++){const batch=await github<Payload[]>(`/repos/${repo.full_name}/hooks?per_page=100&page=${page}`);hooks.push(...batch);if(batch.length<100)break;}
  const existing=hooks.find(h=>h.config?.url===address);
  const fingerprint=key(address+required('WEBHOOK_SECRET')+webhookEvents.join(','));
  if(existing&&old?.hookFingerprint===fingerprint&&existing.active&&webhookEvents.every(name=>existing.events?.includes(name)))return {mode:'live',hookId:existing.id,hookFingerprint:fingerprint};
  const payload={name:'web',active:true,events:webhookEvents,config:{url:address,content_type:'json',insecure_ssl:'0',secret:required('WEBHOOK_SECRET')}};
  // Refresh the secret even for existing hooks, so credential rotation is recoverable.
  const hook=await github<Payload>(`/repos/${repo.full_name}/hooks${existing?`/${existing.id}`:''}`,{method:existing?'PATCH':'POST',body:payload});
  return {mode:'live',hookId:hook.id,hookFingerprint:fingerprint};
 }catch(error){return {mode:'delayed',reason:error instanceof GitHubError?`${error.message} Webhooks unavailable; scheduled polling is delayed.`:'Webhook setup did not finish. Scheduled polling is delayed.'};}
}
export async function discover(deadline=Date.now()+210000) {
 await verifyServerIdentity();let state=await syncState();let page=state.discoveryPage||1;const started=state.discoveryStarted||new Date().toISOString();let discovered=0;
 while(Date.now()<deadline){
  const batch=await github<Payload[]>(`/user/repos?affiliation=owner,collaborator,organization_member&visibility=all&sort=full_name&per_page=100&page=${page}`);
  for(let i=state.discoveryOffset||0;i<batch.length;i+=5){if(Date.now()>deadline){await update<SyncState>('config/sync.json',old=>({...old,discoveryPage:page,discoveryOffset:i,discoveryStarted:started}));return {discovered,complete:false};}
   await Promise.all(batch.slice(i,i+5).map(async repo=>{
    const old=(await read<StoredRepo>(repoPath(repo.full_name)))?.value;
    const hook=await configureHook(repo,old);
    await update<StoredRepo>(repoPath(repo.full_name),current=>({id:repo.id,fullName:repo.full_name,private:!!repo.private,muted:current?.muted||false,url:repo.html_url,defaultBranch:repo.default_branch||'main',admin:!!repo.permissions?.admin,discoveredAt:started,trackingSince:current?.trackingSince||started,...hook,...(current?.lastPolled?{lastPolled:current.lastPolled}:{})}));
    discovered++;
    if(!old && Date.now()<deadline-15000)await pollRepo((await read<StoredRepo>(repoPath(repo.full_name)))!.value,false).catch(()=>{});
   }));
  }
  if(batch.length<100){const lastSync=new Date().toISOString();await update<SyncState>('config/sync.json',old=>({...old,lastSync,discoveryPage:1,discoveryOffset:0,discoveryStarted:undefined,error:undefined}));return {discovered,complete:true,lastSync};}
  page++;state={...state,discoveryOffset:0};await update<SyncState>('config/sync.json',old=>({...old,discoveryPage:page,discoveryOffset:0,discoveryStarted:started}));
 }
 return {discovered,complete:false};
}
async function pollRepo(repo:StoredRepo,notify=true) {
 const pollStarted=new Date().toISOString();const since=new Date(Math.min(Date.parse(repo.lastPolled||pollStarted),Date.now())-24*3600000).toISOString();let count=0;let successfulReads=0;const issues:string[]=[];
 const process=async(type:string,p:Payload)=>{const event=normalize(type,{...p,repository:{full_name:repo.fullName}});if(event && (!notify || event.createdAt>=(repo.trackingSince||repo.discoveredAt)) && (event.createdAt>=since || !notify)){if((await ingest(event,notify && event.createdAt>=(repo.trackingSince||repo.discoveredAt))).created)count++;}};
 // Events are a fallback only. GitHub explicitly delays and bounds this feed.
 try {const events=await github<Payload[]>(`/repos/${repo.fullName}/events?per_page=100`);successfulReads++;for(const event of (notify?events:events.slice(0,3)).reverse()){
  const payload={...event.payload,sender:event.actor,created_at:event.created_at};
  if(event.type==='PushEvent'){
   const candidate={...payload,ref:payload.ref,after:payload.head||payload.after};const preliminary=normalize('push',{...candidate,repository:{full_name:repo.fullName}});
   if(preliminary && preliminary.createdAt>=since && (!notify || preliminary.createdAt>=(repo.trackingSince||repo.discoveredAt))){
    const saved=await read<{event:import('./types').ActivityEvent;notify:boolean}>(`records/${preliminary.id}.json`);
    if(saved){await ingest(saved.value.event,saved.value.notify);continue;}
    let commits=payload.commits?.map((c:Payload)=>({...c,id:c.sha,url:`https://github.com/${repo.fullName}/commit/${c.sha}`}));let size=payload.size;
    const before=String(payload.before||''),head=String(candidate.after||'');
    if(!commits && /^[a-f0-9]{40,64}$/i.test(head)){
     try {if(/^[a-f0-9]{40,64}$/i.test(before)&&!/^0+$/.test(before)) {const comparison=await github<Payload>(`/repos/${repo.fullName}/compare/${before}...${head}?per_page=20`);commits=comparison.commits?.slice(0,20).map((c:Payload)=>({id:c.sha,message:c.commit?.message,url:c.html_url}));size=comparison.total_commits;}
     else {const commit=await github<Payload>(`/repos/${repo.fullName}/commits/${head}`);commits=[{id:commit.sha,message:commit.commit?.message,url:commit.html_url}];}}
     catch { /* A push is still visible if commit metadata is no longer accessible. */ }
    }
    await process('push',{...candidate,commits,size});
   }
  }
  if(event.type==='PullRequestEvent')await process('pull_request',payload);
 }}catch(error){issues.push(error instanceof GitHubError?error.message:'Repository event history unavailable.');}
 try {const prs=await github<Payload[]>(`/repos/${repo.fullName}/pulls?state=all&sort=updated&direction=desc&per_page=30`);successfulReads++;for(const pr of (notify?prs:prs.slice(0,3))){if(pr.updated_at>=since||!notify)await process('pull_request',{action:pr.state==='closed'?'closed':pr.created_at===pr.updated_at?'opened':'edited',pull_request:pr,sender:pr.user});}}catch{issues.push('Pull request history unavailable to the server token.');}
 try {const runs=await github<{workflow_runs:Payload[]}>(`/repos/${repo.fullName}/actions/runs?status=completed&per_page=30`);successfulReads++;for(const run of (notify?runs.workflow_runs:runs.workflow_runs.slice(0,3)))await process('workflow_run',{action:'completed',workflow_run:run,sender:run.actor});}catch{issues.push('Actions history unavailable to the server token.');}
 try {const ref=encodeURIComponent(repo.defaultBranch);const checks=await github<{check_runs:Payload[]}>(`/repos/${repo.fullName}/commits/${ref}/check-runs?per_page=30`);successfulReads++;for(const check of (notify?checks.check_runs:checks.check_runs.slice(0,3)))await process('check_run',{action:'completed',check_run:check});const statuses=await github<Payload[]>(`/repos/${repo.fullName}/commits/${ref}/statuses?per_page=30`);for(const status of (notify?statuses:statuses.slice(0,3)))await process('status',status);}catch{issues.push('Latest default-branch check/status history unavailable.');}
 await update<StoredRepo>(repoPath(repo.fullName),old=>({...old!,...(successfulReads?{lastPolled:pollStarted}:{}),...(!successfulReads?{mode:'error' as const,reason:'No repository activity API could be read. Check token permissions and organization SSO authorization.'}:{}),...(successfulReads&&issues.length && old?.mode!=='live'?{reason:[old?.reason,...issues].filter(Boolean).join(' ').slice(0,1200)}:{})}));return count;
}
export async function reconcile(deadline=Date.now()+160000) {
 const repos=(await listRepos()).sort((a,b)=>a.id-b.id);const state=await syncState();let cursor=state.pollCursor||0;let checked=0,events=0;
 // Rotate across repositories to preserve bounded function/API usage for large accounts.
 while(checked<Math.min(repos.length,25) && Date.now()<deadline){const repo=repos[cursor%repos.length];try{events+=await pollRepo(repo,!!repo.lastPolled);}catch(error){if(error instanceof GitHubError&&error.rateLimited)break;}
  cursor=(cursor+1)%repos.length;checked++;
 }
 await update<SyncState>('config/sync.json',old=>({...old,pollCursor:cursor}));return {checked,events};
}
