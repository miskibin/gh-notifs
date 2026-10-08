import { after } from 'next/server';
import { handle,json,required,HttpError } from '@/lib/auth';
import { verifyWebhook,normalize } from '@/lib/normalize';
import { ingest } from '@/lib/events';
import { create,key } from '@/lib/storage';
import { deliver } from '@/lib/push';
export const runtime='nodejs';export const maxDuration=60;
export async function POST(request:Request){return handle(async()=>{
 const raw=await request.text();if(Buffer.byteLength(raw)>4_000_000)throw new HttpError(413,'Webhook payload is too large.');
 if(!verifyWebhook(raw,request.headers.get('x-hub-signature-256'),required('WEBHOOK_SECRET')))throw new HttpError(401,'Invalid webhook signature.');
 const delivery=request.headers.get('x-github-delivery');if(!delivery||delivery.length>150)throw new HttpError(400,'A GitHub delivery ID is required.');
 const type=request.headers.get('x-github-event')||'';let payload;try{payload=JSON.parse(raw);}catch{throw new HttpError(400,'Invalid webhook JSON.');}
 const event=normalize(type,payload);
 // Persist and repair all durable side effects on retries, even after a partial previous failure.
 const result=event?await ingest(event):null;
 await create(`deliveries/${key(delivery)}.json`,{eventId:event?.id||null,receivedAt:new Date().toISOString()});
 if(event)after(async()=>{await deliver(`outbox/${event.id}.json`).catch(()=>{});});
 return json({ok:true,duplicate:result?!result.created:false});
});}
