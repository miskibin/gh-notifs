import { handle,json,authenticated,sameOrigin,body,HttpError } from '@/lib/auth';
import { listRepos,repoPath,type StoredRepo } from '@/lib/repos';
import { update } from '@/lib/storage';
export const runtime='nodejs';export const dynamic='force-dynamic';
export async function GET(request:Request){return handle(async()=>{authenticated(request);return json({repos:(await listRepos()).sort((a,b)=>a.fullName.localeCompare(b.fullName)).map(({id,fullName,private:privateRepo,muted,mode,reason,url})=>({id,fullName,private:privateRepo,muted,mode,reason,url}))});});}
export async function POST(request:Request){return handle(async()=>{sameOrigin(request);authenticated(request);const input=await body<{id?:unknown;muted?:unknown}>(request);if(typeof input.id!=='number'||typeof input.muted!=='boolean')throw new HttpError(400,'A repository ID and mute setting are required.');const repo=(await listRepos()).find(repo=>repo.id===input.id);if(!repo)throw new HttpError(404,'Repository was not found.');const muted=input.muted;await update<StoredRepo>(repoPath(repo.fullName),old=>({...old!,muted}));return json({ok:true});});}
