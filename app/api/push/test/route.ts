import { handle,json,authenticated,sameOrigin } from '@/lib/auth';
import { testPush } from '@/lib/push';
export const runtime='nodejs';export const maxDuration=60;
export async function POST(request:Request){return handle(async()=>{sameOrigin(request);authenticated(request);return json(await testPush());});}
