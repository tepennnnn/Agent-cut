import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
// Query only child PIDs recorded by this job. No process discovery or termination by name.
export async function workerMemory(pids){
 if(!pids.length)return 0;if(pids.some(n=>!Number.isSafeInteger(n)||n<=0))throw Error('Invalid owned worker PID');
 if(process.platform==='win32')return new Promise((resolve,reject)=>execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',`$items = Get-Process -Id ${pids.join(',')} -ErrorAction SilentlyContinue; ($items | Measure-Object -Property WorkingSet64 -Sum).Sum`],{windowsHide:true,timeout:5000},(e,out)=>e?reject(e):resolve(Number(out.trim())||0)));
 let total=0;for(const pid of pids){const value=await fs.readFile(`/proc/${pid}/status`,'utf8').catch(()=>null);if(value)total+=Number(value.match(/^VmRSS:\s+(\d+)/m)?.[1]||0)*1024;}return total;
}
