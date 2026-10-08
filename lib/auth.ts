import { createHmac, timingSafeEqual } from 'node:crypto';
export const COOKIE='gh_notifs_session';
export class HttpError extends Error {constructor(public status:number,message:string){super(message);}}
export function required(name:string):string {const value=process.env[name];if(!value)throw new HttpError(503,`Missing server configuration: ${name}.`);return value;}
export function allowedLogin() {return process.env.ALLOWED_GITHUB_LOGIN || 'miskibin';}
export function secureEqual(a:string,b:string) {const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length && timingSafeEqual(x,y);}
export function signSession(login:string,now=Date.now()) {
 const payload=Buffer.from(JSON.stringify({login,exp:now+90*24*3600*1000})).toString('base64url');
 return `${payload}.${createHmac('sha256',required('SESSION_SECRET')).update(payload).digest('base64url')}`;
}
export function verifySession(value:string|undefined,now=Date.now()):string|null {
 if(!value||!process.env.SESSION_SECRET)return null;
 const [payload,signature,...extra]=value.split('.');if(!payload||!signature||extra.length)return null;
 const expected=createHmac('sha256',process.env.SESSION_SECRET).update(payload).digest('base64url');if(!secureEqual(signature,expected))return null;
 try {const data=JSON.parse(Buffer.from(payload,'base64url').toString());return data.login===allowedLogin() && Number.isFinite(data.exp) && data.exp>now?data.login:null;}catch{return null;}
}
export function session(request:Request) {const raw=request.headers.get('cookie')?.split(';').map(s=>s.trim()).find(s=>s.startsWith(COOKIE+'='))?.slice(COOKIE.length+1);return verifySession(raw);}
export function authenticated(request:Request) {const login=session(request);if(!login)throw new HttpError(401,'Sign in to continue.');return login;}
export function sameOrigin(request:Request) {
 const origin=request.headers.get('origin');const expected=new URL(process.env.APP_URL||request.url).origin;
 if(!origin || origin!==expected || request.headers.get('sec-fetch-site')==='cross-site')throw new HttpError(403,'Cross-origin request rejected.');
}
export function cookie(value:string,request:Request) {return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${value?7776000:0}${new URL(request.url).protocol==='https:'?'; Secure':''}`;}
export function json(data:unknown,status=200,headers:HeadersInit={}) {return Response.json(data,{status,headers:{'Cache-Control':'private, no-store',...headers}});}
export async function handle(fn:()=>Promise<Response>) {try{return await fn();}catch(error){return json({error:error instanceof HttpError?error.message:'The server could not complete this request. Please retry.'},error instanceof HttpError?error.status:503);}}
export async function body<T>(request:Request,max=16384):Promise<T> {
 const text=await request.text();if(Buffer.byteLength(text)>max)throw new HttpError(413,'Request is too large.');try{return JSON.parse(text) as T;}catch{throw new HttpError(400,'Invalid JSON.');}
}
