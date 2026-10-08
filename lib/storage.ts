import { get, put, list, del, BlobPreconditionFailedError } from '@vercel/blob';
import { createHash } from 'node:crypto';
export const ROOT = 'gh-notifs/v1/';
export const key = (value:string) => createHash('sha256').update(value).digest('hex');
export function storageConfigured() { return Boolean(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID); }
export async function read<T>(path:string):Promise<{value:T;etag:string}|null> {
  const result = await get(ROOT+path,{access:'private',useCache:false});
  if (!result || result.statusCode!==200) return null;
  return {value:await new Response(result.stream).json() as T,etag:result.blob.etag};
}
export async function write<T>(path:string,value:T,etag?:string) {
  return put(ROOT+path,JSON.stringify(value),{access:'private',addRandomSuffix:false,allowOverwrite:!!etag,...(etag?{ifMatch:etag}:{}),contentType:'application/json',cacheControlMaxAge:60});
}
// A failed create is a duplicate only after confirming a durable existing record.
export async function create<T>(path:string,value:T):Promise<{value:T;created:boolean}> {
  try { await write(path,value);return {value,created:true}; }
  catch(error) {const existing=await read<T>(path);if(existing)return {value:existing.value,created:false};throw error;}
}
export async function update<T>(path:string,fn:(old:T|null)=>T):Promise<T> {
  for(let attempt=0;attempt<5;attempt++) {
    const current=await read<T>(path);const value=fn(current?.value??null);
    try { await write(path,value,current?.etag);return value; }
    catch(error) { if(error instanceof BlobPreconditionFailedError)continue;if(!current && await read(path))continue;throw error; }
  }
  throw new Error('Storage busy; retry this request.');
}
export async function paths(prefix:string,limit=1000,cursor?:string) {
  const result=await list({prefix:ROOT+prefix,limit,cursor});
  return {...result,blobs:result.blobs.map(blob=>({...blob,pathname:blob.pathname.slice(ROOT.length)}))};
}
export async function all<T>(prefix:string,limit=10000):Promise<T[]> {
  const values:T[]=[];let cursor:string|undefined;
  do {const page=await paths(prefix,Math.min(1000,limit-values.length),cursor);for(let i=0;i<page.blobs.length;i+=20){const batch=await Promise.all(page.blobs.slice(i,i+20).map(async blob=>(await read<T>(blob.pathname))?.value));for(const v of batch){if(v!==undefined)values.push(v as T);}}cursor=page.hasMore?page.cursor:undefined;}while(cursor && values.length<limit);
  return values;
}
export async function remove(path:string,etag?:string) {await del(ROOT+path,etag?{ifMatch:etag}:{});}
