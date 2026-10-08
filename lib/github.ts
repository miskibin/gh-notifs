import { HttpError, required, allowedLogin } from './auth';
export class GitHubError extends HttpError {constructor(status:number,public rateLimited=false){super(status===401?503:502,rateLimited?'GitHub API rate limit reached; synchronization will resume later.':status===403?'GitHub denied access. Check token permissions and organization SSO authorization.':status===404?'GitHub resource is unavailable to this token.':`GitHub API request failed (${status}).`);}}
export async function github<T>(path:string,options:{method?:string;body?:unknown;token?:string}={}):Promise<T> {
 if(!path.startsWith('/')||path.startsWith('//'))throw new Error('Invalid GitHub API path');
 const response=await fetch('https://api.github.com'+path,{method:options.method||'GET',headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${options.token||required('GH_TOKEN')}`,'X-GitHub-Api-Version':'2022-11-28','User-Agent':'gh-notifs',...(options.body?{'Content-Type':'application/json'}:{})},...(options.body?{body:JSON.stringify(options.body)}:{}),cache:'no-store',signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new GitHubError(response.status,response.status===429 || response.headers.get('x-ratelimit-remaining')==='0' || response.headers.has('retry-after'));
 return (response.status===204?null:await response.json()) as T;
}
export async function verifyServerIdentity() {const user=await github<{login:string}>('/user');if(user.login.toLowerCase()!==allowedLogin().toLowerCase())throw new HttpError(503,'Server GitHub token belongs to a different account.');return user;}
