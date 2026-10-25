export function reviewProjectChange({plan,title,actionLabel,el,onConfirm}){
 return new Promise(resolve=>{
   const dialog=el('dialog','recovery-review'),heading=el('h2','',title),message=el('p','',plan.proposedProject?'This creates sequence tracks and saves a recovery backup first. Track editing supports direct gestures, linked selections, titles and caption styles. Review the conversion before activating.':'Restore the selected project snapshot. Your current project is backed up first, and this change can be undone.');
   dialog.append(heading,message);if(plan.title)dialog.append(el('p','',`Project: ${plan.title} · format ${plan.targetVersion}`));
   if(plan.proposedProject)dialog.append(el('p','',`${plan.proposedProject.sequences.length} sequence(s) · ${plan.proposedProject.sequences.reduce((n,s)=>n+s.tracks.length,0)} tracks · Original source files stay unchanged.`));
   const details=el('details'),summary=el('summary','','Review changes'),pre=el('pre');const json=JSON.stringify(plan,null,2);pre.textContent=json.slice(0,100000)+(json.length>100000?'\n… Download the full plan to review the remaining details.':'');details.append(summary,pre);dialog.append(details);
   const url=URL.createObjectURL(new Blob([json],{type:'application/json'})),download=el('a','','Download full review plan');download.href=url;download.download='agent-cut-review-'+plan.planId+'.json';dialog.append(download);
   const error=el('p','error'),actions=el('div','dialog-actions'),cancel=el('button','','Cancel'),confirm=el('button','primary',actionLabel);error.setAttribute('role','alert');cancel.type=confirm.type='button';actions.append(cancel,confirm);dialog.append(error,actions);document.body.append(dialog);
   const finish=value=>{URL.revokeObjectURL(url);dialog.close();dialog.remove();resolve(value);};cancel.onclick=()=>finish(false);dialog.oncancel=e=>{e.preventDefault();finish(false);};
   confirm.onclick=async()=>{confirm.disabled=true;cancel.disabled=true;try{await onConfirm();finish(true);}catch(e){error.textContent=e.message;confirm.disabled=false;cancel.disabled=false;}};
   dialog.showModal();
 });
}
export function chooseRecoveryBackup({backups,el}){
 return new Promise(resolve=>{
   const dialog=el('dialog','recovery-review'),heading=el('h2','','Recovery backups'),label=el('label','','Choose project snapshot'),select=el('select');select.setAttribute('aria-label','Recovery backup');
   for(const b of backups){const option=el('option','',b.status==='valid'?`${b.title} · format ${b.schemaVersion} · revision ${b.revision} · ${new Date(b.createdAt).toLocaleString()}`:`Invalid backup ${b.backupId}`);option.value=b.backupId;option.disabled=b.status!=='valid';select.append(option);}label.append(select);dialog.append(heading,label);
   const actions=el('div','dialog-actions'),cancel=el('button','','Cancel'),review=el('button','primary','Review restore');cancel.type=review.type='button';review.disabled=!backups.some(b=>b.status==='valid');actions.append(cancel,review);dialog.append(actions);document.body.append(dialog);
   const finish=value=>{dialog.close();dialog.remove();resolve(value);};cancel.onclick=()=>finish(null);dialog.oncancel=e=>{e.preventDefault();finish(null);};review.onclick=()=>finish(select.value);dialog.showModal();
 });
}
