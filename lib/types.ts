export type EventKind = 'push' | 'pr' | 'ci';
export interface ActivityEvent { id:string; kind:EventKind; repo:string; title:string; body:string; actor:string; branch:string; url:string; createdAt:string; action:string; commits?:{sha:string;message:string;url:string}[]; }
export interface RepoStatus { id:number; fullName:string; private:boolean; muted:boolean; mode:'live'|'delayed'|'error'; reason?:string; url:string; }
export interface AppStatus { authenticated:boolean; login?:string; pushConfigured:boolean; publicKey?:string; lastSync?:string; error?:string; }
