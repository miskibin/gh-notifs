import { create, read, paths, key } from './storage';
import { enqueue } from './push';
import { eventPath } from './normalize';
import type { ActivityEvent,RepoStatus } from './types';
interface EventRecord {event:ActivityEvent;notify:boolean;}
export interface EventPersistence {read:typeof read;create:typeof create;enqueue:typeof enqueue;}
export async function ingest(event:ActivityEvent,notify=true,store:EventPersistence={read,create,enqueue}) {
 const repo=await store.read<RepoStatus>(`repos/${key(event.repo)}.json`);
 const record=await store.create<EventRecord>(`records/${event.id}.json`,{event,notify:notify&&!repo?.value.muted});
 await store.create(eventPath(record.value.event),record.value.event);
 if(record.value.notify && !await store.read(`completed/${event.id}.json`))await store.enqueue(record.value.event);
 return {created:record.created,event:record.value.event};
}
export async function recentEvents(limit=100,cursor?:string) {
 const page=await paths('events/',limit,cursor);
 const events=(await Promise.all(page.blobs.map(async blob=>(await read<ActivityEvent>(blob.pathname))?.value))).filter((v):v is ActivityEvent=>!!v);
 return {events,cursor:page.hasMore?page.cursor:null};
}
