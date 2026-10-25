export function applyLibraryOperation(q,op,{allocateId,label}){
 if(op.type==='bin_add'){q.bins??=[];q.bins.push({id:allocateId(),name:label(op.name)});return true;}
 if(op.type==='bin_update'||op.type==='bin_delete'){const bin=q.bins?.find(b=>b.id===op.binId);if(!bin)throw Error('Unknown bin.');if(op.type==='bin_update')bin.name=label(op.name);else{q.bins=q.bins.filter(b=>b!==bin);for(const a of q.assets)if(a.binId===bin.id)delete a.binId;if(!q.bins.length)delete q.bins;}return true;}
 if(op.type==='asset_update'){const a=q.assets.find(a=>a.id===op.assetId);if(!a)throw Error('Unknown asset.');if(op.name!==undefined)a.name=op.name;if(op.notes!==undefined)a.notes=op.notes;if(op.tags!==undefined)a.tags=[...new Set(op.tags)];if(op.label!==undefined){if(op.label==='none')delete a.label;else a.label=op.label;}if(op.binId!==undefined){if(op.binId)a.binId=op.binId;else delete a.binId;}return true;}return false;
}
export function validateLibrary(project){
 const bins=project.bins??[];if(!Array.isArray(bins)||bins.length>100)throw Error('At most 100 bins are supported.');const ids=new Set();for(const b of bins){if(typeof b.id!=='string'||!b.id||ids.has(b.id)||typeof b.name!=='string'||!b.name.trim()||b.name.length>80)throw Error('Invalid bin.');ids.add(b.id);}
 for(const a of project.assets){if(a.binId!==undefined&&!ids.has(a.binId))throw Error('Unknown asset bin.');if(a.name!==undefined&&(typeof a.name!=='string'||!a.name.trim()||a.name.length>255))throw Error('Invalid asset name.');if(a.label!==undefined&&!['red','orange','yellow','green','blue','purple'].includes(a.label))throw Error('Invalid asset label.');if(a.notes!==undefined&&(typeof a.notes!=='string'||a.notes.length>2000))throw Error('Asset notes exceed 2000 characters.');if(a.tags!==undefined&&(!Array.isArray(a.tags)||a.tags.length>20||a.tags.some(t=>typeof t!=='string'||!t.trim()||t.length>40)))throw Error('Invalid asset tags.');}
}
export function findMedia(project,query=''){
 if(typeof query!=='string'||query.length>200)throw Error('Search query exceeds 200 characters.');const terms=query.toLowerCase().trim().split(/\s+/).filter(Boolean);
 return project.assets.filter(a=>{const haystack=[a.name,a.notes,a.label,...a.tags||[],project.bins?.find(b=>b.id===a.binId)?.name].filter(Boolean).join(' ').toLowerCase();return terms.every(term=>haystack.includes(term));});
}
