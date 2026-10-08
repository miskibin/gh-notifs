import { after } from 'next/server';
import { handle,json,authenticated,sameOrigin } from '@/lib/auth';
import { discover,reconcile,type SyncState } from '@/lib/repos';
import { update } from '@/lib/storage';
export const runtime='nodejs';export const maxDuration=300;
export async function POST(request:Request){return handle(async()=>{sameOrigin(request);authenticated(request);const deadline=Date.now()+230000;try{const result=await discover(deadline);after(async()=>{await reconcile(Date.now()+45000).catch(()=>{});});return json(result);}catch(error){await update<SyncState>('config/sync.json',old=>({...old,error:error instanceof Error&&error.name==='GitHubError'?error.message:'Repository synchronization did not finish. Retry to continue.'}));throw error;}});}
