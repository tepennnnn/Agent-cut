import fs from 'node:fs/promises';
import path from 'node:path';
import {EditError} from './engine.mjs';
import {fileDigest,readLocalJson,ownedDirectory} from './speech-setup.mjs';
import {transcriptDigest} from './transcript-model.mjs';
// Optional binding: legacy/manual plans keep their existing behavior.
async function loadBinding(store,plan){
 let binding;try{await fs.lstat(path.join(store.root,'recipe-plans'));const dir=await ownedDirectory(store.root,'recipe-plans');binding=await readLocalJson(path.join(dir,plan.planId+'.json'),262144);}catch(e){if(e.code==='ENOENT')return;throw e;}
 if(binding.version!==1||binding.projectId!==store.projectId||binding.planId!==plan.planId||!Array.isArray(binding.sources)||binding.sources.length>30)throw new EditError('INVALID_PLAN','Invalid recipe source binding.');
 return binding;
}
export async function readRecipeReview(store,plan){return (await loadBinding(store,plan))?.review;}
export async function validateRecipeBinding(store,plan,digest){
 const binding=await loadBinding(store,plan);
 if(!binding||transcriptDigest({projectId:binding.projectId,sources:binding.sources,review:binding.review})!==digest)throw new EditError('INVALID_PLAN','Recipe evidence is missing or corrupt. Create a new reviewed plan.');
}
export async function validateRecipeSources(store,plan){
 const binding=await loadBinding(store,plan);if(!binding)return;
 for(const source of binding.sources){const asset=store.db.project.assets.find(a=>a.id===source.assetId);if(!asset||asset.file!==source.file||await fileDigest(store.assetPath(asset))!==source.sha256)throw new EditError('SOURCE_CHANGED','Recipe source bytes changed. Read the source/evidence and create a new plan.');}
}
