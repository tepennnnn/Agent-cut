import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {apply,Store,canonical} from './engine.mjs';
import {convertV1,timeSeconds} from './sequences.mjs';
import {findMedia} from './library-operations.mjs';
const fixture=()=>convertV1({title:'Library test',canvas:{width:320,height:180,fps:30},assets:[{id:'a',name:'Source A',file:'a.mp4',duration:20,width:320,height:180,hasAudio:true}],clips:[{id:'first',assetId:'a',sourceIn:0,sourceOut:3,speed:1,volume:1},{id:'second',assetId:'a',sourceIn:3,sourceOut:6,speed:1,volume:1}],captions:[]});
const execute=(p,ops)=>{let n=0;return apply(p,ops,{allocateId:()=>`allocated-${++n}`});};
test('bins and searchable metadata preserve media identity and support atomic undo/replay',async()=>{
 const p=fixture(),q=execute(p,[{type:'bin_add',name:'Interviews'},{type:'asset_update',assetId:'a',binId:'allocated-1',name:'Opening interview',label:'blue',notes:'Best opening take',tags:['speaker','wide','speaker']}]);
 assert.equal(q.assets[0].file,'a.mp4');assert.deepEqual(q.assets[0].tags,['speaker','wide']);assert.equal(findMedia(q,'interviews BLUE opening speaker').length,1);assert.equal(findMedia(q,'absent').length,0);
 assert.throws(()=>execute(p,[{type:'asset_update',assetId:'a',binId:'missing'}]));assert.throws(()=>execute(p,[{type:'asset_update',assetId:'a',tags:['']}])) ;assert.throws(()=>findMedia(p,'x'.repeat(201)));
 const deleted=execute(q,[{type:'bin_delete',binId:'allocated-1'}]);assert.equal(deleted.bins,undefined);assert.equal(deleted.assets[0].binId,undefined);assert.equal(deleted.assets[0].file,'a.mp4');assert.equal(p.assets[0].name,'Source A');
 const dir=await fs.mkdtemp(path.resolve('work-library-')),store=new Store(dir,'unused');await store.init();await store.commit(p,'Fixture');const args={expectedRevision:store.read().revision,summary:'Organize library',operations:[{type:'bin_add',name:'Interviews'},{type:'asset_update',assetId:'a',notes:'Opening',tags:['speaker']}]},plan=await store.plan(args);assert.deepEqual(await store.plan(args),plan);await store.edit({...args,expectedPlanId:plan.planId});const after=canonical(store.db.project);await store.undo({expectedRevision:store.read().revision});assert.deepEqual(store.db.project,p);await store.redo({expectedRevision:store.read().revision});assert.equal(canonical(store.db.project),after);const reopened=new Store(dir,'unused');await reopened.init();assert.equal(canonical(reopened.db.project),after);
});
test('grouped linked media move/lift together, preserve individual source editing and enforce every lock',()=>{
 const p=fixture(),sid=p.activeSequenceId,op=(type,fields)=>({type,sequenceId:sid,...fields}),q=execute(p,[op('item_group',{itemIds:['first','second']})]);const items=q.sequences[0].tracks.flatMap(t=>t.items);assert.equal(new Set(items.map(i=>i.groupId)).size,1);
 const moved=execute(q,[op('item_move',{itemId:'first',time:1})]);assert.deepEqual(moved.sequences[0].tracks[0].items.map(i=>timeSeconds(i.start)),[1,4]);assert.deepEqual(moved.sequences[0].tracks[1].items.map(i=>timeSeconds(i.start)),[1,4]);
 const lifted=execute(q,[op('item_lift',{itemId:'first'})]);assert.equal(lifted.sequences[0].tracks.flatMap(t=>t.items).length,0);
 const solo=execute(q,[op('item_lift',{itemId:'first',linked:false})]);assert.equal(solo.sequences[0].tracks.flatMap(t=>t.items).length,3);
 const trimmed=execute(q,[op('item_trim',{itemId:'first',sourceIn:1,sourceOut:2})]);assert.equal(trimmed.sequences[0].tracks[0].items[1].sourceIn,3);
 const locked=execute(q,[op('track_update',{trackId:q.sequences[0].tracks[1].id,locked:true})]);for(const command of [op('item_move',{itemId:'first',time:1}),op('item_lift',{itemId:'first'}),op('item_ungroup',{itemId:'first'})])assert.throws(()=>execute(locked,[command]),e=>e.code==='TRACK_LOCKED');
 const cleared=execute(q,[op('item_ungroup',{itemId:'first'})]);assert.ok(cleared.sequences[0].tracks.flatMap(t=>t.items).every(i=>!i.groupId));assert.ok(cleared.sequences[0].tracks[0].items[0].linkGroupId);
});
test('selective attribute paste never changes source handles, rejects incompatible keys and is atomic',()=>{
 const p=fixture(),sid=p.activeSequenceId,op=(type,fields)=>({type,sequenceId:sid,...fields}),q=execute(p,[op('item_effects',{itemId:'first',values:{brightness:.2}}),op('item_mask',{itemId:'first',mask:{shape:'ellipse',x:.2,y:.2,width:.5,height:.5,feather:0,opacity:1,inverted:false}})]);
 const source=q.sequences[0].tracks[0].items[0],second=q.sequences[0].tracks[0].items[1],after=execute(q,[op('item_attributes',{sourceItemId:'first',targetItemIds:['second'],properties:['effects','mask']})]);assert.deepEqual(after.sequences[0].tracks[0].items[1].effects,source.effects);assert.deepEqual(after.sequences[0].tracks[0].items[1].mask,source.mask);assert.equal(after.sequences[0].tracks[0].items[1].sourceIn,second.sourceIn);assert.equal(after.sequences[0].tracks[0].items[1].start.numerator,second.start.numerator);
 const before=canonical(q);assert.throws(()=>execute(q,[op('item_attributes',{sourceItemId:'first',targetItemIds:[q.sequences[0].tracks[1].items[0].id],properties:['mask']})]));assert.equal(canonical(q),before);
 assert.throws(()=>execute(q,[op('item_attributes',{sourceItemId:'first',targetItemIds:['second'],properties:['assetId']})]));
 const missing=execute(q,[op('item_attributes',{sourceItemId:'second',targetItemIds:['first'],properties:['mask']})]);assert.equal(missing.sequences[0].tracks[0].items[0].mask,undefined);
});
