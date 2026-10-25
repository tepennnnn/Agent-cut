// Only the authenticated runtime in this data folder may be reused.
export function acceptsLocalOrigin(host,origin,port){const expected=`127.0.0.1:${port}`;return host===expected&&(!origin||origin===`http://${expected}`);}
export function matchesRuntime(info,configuredPort){
 return info&&Number.isInteger(info.port)&&info.port>0&&info.port<=65535&&(info.configuredPort??info.port)===configuredPort&&typeof info.token==='string'&&/^[a-f0-9]{64}$/.test(info.token);
}
function listen(server,port){return new Promise((resolve,reject)=>{
 const cleanup=()=>{server.removeListener('error',failed);server.removeListener('listening',ready);},failed=e=>{cleanup();reject(e);},ready=()=>{cleanup();resolve(server.address().port);};
 server.once('error',failed);server.once('listening',ready);server.listen(port,'127.0.0.1');
});}
export async function bindEditor(server,{port,existing,strict=false}){
 try{return {port:await listen(server,port),reused:false};}
 catch(e){if(e.code!=='EADDRINUSE')throw e;
   const runtime=await existing();if(runtime)return {runtime,reused:true};
   if(strict)throw Error(`Agent Cut port ${port} is occupied by a different server. Close that server or change config.local.json port.`);
   return {port:await listen(server,0),reused:false,fallback:true};
 }
}
