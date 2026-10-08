import { handle,json,authenticated } from '@/lib/auth';
import { recentEvents } from '@/lib/events';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){return handle(async()=>{authenticated(request);const query=new URL(request.url).searchParams;const limit=Math.min(100,Math.max(1,Number(query.get('limit'))||100));return json(await recentEvents(limit,query.get('cursor')||undefined));});}
