import { authenticated,handle,HttpError } from '@/lib/auth';
import { read } from '@/lib/storage';
import { repoPath,type StoredRepo } from '@/lib/repos';
import { resolveRepoIcon } from '@/lib/repo-icons';
export const runtime='nodejs';export const maxDuration=60;export const dynamic='force-dynamic';
export async function GET(request:Request){return handle(async()=>{
 authenticated(request);
 const name=new URL(request.url).searchParams.get('repo');
 if(!name||name.length>200||!/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9_.-]+$/.test(name))throw new HttpError(400,'A valid owner/repository name is required.');
 if(['.','..'].includes(name.split('/')[1]))throw new HttpError(400,'A valid owner/repository name is required.');
 const repo=(await read<StoredRepo>(repoPath(name)))?.value;if(!repo||repo.fullName!==name)throw new HttpError(404,'Repository was not found.');
 const icon=await resolveRepoIcon(repo);const etag=`"${icon.etag}"`;
 const headers={'Content-Type':'image/png','Cache-Control':'private, max-age=86400','Vary':'Cookie','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'",'ETag':etag};
 if(request.headers.get('if-none-match')===etag)return new Response(null,{status:304,headers});
 return new Response(new Uint8Array(icon.data),{headers});
});}
