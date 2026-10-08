import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {normalize,verifyWebhook,eventPath} from '../lib/normalize';
import {signSession,verifySession,sameOrigin,HttpError} from '../lib/auth';
import {validateSubscription} from '../lib/push';
import {ingest,type EventPersistence} from '../lib/events';
import type {ActivityEvent} from '../lib/types';
const repository={full_name:'octo/private'};const at='2026-10-08T10:00:00.000Z';
const push={repository,ref:'refs/heads/main',after:'a'.repeat(40),before:'b'.repeat(40),head_commit:{timestamp:at},commits:[{id:'a'.repeat(40),message:'Fix build\nDetails',url:'https://github.com/octo/private/commit/a'}],sender:{login:'octo'}};
test('raw webhook signature rejects modified payloads and missing signature',()=>{
 const raw=JSON.stringify(push),secret='test-secret';const signature='sha256='+createHmac('sha256',secret).update(raw).digest('hex');
 assert.equal(verifyWebhook(raw,signature,secret),true);assert.equal(verifyWebhook(raw+' ',signature,secret),false);assert.equal(verifyWebhook(raw,null,secret),false);
});
test('signed session expires, cannot be modified, and only authorizes allowed account',()=>{
 process.env.SESSION_SECRET='unit-test-session-secret';process.env.ALLOWED_GITHUB_LOGIN='miskibin';
 const now=Date.now(),signed=signSession('miskibin',now);assert.equal(verifySession(signed,now+30*86400000),'miskibin');assert.equal(verifySession(signed,now+91*86400000),null);assert.equal(verifySession(signed+'x',now),null);assert.equal(verifySession(signSession('someone-else',now),now),null);
});
test('cookie mutations reject cross-origin or missing-origin requests',()=>{
 process.env.APP_URL='https://inbox.example';assert.doesNotThrow(()=>sameOrigin(new Request('https://inbox.example/api/sync',{headers:{origin:'https://inbox.example'}})));
 assert.throws(()=>sameOrigin(new Request('https://inbox.example/api/sync',{headers:{origin:'https://evil.example'}})),HttpError);assert.throws(()=>sameOrigin(new Request('https://inbox.example/api/sync')),HttpError);
});
test('pushes group commits and webhook/fallback identities agree',()=>{
 const webhook=normalize('push',push)!;const polled=normalize('push',{...push,head_commit:undefined,created_at:at,commits:undefined})!;
 assert.equal(webhook.id,polled.id);assert.equal(webhook.commits?.length,1);assert.match(webhook.title,/1 commit/);assert.equal(polled.title,'Push to main');
 assert.notEqual(webhook.id,normalize('push',{...push,after:'c'.repeat(40)})!.id);
});
test('PR merge and update versions deduplicate across sources; CI only reports failures',()=>{
 const pr={number:2,title:'Ship it',state:'closed',merged:true,updated_at:at,head:{sha:'a',ref:'feature'},html_url:'https://github.com/octo/private/pull/2'};
 assert.equal(normalize('pull_request',{repository,action:'closed',pull_request:pr})!.action,'merged');assert.equal(normalize('pull_request',{repository,action:'merged',pull_request:pr})!.id,normalize('pull_request',{repository,action:'closed',pull_request:pr})!.id);
 assert.equal(normalize('pull_request',{repository,action:'edited',pull_request:pr})!.id,normalize('pull_request',{repository,action:'synchronize',pull_request:pr})!.id);
 assert.equal(normalize('workflow_run',{repository,action:'completed',workflow_run:{id:3,conclusion:'success'}}),null);
 const run={id:3,run_attempt:1,conclusion:'failure',updated_at:at,name:'Android build'};
 assert.equal(normalize('workflow_run',{repository,action:'completed',workflow_run:run})!.kind,'ci');assert.notEqual(normalize('workflow_run',{repository,action:'completed',workflow_run:run})!.id,normalize('workflow_run',{repository,action:'completed',workflow_run:{...run,run_attempt:2}})!.id);
});
test('notification endpoints cannot request internal or attacker-controlled hosts',()=>{
 const keys={p256dh:Buffer.alloc(65).toString('base64url'),auth:Buffer.alloc(16).toString('base64url')};assert.doesNotThrow(()=>validateSubscription({endpoint:'https://fcm.googleapis.com/fcm/send/test',keys}));
 for(const endpoint of ['http://fcm.googleapis.com/fcm/send/test','https://127.0.0.1/admin','https://fcm.googleapis.com.evil.example/test','https://fcm.googleapis.com:8443/test'])assert.throws(()=>validateSubscription({endpoint,keys}),HttpError);
});
test('durable ingestion repairs partial writes and never creates duplicate inbox records',async()=>{
 const docs=new Map<string,unknown>();let enqueued=0;let failIndex=true;
 const store:EventPersistence={
  read:async <T>(path:string)=>docs.has(path)?{value:docs.get(path) as T,etag:'test'}:null,
  create:async <T>(path:string,value:T)=>{if(path.startsWith('events/')&&failIndex){failIndex=false;throw new Error('Simulated storage failure');}const created=!docs.has(path);if(created)docs.set(path,value);return {created,value:docs.get(path) as T};},
  enqueue:async (event:ActivityEvent)=>{if(!docs.has('outbox/'+event.id)){docs.set('outbox/'+event.id,event);enqueued++;}}
 };
 const event=normalize('push',push)!;await assert.rejects(ingest(event,true,store));assert.equal(docs.has('records/'+event.id+'.json'),true);assert.equal(docs.has(eventPath(event)),false);
 await ingest(event,true,store);await ingest({...event,createdAt:'2026-10-08T10:01:00.000Z'},true,store);assert.equal([...docs.keys()].filter(k=>k.startsWith('events/')).length,1);assert.equal(enqueued,1);
});
test('historical backfill remains silent when an overlapping webhook is retried',async()=>{
 const docs=new Map<string,unknown>();let enqueued=0;const store:EventPersistence={read:async <T>(path:string)=>docs.has(path)?{value:docs.get(path) as T,etag:'test'}:null,create:async <T>(path:string,value:T)=>{const created=!docs.has(path);if(created)docs.set(path,value);return {created,value:docs.get(path) as T};},enqueue:async()=>{enqueued++;}};
 const event=normalize('push',push)!;await ingest(event,false,store);await ingest(event,true,store);assert.equal(enqueued,0);
});
