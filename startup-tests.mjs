import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import readline from 'node:readline';
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {bindEditor,matchesRuntime,acceptsLocalOrigin} from './startup.mjs';
import {UI_ASSETS} from './ui-assets.mjs';
import {forwardRuntimeCall} from './runtime-forward.mjs';

test('attached bridge refreshes authenticated same-profile credentials once after a pre-execution 401',async()=>{
 const old={port:43127,token:'old'},fresh={port:43128,token:'fresh'},sent=[];let refreshes=0;
 const result=await forwardRuntimeCall(old,{send:async runtime=>{sent.push(runtime);return new Response('{}',{status:sent.length===1?401:200});},refresh:async()=>{refreshes++;return fresh;}});
 assert.equal(result.runtime,fresh);assert.equal(result.response.status,200);assert.deepEqual(sent,[old,fresh]);assert.equal(refreshes,1);
 for(const replacement of [null,old]){let count=0;const rejected=await forwardRuntimeCall(old,{send:async()=>{count++;return new Response('{}',{status:401});},refresh:async()=>replacement});assert.equal(count,1);assert.equal(rejected.response.status,401);assert.equal(rejected.runtime,old);}
 let calls=0;const rejected=await forwardRuntimeCall(old,{send:async()=>{calls++;return new Response('{}',{status:401});},refresh:async()=>fresh});assert.equal(calls,2);assert.equal(rejected.response.status,401);
});

test('attached bridge never retries ambiguous mutation failures or changes credentials on successful calls',async()=>{
 const runtime={port:43127,token:'same'};
 for(const status of [200,400,403,500]){let calls=0;const result=await forwardRuntimeCall(runtime,{send:async()=>{calls++;return new Response('{}',{status});},refresh:async()=>assert.fail('Unexpected credential refresh')});assert.equal(calls,1);assert.equal(result.runtime,runtime);assert.equal(result.response.status,status);}
 let calls=0;await assert.rejects(forwardRuntimeCall(runtime,{send:async()=>{calls++;throw Error('Connection interrupted after request');},refresh:async()=>assert.fail('Ambiguous request retried')}),/Connection interrupted/);assert.equal(calls,1);
});

test('public asset allowlist covers the complete browser module graph',async()=>{
 const root=path.dirname(fileURLToPath(import.meta.url));
 const files=(await fs.readdir(path.join(root,'ui'))).filter(name=>name.endsWith('.js'));
 for(const name of files){
   assert.ok(UI_ASSETS.includes('/'+name),'Missing public module: '+name);
   const source=await fs.readFile(path.join(root,'ui',name),'utf8');
   for(const match of source.matchAll(/(?:from\s*|import\s*)['"](\/[^'"]+)['"]/g)){
     assert.ok(UI_ASSETS.includes(match[1]),`${name} imports unavailable ${match[1]}`);
   }
 }
 assert.equal(new Set(UI_ASSETS).size,UI_ASSETS.length);
 for(const route of UI_ASSETS){
   assert.match(route,/^\/[a-z0-9-]+\.(?:js|mjs|css)$/);
   if(route!=='/session.js')await fs.access(route==='/keyframes.mjs'?path.join(root,'keyframes.mjs'):path.join(root,'ui',route.slice(1)));
 }
 assert.ok(!UI_ASSETS.includes('/config.local.json'));
 assert.ok(!UI_ASSETS.includes('/data/project.json'));
});
class Server extends EventEmitter{
 constructor(errors=[]){super();this.errors=errors;this.ports=[];}
 listen(port,host){assert.equal(host,'127.0.0.1');this.ports.push(port);queueMicrotask(()=>{const code=this.errors.shift();if(code)this.emit('error',Object.assign(Error(code),{code}));else this.emit('listening');});}
 address(){return {port:this.ports.at(-1)||51234};}
}
test('startup uses the requested port and only falls back after an unrelated port collision',async()=>{
 const direct=new Server();assert.deepEqual(await bindEditor(direct,{port:43127,existing:async()=>null}),{port:43127,reused:false});
 const collision=new Server(['EADDRINUSE']);assert.deepEqual(await bindEditor(collision,{port:43127,existing:async()=>null}),{port:51234,reused:false,fallback:true});assert.deepEqual(collision.ports,[43127,0]);assert.equal(collision.listenerCount('error'),0);assert.equal(collision.listenerCount('listening'),0);
 const denied=new Server(['EACCES']);await assert.rejects(bindEditor(denied,{port:43127,existing:async()=>null}),e=>e.code==='EACCES');assert.deepEqual(denied.ports,[43127]);
});
test('startup reuses the authenticated same-folder runtime, supports strict ports and validates fallback metadata',async()=>{
 const runtime={port:51234,configuredPort:43127,token:'a'.repeat(64)},server=new Server(['EADDRINUSE']);assert.deepEqual(await bindEditor(server,{port:43127,existing:async()=>runtime}),{runtime,reused:true});assert.deepEqual(server.ports,[43127]);
 await assert.rejects(bindEditor(new Server(['EADDRINUSE']),{port:43127,existing:async()=>null,strict:true}),/occupied by a different server/);
 assert.equal(matchesRuntime(runtime,43127),true);assert.equal(matchesRuntime({...runtime,configuredPort:43128},43127),false);assert.equal(matchesRuntime({port:43127,token:'a'.repeat(64)},43127),true);assert.equal(matchesRuntime({...runtime,port:70000},43127),false);assert.equal(matchesRuntime({...runtime,token:'bad'},43127),false);
});


test('real startup survives an occupied loopback port and reports the isolated project URL through MCP',{timeout:20000},async()=>{
 const root=path.dirname(fileURLToPath(import.meta.url)),work=path.resolve(root,'../../work/startup-tests');await fs.mkdir(work,{recursive:true});const data=await fs.mkdtemp(path.join(work,'run-'));
 const occupant=spawn(process.execPath,['--input-type=module','-e',"import http from 'node:http';const server=http.createServer();server.listen(0,'127.0.0.1',()=>console.log(server.address().port));"],{stdio:['pipe','pipe','pipe'],windowsHide:true});let editor;
 try{
   const port=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Fixture listener timed out')),5000);occupant.stdout.once('data',b=>{clearTimeout(timer);resolve(Number(String(b).trim()));});occupant.once('error',reject);});assert.ok(port>0);
   editor=spawn(process.execPath,[path.join(root,'server.mjs'),'--stdio'],{env:{...process.env,AGENT_CUT_DATA:data,AGENT_CUT_PORT:String(port)},stdio:['pipe','pipe','pipe'],windowsHide:true});let stderr='';editor.stderr.on('data',b=>stderr+=b);const lines=readline.createInterface({input:editor.stdout}),pending=new Map();let id=0;
   lines.on('line',line=>{const result=JSON.parse(line),entry=pending.get(result.id);if(entry){clearTimeout(entry.timer);pending.delete(result.id);entry.resolve(result);}});
   const rpc=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,timer:setTimeout(()=>reject(Error('RPC timed out: '+stderr)),10000)});editor.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\n');});
   await rpc('initialize',{protocolVersion:'2025-06-18'});const result=await rpc('tools/call',{name:'editor_info',arguments:{}});assert.equal(result.result.isError,undefined);const info=result.result.structuredContent,runtime=JSON.parse(await fs.readFile(path.join(data,'runtime.json'),'utf8'));assert.notEqual(runtime.port,port);assert.equal(runtime.configuredPort,port);assert.equal(info.url,'http://127.0.0.1:'+runtime.port);assert.equal(info.dataRoot,await fs.realpath(data));assert.match(stderr,/busy; using local port/);
 }finally{for(const child of [editor,occupant])if(child){child.stdin?.end();child.kill();}}
});

test('browser origin checks use the actual bound port after fallback',()=>{assert.equal(acceptsLocalOrigin('127.0.0.1:49327','http://127.0.0.1:49327',49327),true);assert.equal(acceptsLocalOrigin('127.0.0.1:43127',undefined,49327),false);assert.equal(acceptsLocalOrigin('127.0.0.1:49327','https://evil.invalid',49327),false);});

test('real attached stdio survives an editor restart and executes a rejected mutation exactly once',{timeout:30000},async t=>{
 const {default:http}=await import('node:http'),root=path.dirname(fileURLToPath(import.meta.url)),scratch=path.resolve(root,'../../work/startup-tests');await fs.mkdir(scratch,{recursive:true});const data=await fs.mkdtemp(path.join(scratch,'reconnect-'));
 const probe=http.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const children=[];
 function client(){
  const child=spawn(process.execPath,[path.join(root,'server.mjs'),'--stdio'],{env:{...process.env,AGENT_CUT_DATA:data,AGENT_CUT_PORT:String(port),AGENT_CUT_COMPACT_MCP:'1'},windowsHide:true,stdio:['pipe','pipe','pipe']});children.push(child);let id=0,errors='';const pending=new Map(),lines=readline.createInterface({input:child.stdout});child.stderr.on('data',b=>errors+=b);lines.on('line',line=>{const r=JSON.parse(line),p=pending.get(r.id);if(p){clearTimeout(p.timer);pending.delete(r.id);p.resolve(r);}});
  const rpc=(method,params={})=>new Promise((resolve,reject)=>{const key=++id;pending.set(key,{resolve,timer:setTimeout(()=>reject(Error('RPC timeout '+errors)),8000)});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:key,method,params})+'\n');});return {child,rpc};
 }
 const call=async(c,name,args={})=>{const r=(await c.rpc('tools/call',{name,arguments:args})).result;assert.equal(r.isError,undefined,JSON.stringify(r));return r.structuredContent;};
 try{
  const owner=client();await owner.rpc('initialize');const summary=await call(owner,'project_read',{view:'summary'}),old=JSON.parse(await fs.readFile(path.join(data,'runtime.json'),'utf8')),original=JSON.parse(await fs.readFile(path.join(data,'project.json'),'utf8')).project;
  // Establish whether loopback is permitted before starting the attached client.
  try{const health=await fetch('http://127.0.0.1:'+port+'/api/health',{headers:{'x-agent-cut-token':old.token}});assert.equal(health.status,200);}catch(e){if(e.cause?.code==='EACCES'){t.skip('Sandbox denies loopback; real reconnect remains unverified.');return;}throw e;}
  const attached=client();await attached.rpc('initialize');assert.equal((await call(attached,'editor_info')).projectId,summary.projectId);
  const exited=new Promise(r=>owner.child.once('exit',r));owner.child.stdin.end();await exited;
  const replacement=client();await replacement.rpc('initialize');await call(replacement,'editor_info');const fresh=JSON.parse(await fs.readFile(path.join(data,'runtime.json'),'utf8'));assert.notEqual(fresh.token,old.token);assert.equal(fresh.port,old.port);
  const edited=await call(attached,'timeline_edit',{expectedProjectId:summary.projectId,expectedRevision:summary.revision,summary:'Single restart edit',operations:[{type:'rename',title:'After editor restart'}]});assert.equal(edited.revision,summary.revision+1);assert.equal(edited.title,'After editor restart');
  const undone=await call(attached,'timeline_undo',{expectedProjectId:summary.projectId,expectedRevision:edited.revision});assert.equal(undone.revision,summary.revision+2);assert.deepEqual(JSON.parse(await fs.readFile(path.join(data,'project.json'),'utf8')).project,original);
 }finally{for(const child of children){child.stdin.end();child.kill();}}
});
