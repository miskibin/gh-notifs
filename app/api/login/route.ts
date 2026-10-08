import { handle,json,sameOrigin,body,allowedLogin,signSession,cookie,HttpError } from '@/lib/auth';
import { github } from '@/lib/github';
export const runtime='nodejs';
export async function POST(request:Request){return handle(async()=>{
 sameOrigin(request);const input=await body<{token?:unknown}>(request);
 if(typeof input.token!=='string'||input.token.length<20||input.token.length>300)throw new HttpError(400,'Enter a GitHub personal access token.');
 let user:{login:string};try{user=await github('/user',{token:input.token.trim()});}catch{throw new HttpError(401,'GitHub could not verify this token.');}
 if(user.login.toLowerCase()!==allowedLogin().toLowerCase())throw new HttpError(403,'This account is not allowed to use this inbox.');
 return json({authenticated:true,login:allowedLogin()},200,{'Set-Cookie':cookie(signSession(allowedLogin()),request)});
});}
