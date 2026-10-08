import { github } from './github';
import { read, update } from './storage';
interface SchedulerState { schedulerCheckedAt?:string; }
export async function maintainScheduler() {
 const repository=process.env.SCHEDULER_REPOSITORY;
 // No repository is assumed. Only the explicitly configured workflow may be changed.
 if(!repository)return {checked:false};
 if(!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))return {checked:false,error:'Scheduler repository configuration is invalid.'};
 const path='config/scheduler.json';const now=Date.now();const current=await read<SchedulerState>(path);
 if(current?.value.schedulerCheckedAt && Date.parse(current.value.schedulerCheckedAt)>now-24*3600000)return {checked:false};
 // Claim the daily check with a conditional write, including concurrent cron invocations.
 try {await update<SchedulerState>(path,old=>{if(old?.schedulerCheckedAt && Date.parse(old.schedulerCheckedAt)>now-24*3600000)throw new Error('Scheduler already checked');return {schedulerCheckedAt:new Date(now).toISOString()};});}catch{return {checked:false};}
 const [owner,name]=repository.split('/');const workflow=`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/actions/workflows/reconcile.yml`;
 try {
  const status=await github<{state:string}>(workflow);
  if(status.state!=='disabled_inactivity')return {checked:true,enabled:false};
  await github(workflow+'/enable',{method:'PUT'});
  return {checked:true,enabled:true};
 }catch{return {checked:true,error:'Scheduler maintenance failed; the daily backup will retry.'};}
}
