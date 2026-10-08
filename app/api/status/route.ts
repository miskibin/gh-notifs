import { handle,json,session,allowedLogin } from '@/lib/auth';
import { pushConfigured } from '@/lib/push';
import { storageConfigured } from '@/lib/storage';
import { syncState } from '@/lib/repos';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){return handle(async()=>{
 const login=session(request);let state:Awaited<ReturnType<typeof syncState>>={};if(login&&storageConfigured())state=await syncState();
 const missing=['GH_TOKEN','SESSION_SECRET','WEBHOOK_SECRET','APP_URL'].filter(name=>!process.env[name]);if(!storageConfigured())missing.push('private Blob store');
 return json({authenticated:!!login,...(login?{login,lastSync:state.lastSync,lastCron:state.lastCron}:{}),pushConfigured:pushConfigured(),...(login&&pushConfigured()?{publicKey:process.env.VAPID_PUBLIC_KEY}:{}),...(login&&(missing.length||state.error)?{error:missing.length?`Missing server configuration: ${missing.join(', ')}.`:state.error}:{}),allowedLogin:allowedLogin()});
});}
