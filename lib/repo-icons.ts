import sharp from 'sharp';
import { get, put } from '@vercel/blob';
import { randomUUID } from 'node:crypto';
import { HttpError, required } from './auth';
import { GitHubError } from './github';
import { ROOT, key, read, update } from './storage';
import type { StoredRepo } from './repos';
export const MAX_IMAGE_BYTES=512*1024;
const MAX_TREE_BYTES=2*1024*1024;
const DAY=86400000;
export interface GitTreeEntry {path:string;type:string;sha:string;size?:number;mode?:string;}
interface IconMetadata {pathname?:string;etag?:string;source?:'project'|'owner';expiresAt?:number;leaseUntil?:number;leaseOwner?:string;}
export interface RepoIcon {data:Buffer;etag:string;source:'project'|'owner';}
const flights=new Map<string,Promise<RepoIcon>>();

// Ranking is deterministic and never follows arbitrary URLs from repository contents.
export function selectLogoCandidates(tree:GitTreeEntry[],limit=3):GitTreeEntry[] {
 const candidates=tree.slice(0,10000).flatMap(entry=>{
  const path=entry.path.toLowerCase();const segments=path.split('/');const file=segments.at(-1)||'';
  if(entry.type!=='blob'||entry.mode==='120000'||!Number.isFinite(entry.size)||entry.size!<=0||entry.size!>MAX_IMAGE_BYTES||!/^[a-f0-9]{40,64}$/i.test(entry.sha)||path.length>500)return [];
  if(segments.some(p=>/^(node_modules|vendor|vendors|third_party|third-party|fixtures|__fixtures__|tests?|__tests__|testdata|screenshots?|badges?|coverage|\.git|\.next|dist|build)$/.test(p)))return [];
  if(/(?:screenshot|badge|sample|example|fixture|test)[_.-]/.test(file)||!(/\.(png|svg|webp|jpe?g|gif|avif|ico)$/.test(file)))return [];
  const stem=file.replace(/\.[^.]+$/,'');
  const isLogo=/(^|[-_.])(logo|logomark|brandmark)([-_.]|$)/.test(stem);
  const isIcon=/^(favicon|app[-_]?icon|icon|apple-touch-icon|android-chrome|android-icon)([-_.]?\d.*)?$/.test(stem);
  if(!isLogo&&!isIcon)return [];
  // White-only assets disappear on the application's light canvas.
  if(/(^|[-_.])(white|inverse|inverted|on-dark)([-_.]|$)/.test(stem))return [];
  let score=isLogo?100:65;
  if(segments.length===1)score+=25;
  if(/^(public|static|assets|images|branding)\//.test(path))score+=20;
  if(/^docs?\/(assets|images|img|static)\//.test(path))score+=12;
  if(path==='src-tauri/icons/icon.png')score+=25;
  if(/(^|[-_.])(color|colour)([-_.]|$)/.test(stem))score+=5;
  if(/(^|[-_.])(light|dark)([-_.]|$)/.test(stem))score-=4;
  if(/(^|[-_.])(mono|monochrome|wordmark|horizontal|full)([-_.]|$)/.test(stem))score-=18;
  if(/\.(svg|png)$/.test(file))score+=5;
  if(/\.(ico|gif)$/.test(file))score-=8;
  score-=Math.min(segments.length,10);
  return [{entry,score}];
 });
 return candidates.sort((a,b)=>b.score-a.score||a.entry.path.localeCompare(b.entry.path)).slice(0,Math.min(3,Math.max(0,limit))).map(c=>c.entry);
}
export function ownerAvatarUrl(owner:string):string {
 if(!/^[a-z0-9](?:[a-z0-9-]{0,37}[a-z0-9])?$/i.test(owner))throw new HttpError(400,'Invalid repository owner.');
 return `https://avatars.githubusercontent.com/${encodeURIComponent(owner)}?s=192`;
}
export async function boundedBytes(response:Response,limit:number):Promise<Buffer> {
 const length=Number(response.headers.get('content-length'));if(Number.isFinite(length)&&length>limit){await response.body?.cancel();throw new Error('Provider response is too large');}
 if(!response.body)throw new Error('Provider returned no content');const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)throw new Error('Provider response is too large');chunks.push(value);}}catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
 return Buffer.concat(chunks,size);
}
async function githubJson<T>(path:string,limit:number,deadline=Date.now()+10000):Promise<T> {
 if(deadline<=Date.now())throw new Error('Logo resolution deadline reached');
 const response=await fetch(`https://api.github.com${path}`,{headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${required('GH_TOKEN')}`,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'gh-notifs'},cache:'no-store',redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(10000,deadline-Date.now())))});
 if(!response.ok){await response.body?.cancel();throw new GitHubError(response.status,response.status===429||response.headers.get('x-ratelimit-remaining')==='0');}
 return JSON.parse((await boundedBytes(response,limit)).toString('utf8')) as T;
}
function embeddedPng(input:Buffer):Buffer {
 if(input.length<6||input.readUInt32LE(0)!==0x00010000)return input;
 const count=input.readUInt16LE(4);if(count>32||input.length<6+count*16)throw new Error('Invalid ICO image');
 const images:Array<{data:Buffer;size:number}>=[];
 for(let i=0;i<count;i++){const start=6+i*16;const size=input.readUInt32LE(start+8),offset=input.readUInt32LE(start+12);if(offset<6+count*16||size<8||offset+size>input.length)continue;const data=input.subarray(offset,offset+size);if(data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))images.push({data,size:(input[start]||256)*(input[start+1]||256)});}
 if(!images.length)throw new Error('ICO contains no supported PNG image');return images.sort((a,b)=>b.size-a.size)[0].data;
}
function localReference(value:string) {
 const decoded=value.replace(/&(?:quot|apos|amp|lt|gt|#\d+|#x[0-9a-f]+);/gi,entity=>{
  const named:Record<string,string>={'&quot;':'"','&apos;':"'",'&amp;':'&','&lt;':'<','&gt;':'>'};if(named[entity.toLowerCase()])return named[entity.toLowerCase()];
  const number=entity[2].toLowerCase()==='x'?parseInt(entity.slice(3,-1),16):parseInt(entity.slice(2,-1),10);return number>0&&number<=0x10ffff?String.fromCodePoint(number):'';
 }).trim().replace(/^(["'])(.*)\1$/s,'$2').trim();
 return decoded.startsWith('#');
}
export async function rasterizeIcon(input:Buffer):Promise<Buffer> {
 if(input.length>MAX_IMAGE_BYTES||input.length===0)throw new Error('Invalid image size');
 let bytes=embeddedPng(input);const content=bytes.toString('utf8');
 const raster=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) || (bytes[0]===255&&bytes[1]===216&&bytes[2]===255) || /^GIF8[79]a$/.test(bytes.subarray(0,6).toString('ascii')) || (bytes.subarray(0,4).toString('ascii')==='RIFF'&&bytes.subarray(8,12).toString('ascii')==='WEBP') || (bytes.subarray(4,8).toString('ascii')==='ftyp'&&/^(avif|avis|mif1)$/.test(bytes.subarray(8,12).toString('ascii')));
 if(!raster){
  if(!bytes.equals(Buffer.from(content,'utf8')) || !/<(?:[a-z_][\w.-]*:)?svg[\s>]/i.test(content))throw new Error('Unsupported or non-UTF8 image');
  // Reject resource-loading SVGs before librsvg sees them; clients receive PNG only.
  if(content.includes('\0')||/<!DOCTYPE|<!ENTITY|<(?:[\w.-]+:)?(?:script|foreignObject)\b|@import\b/i.test(content))throw new Error('SVG contains external or active resources');
  for(const match of content.matchAll(/\b(?:xlink:)?href\s*=\s*(["'])(.*?)\1/gis)){if(!localReference(match[2]))throw new Error('SVG contains external resources');}
  for(const match of content.matchAll(/url\s*\(\s*(["']?)(.*?)\1\s*\)/gis)){if(!localReference(match[2]))throw new Error('SVG contains external resources');}
  bytes=Buffer.from(content,'utf8');
 }
 const output=await sharp(bytes,{limitInputPixels:16*1024*1024,failOn:'error',pages:1,density:96}).timeout({seconds:3}).rotate().resize(96,96,{fit:'contain',background:{r:255,g:255,b:255,alpha:0}}).png({compressionLevel:9}).toBuffer();
 if(output.length>MAX_IMAGE_BYTES)throw new Error('Rendered image is too large');return output;
}
export async function hasLogoContrast(png:Buffer):Promise<boolean> {
 const {data}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true});let visible=0,contrasting=0;
 for(let i=0;i<data.length;i+=4){if(data[i+3]<20)continue;visible++;if(Math.min(data[i],data[i+1],data[i+2])<225)contrasting++;}
 return visible>0&&contrasting>=Math.max(12,visible*0.002);
}
async function cached(meta:IconMetadata|null):Promise<RepoIcon|null> {
 if(!meta?.pathname||!meta.etag||!meta.source||!meta.pathname.startsWith('repo-icons/png/'))return null;
 const result=await get(ROOT+meta.pathname,{access:'private',useCache:false});if(!result||result.statusCode!==200)return null;
 const data=await boundedBytes(new Response(result.stream),MAX_IMAGE_BYTES);return {data,etag:meta.etag,source:meta.source};
}
async function projectIcon(repo:StoredRepo,deadline:number):Promise<Buffer|null> {
 const [owner,name]=repo.fullName.split('/');const path=`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
 const result=await githubJson<{tree:GitTreeEntry[]}>(`${path}/git/trees/${encodeURIComponent(repo.defaultBranch)}?recursive=1`,MAX_TREE_BYTES,deadline);
 if(!Array.isArray(result.tree))return null;
 for(const candidate of selectLogoCandidates(result.tree)){
  if(Date.now()>deadline-3000)break;
  try{const blob=await githubJson<{encoding:string;size:number;content:string}>(`${path}/git/blobs/${candidate.sha}`,MAX_IMAGE_BYTES*2,deadline);
   if(blob.encoding!=='base64'||blob.size>MAX_IMAGE_BYTES||typeof blob.content!=='string'||blob.content.length>MAX_IMAGE_BYTES*1.5)continue;
   const data=Buffer.from(blob.content.replace(/\s/g,''),'base64');if(data.length!==blob.size)continue;const rendered=await rasterizeIcon(data);if(await hasLogoContrast(rendered))return rendered;
  }catch{ /* Try at most three ranked assets before owner fallback. */ }
 }
 return null;
}
async function fallbackIcon(repo:StoredRepo):Promise<Buffer> {
 try{const response=await fetch(ownerAvatarUrl(repo.fullName.split('/')[0]),{redirect:'error',cache:'no-store',signal:AbortSignal.timeout(6000)});if(response.ok)return await rasterizeIcon(await boundedBytes(response,MAX_IMAGE_BYTES));await response.body?.cancel();}catch{ /* A deterministic raster placeholder also survives provider outages. */ }
 const initial=repo.fullName.split('/')[1].charAt(0).toUpperCase().replace(/[^A-Z0-9]/g,'');
 return rasterizeIcon(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="18" fill="#ebe7df"/><text x="48" y="62" text-anchor="middle" font-family="sans-serif" font-size="44" fill="#746a5b">${initial}</text></svg>`));
}
async function resolve(repo:StoredRepo):Promise<RepoIcon> {
 const metadataPath=`repo-icons/meta/${key(repo.fullName)}.json`;const old=(await read<IconMetadata>(metadataPath))?.value||null;
 const existing=await cached(old);
 if(existing&&(old?.expiresAt||0)>Date.now())return existing;
 const leaseOwner=randomUUID();
 try {await update<IconMetadata>(metadataPath,current=>{if((current?.leaseUntil||0)>Date.now())throw new Error('Icon resolution is already running');return {...current,leaseOwner,leaseUntil:Date.now()+60000};});}
 catch{if(existing)return existing;throw new HttpError(503,'Repository icon is being resolved. Retry shortly.');}
 let data:Buffer|null=null;let source:'project'|'owner'='project';
 try{data=await projectIcon(repo,Date.now()+35000);}catch{ /* Bounded/truncated trees and unavailable repositories use owner avatars. */ }
 if(!data){source='owner';data=await fallbackIcon(repo);}
 const etag=key(data.toString('base64'));const pathname=`repo-icons/png/${key(repo.fullName)}/${etag}.png`;
 try{await put(ROOT+pathname,data,{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'image/png',cacheControlMaxAge:86400});}
 catch(error){const existingBinary=await get(ROOT+pathname,{access:'private',useCache:false});if(!existingBinary)throw error;await existingBinary.stream?.cancel();}
 await update<IconMetadata>(metadataPath,current=>{if(current?.leaseOwner!==leaseOwner)throw new Error('Icon resolution lease changed');return {pathname,etag,source,expiresAt:Date.now()+(source==='project'?7*DAY:DAY),leaseUntil:0};});
 return {data,etag,source};
}
export async function resolveRepoIcon(repo:StoredRepo):Promise<RepoIcon> {
 const active=flights.get(repo.fullName);if(active)return active;
 const pending=resolve(repo);flights.set(repo.fullName,pending);try{return await pending;}finally{if(flights.get(repo.fullName)===pending)flights.delete(repo.fullName);}
}
