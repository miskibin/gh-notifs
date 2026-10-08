import { createHmac } from 'node:crypto';
import { secureEqual } from './auth';
import { key } from './storage';
import type { ActivityEvent } from './types';
// GitHub webhook schemas differ by event; only selected fields leave this module.
export type Payload = Record<string, any>;
const text=(v:unknown,max=500)=>typeof v==='string'?v.slice(0,max):'';
const url=(v:unknown,fallback:string)=>{try{const u=new URL(String(v));return u.protocol==='https:'&&u.hostname==='github.com'?u.href:fallback;}catch{return fallback;}};
const date=(v:unknown,fallback:string)=>{const n=typeof v==='number'?v*1000:Date.parse(String(v));return Number.isFinite(n)?new Date(n).toISOString():fallback;};
const failures=new Set(['failure','timed_out','action_required','startup_failure']);
export function verifyWebhook(raw:string,signature:string|null,secret:string):boolean {
 return !!signature && /^sha256=[a-f0-9]{64}$/i.test(signature) && secureEqual(signature,`sha256=${createHmac('sha256',secret).update(raw).digest('hex')}`);
}
export function normalize(type:string,p:Payload,receivedAt=new Date().toISOString()):ActivityEvent|null {
 const repo=text(p.repository?.full_name,200);if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo))return null;
 const home=`https://github.com/${repo}`;
 const base={repo,actor:text(p.sender?.login||p.actor?.login||p.pusher?.name||'GitHub',100),branch:'',url:home,createdAt:receivedAt};
 let event:Omit<ActivityEvent,'id'>;let identity:string;
 if(type==='push') {
  const branch=text(p.ref,250).replace(/^refs\/(heads|tags)\//,'');const commits=(Array.isArray(p.commits)?p.commits:[]).slice(0,100).map((c:Payload)=>({sha:text(c.id||c.sha,64),message:text(c.message,800),url:url(c.url,home)}));
  const hasCount=Number.isFinite(p.size??p.distinct_size)||commits.length>0;const count=Number(p.size??p.distinct_size??commits.length)||0;
  const action=p.deleted?'deleted':p.created?'created':'pushed';
  event={...base,kind:'push',branch,action,title:p.deleted?`Deleted ${branch}`:p.created&&!count?`Created ${branch}`:!hasCount?`Push to ${branch}`:`${count} commit${count===1?'':'s'} pushed to ${branch}`,body:commits.slice(0,3).map((c:{message:string})=>c.message.split('\n')[0]).join('\n')||`Branch ${action}`,url:url(p.compare,home),createdAt:date(p.created_at,receivedAt),commits};
  identity=`push:${repo}:${p.ref}:${p.after}:${p.deleted?`deleted:${p.before}`:''}`;
 } else if(type==='pull_request' || type==='pull_request_review' || type==='pull_request_review_comment' || type==='issue_comment') {
  const pr=p.pull_request || p.issue;if(!pr || (type==='issue_comment'&&!pr.pull_request))return null;
  const action=type==='pull_request'?((p.action==='closed'&&pr.merged)||p.action==='merged'?'merged':text(p.action,80)):type==='pull_request_review'?'reviewed':'commented';
  if(type==='pull_request' && !['opened','reopened','closed','merged','synchronize','edited','ready_for_review','converted_to_draft','review_requested','review_request_removed','assigned','unassigned','labeled','unlabeled'].includes(p.action))return null;
  const extra=p.review||p.comment;
  event={...base,kind:'pr',action,branch:text(pr.head?.ref,250),title:`PR #${pr.number} ${action}: ${text(pr.title,240)}`,body:extra?text(extra.body,1000):`${base.actor} ${action} this pull request`,url:url(pr.html_url,home),createdAt:date(extra?.updated_at||pr.updated_at,receivedAt)};
  identity=`pr:${repo}:${pr.number}:${['edited','synchronize'].includes(action)?'updated':action}:${extra?.id||''}:${extra?.updated_at||pr.updated_at}:${pr.head?.sha||''}`;
 } else if(type==='workflow_run') {
  const run=p.workflow_run;if(!run || p.action!=='completed'||!failures.has(run.conclusion))return null;
  event={...base,kind:'ci',action:'failed',branch:text(run.head_branch,250),title:`${text(run.name,240)||'Workflow'} failed`,body:`${text(run.conclusion,80)} · ${text(run.head_sha,7)}`,url:url(run.html_url,home),createdAt:date(run.updated_at,receivedAt)};
  identity=`workflow:${repo}:${run.id}:${run.run_attempt||1}:${run.conclusion}`;
 } else if(type==='check_run') {
  const run=p.check_run;if(!run || p.action!=='completed'||!failures.has(run.conclusion))return null;
  event={...base,kind:'ci',action:'failed',branch:text(run.check_suite?.head_branch,250),title:`${text(run.name,240)||'Check'} failed`,body:text(run.output?.summary,1000)||text(run.conclusion,80),url:url(run.html_url||run.details_url,home),createdAt:date(run.completed_at,receivedAt)};
  identity=`check:${repo}:${run.id}:${run.completed_at}:${run.conclusion}`;
 } else if(type==='status') {
  if(!['failure','error'].includes(p.state))return null;
  event={...base,kind:'ci',action:'failed',title:`${text(p.context,240)||'CI status'} failed`,body:text(p.description,1000),url:url(p.target_url,`${home}/commit/${text(p.sha,64)}`),createdAt:date(p.updated_at||p.created_at,receivedAt)};
  identity=`status:${repo}:${p.id||`${p.sha}:${p.context}:${p.updated_at}`}:${p.state}`;
 } else return null;
 return {...event,id:key(identity)};
}
export function eventPath(event:ActivityEvent) {const inverse=String(9999999999999-Date.parse(event.createdAt)).padStart(13,'0');return `events/${inverse}-${event.id}.json`;}
