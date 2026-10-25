import {AsyncLocalStorage} from 'node:async_hooks';
export const jobContext=new AsyncLocalStorage();
export function checkJob(){const job=jobContext.getStore();if(job?.signal.aborted)throw Error('JOB_CANCELED');return job;}
