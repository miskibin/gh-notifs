import { handle,json,sameOrigin,cookie } from '@/lib/auth';
export async function POST(request:Request){return handle(async()=>{sameOrigin(request);return json({ok:true},200,{'Set-Cookie':cookie('',request)});});}
