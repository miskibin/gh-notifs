import webpush, { type PushSubscription } from 'web-push';
import { required, HttpError } from './auth';
import { all, create, read, update, remove, paths, key } from './storage';
import type { ActivityEvent } from './types';
export interface SubscriptionRecord { subscription:PushSubscription; generic:boolean; updatedAt:string; }
interface Pending {event:ActivityEvent;attempts:number;nextAttempt:number;leaseUntil?:number;}
export function pushConfigured() {return Boolean(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT);}
export function validateSubscription(input:unknown):PushSubscription {
 const s=input as PushSubscription;if(!s||typeof s.endpoint!=='string'||s.endpoint.length>4096)throw new HttpError(400,'Invalid push subscription.');
 let u:URL;try{u=new URL(s.endpoint);}catch{throw new HttpError(400,'Invalid push endpoint.');}
 const host=u.hostname;const allowed=host==='fcm.googleapis.com'||host==='updates.push.services.mozilla.com'||/^[a-z0-9-]+\.push\.services\.mozilla\.com$/.test(host)||host==='web.push.apple.com'||host==='wns.windows.com'||/^[a-z0-9-]+\.notify\.windows\.com$/.test(host);
 if(u.protocol!=='https:'||u.port||u.username||u.password||!allowed)throw new HttpError(400,'Push provider is not supported.');
 if(!s.keys || !/^[A-Za-z0-9_-]{80,100}$/.test(s.keys.p256dh)||!/^[A-Za-z0-9_-]{20,30}$/.test(s.keys.auth)||Buffer.from(s.keys.p256dh,'base64url').length!==65||Buffer.from(s.keys.auth,'base64url').length!==16)throw new HttpError(400,'Invalid push encryption keys.');
 return {endpoint:s.endpoint,keys:{p256dh:s.keys.p256dh,auth:s.keys.auth}};
}
async function send(record:SubscriptionRecord,event?:ActivityEvent) {
 const subscription=validateSubscription(record.subscription);
 const payload=event?(record.generic?{title:'GitHub activity',body:'New repository activity. Open GitHub Inbox to view.',url:'/',tag:event.id}:{title:`${event.repo} · ${event.title}`,body:event.body.slice(0,250),url:`/?event=${event.id}`,eventId:event.id,tag:event.id}):{title:'GitHub Inbox is connected',body:'Push notifications are working on this device.',url:'/',tag:'test'};
 const subject=required('VAPID_SUBJECT');if(!/^(mailto:|https:\/\/)/.test(subject))throw new HttpError(503,'VAPID_SUBJECT must be a contact email or HTTPS URL.');
 await webpush.sendNotification(subscription,JSON.stringify(payload),{vapidDetails:{subject,publicKey:required('VAPID_PUBLIC_KEY'),privateKey:required('VAPID_PRIVATE_KEY')},TTL:86400,timeout:8000,urgency:event?.kind==='ci'?'high':'normal'});
}
export async function enqueue(event:ActivityEvent) {await create(`outbox/${event.id}.json`,{event,attempts:0,nextAttempt:0} satisfies Pending);}
export async function deliver(path:string):Promise<boolean> {
 if(await read(`completed/${path.split('/').pop()}`)){await remove(path);return true;}
 if(!pushConfigured())return false;
 const current=await read<Pending>(path);if(!current||current.value.nextAttempt>Date.now()||(current.value.leaseUntil||0)>Date.now())return false;
 try{await update<Pending>(path,old=>{if(!old||old.nextAttempt>Date.now()||(old.leaseUntil||0)>Date.now())throw new Error('Outbox leased');return {...old,leaseUntil:Date.now()+300000};});}catch{return false;}
 const pending=current.value;let failed=false;
 const repo=await read<{muted:boolean}>(`repos/${key(pending.event.repo)}.json`);if(repo?.value.muted){await create(`completed/${pending.event.id}.json`,{mutedAt:new Date().toISOString()});await remove(path);return true;}
 const subscriptions=await all<SubscriptionRecord>('subscriptions/',1000);
 for(let i=0;i<subscriptions.length;i+=8)await Promise.all(subscriptions.slice(i,i+8).map(async record=>{
  const endpointKey=key(record.subscription.endpoint);const receipt=`push-receipts/${pending.event.id}/${endpointKey}.json`;
  if(await read(receipt))return;
  try {await send(record,pending.event);await create(receipt,{sentAt:new Date().toISOString()});}
  catch(error) {const status=(error as {statusCode?:number}).statusCode;if(status===404||status===410)await remove(`subscriptions/${endpointKey}.json`);else failed=true;}
 }));
 if(failed){await update<Pending>(path,old=>({...old!,attempts:(old?.attempts||0)+1,nextAttempt:Date.now()+Math.min(6*3600000,30000*2**Math.min(old?.attempts||0,10)),leaseUntil:0}));return false;}
 await create(`completed/${pending.event.id}.json`,{sentAt:new Date().toISOString()});
 await remove(path);return true;
}
export async function drain(limit=30,deadline=Date.now()+60000) {
 let sent=0,examined=0,eligible=0;let cursor:string|undefined;
 do {const page=await paths('outbox/',100,cursor);
  for(const blob of page.blobs){if(Date.now()>deadline||eligible>=limit)return {sent,examined};examined++;
   const pending=await read<Pending>(blob.pathname);if(!pending||pending.value.nextAttempt>Date.now()||(pending.value.leaseUntil||0)>Date.now())continue;
   eligible++;if(await deliver(blob.pathname))sent++;
  }
  cursor=page.hasMore?page.cursor:undefined;
 }while(cursor&&Date.now()<deadline&&examined<1000);
 return {sent,examined};
}
export async function testPush() {
 if(!pushConfigured())throw new HttpError(503,'Push is not configured on the server.');
 const subscriptions=await all<SubscriptionRecord>('subscriptions/',1000);if(!subscriptions.length)throw new HttpError(400,'Enable notifications on a device first.');let sent=0;
 for(const record of subscriptions){try{await send(record);sent++;}catch(error){const status=(error as {statusCode?:number}).statusCode;if(status===404||status===410)await remove(`subscriptions/${key(record.subscription.endpoint)}.json`);}}
 if(!sent)throw new HttpError(502,'No device accepted the test notification. Re-enable notifications.');return {sent};
}
