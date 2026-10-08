import { handle,json,secureEqual,HttpError } from '@/lib/auth';
import { discover,reconcile,syncState,type SyncState } from '@/lib/repos';
import { update } from '@/lib/storage';
import { drain } from '@/lib/push';
export const runtime='nodejs';export const maxDuration=300;
export async function GET(request:Request){return handle(async()=>{
 const secret=process.env.CRON_SECRET;if(!secret||!secureEqual(request.headers.get('authorization')||'',`Bearer ${secret}`))throw new HttpError(401,'Unauthorized.');
 const start=Date.now();const state=await syncState();let discovery;
 try {
  const firstPush=await drain(30,start+40000);
  if(state.discoveryStarted || !state.lastSync || Date.parse(state.lastSync)<start-3600000)discovery=await discover(start+130000);
  const polling=await reconcile(start+245000);const push=await drain(30,start+280000);
  await update<SyncState>('config/sync.json',old=>({...old,lastCron:new Date().toISOString(),error:undefined}));return json({ok:true,discovery,polling,push,firstPush});
 }catch(error){await update<SyncState>('config/sync.json',old=>({...old,lastCron:new Date().toISOString(),error:error instanceof HttpError?error.message:'Scheduled synchronization failed; it will retry.'}));throw error;}
});}
