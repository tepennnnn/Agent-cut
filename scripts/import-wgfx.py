from pathlib import Path
import json,hashlib,xml.etree.ElementTree as E,re,math,sys
source=Path(sys.argv[1] if len(sys.argv)>1 else r'C:\Users\tepen\Downloads\60+ Transitions WGFX\60+ Transitions WGFX.prfpset')
out=Path(sys.argv[2] if len(sys.argv)>2 else 'outputs/agent-cut')
b=source.read_bytes()
if len(b)>8*1024**2 or b'<!DOCTYPE' in b or b'<!ENTITY' in b:raise ValueError('Unsupported preset XML')
r=E.fromstring(b);nodes={n.get('ObjectID'):n for n in r if n.get('ObjectID')};sha=hashlib.sha256(b).hexdigest()
def children(n):return [nodes[x.get('ObjectRef')] for x in n.findall('./Items/Item')]
def name(n):return (n.findtext('./TreeItemBase/Name') or '').strip()
def param(n):
 def value(s):
  try:
   if s in ['true','false']:return s=='true'
   v=[float(x)for x in s.split(':')];return v if len(v)>1 else v[0]
  except:return 0
 keys=[]
 for record in (n.findtext('Keyframes') or '').split(';'):
  if not record.strip():continue
  parts=record.split(',');keys.append({'tick':int(parts[0]),'value':value(parts[1]),'interpolation':parts[2] if len(parts)>2 else None})
 start=(n.findtext('StartKeyframe') or '').split(',');default=value(start[1])if len(start)>1 else value(n.findtext('CurrentValue')or'0')
 return {'rawKeyframes':n.findtext('Keyframes'),'rawStartKeyframe':n.findtext('StartKeyframe'),'rawCurrentValue':n.findtext('CurrentValue'),'id':n.get('ObjectID'),'name':n.findtext('Name')or'','parameterId':n.findtext('ParameterID'),'default':default,'keys':keys}
def effects(leaf):
 item=nodes[leaf.find('./TreeItemBase/Data').get('ObjectRef')];result=[]
 for ref in item.findall('./FilterPresets/FilterPreset'):
  f=nodes[ref.get('ObjectRef')];c=nodes[f.find('Component').get('ObjectRef')]
  result.append({'presetObjectId':f.get('ObjectID'),'componentObjectId':c.get('ObjectID'),'matchName':c.findtext('MatchName'),'anchorIn':int(f.findtext('AnchorInPoint')),'anchorOut':int(f.findtext('AnchorOutPoint')),'params':[param(nodes[x.get('ObjectRef')])for x in c.findall('./Component/Params/Param')]})
 return result

def at(p,t):
 keys=sorted(p['keys'],key=lambda k:k['tick'])
 if not keys:return p['default']
 if t<=keys[0]['tick']:return keys[0]['value']
 for a,z in zip(keys,keys[1:]):
  if t<=z['tick']:
   u=(t-a['tick'])/(z['tick']-a['tick']);v,w=a['value'],z['value']
   # Preserve key values; Adobe's proprietary Bezier tangent semantics are not emulated.
   if isinstance(v,list):return [x+(y-x)*u for x,y in zip(v,w)]
   return v+(w-v)*u
 return keys[-1]['value']

def sample(effects,u):
 d={'sx':1.,'sy':1.,'angle':0.,'x':0.,'y':0.,'offsetX':0.,'offsetY':0.,'red':0.,'green':0.,'blue':0.,'flash':0.,'blur':0.,'echo':0.,'lens':0.,'turbulence':0.,'noise':0.}
 for e in effects:
  ps=e['params'];values={p['name']:at(p,e['anchorIn']+(e['anchorOut']-e['anchorIn'])*u)for p in ps if p['name']};typ=e['matchName']
  def v(n,default=0):return values.get(n,default)
  if typ=='AE.ADBE Geometry':
   uniform=next((at(p,e['anchorIn'])for p in ps if p['parameterId']=='11'),False)
   sx=v('Scale Height',100)if uniform else v('Scale Width',100);sy=v('Scale Height',100)
   d['sx']*=sx/100;d['sy']*=sy/100;d['angle']+=v('Rotation');pos=v('Position',[.5,.5]);anchor=v('Anchor Point',[.5,.5]);angle=v('Rotation')*math.pi/180
   tx=pos[0]-.5-(anchor[0]-.5)*sx/100*math.cos(angle)+(anchor[1]-.5)*sy/100*math.sin(angle)
   ty=pos[1]-.5-(anchor[0]-.5)*sx/100*math.sin(angle)-(anchor[1]-.5)*sy/100*math.cos(angle)
   oldx,oldy=d['x'],d['y'];d['x']=oldx*sx/100*math.cos(angle)-oldy*sy/100*math.sin(angle)+tx;d['y']=oldx*sx/100*math.sin(angle)+oldy*sy/100*math.cos(angle)+ty
  elif typ=='AE.ADBE Offset':
   p=v('Shift Center To',[.5,.5]);d['offsetX']+=p[0]-.5;d['offsetY']+=p[1]-.5
  elif typ=='AE.ADBE Channel Blur':
   for c in ['red','green','blue']:d[c]+=v(c.title()+' Blurriness')/1920
  elif typ=='AE.ADBE Motion Blur':d['blur']=max(d['blur'],v('Blur Length')/100)
  elif typ=='AE.ADBE Echo':d['echo']=max(d['echo'],min(1,v('Decay')*v('Number Of Echoes')/5))
  elif typ=='PR.ADBE Lens Distortion':d['lens']+=v('Curvature')/100
  elif typ=='AE.ADBE Turbulent Displace':d['turbulence']+=v('Amount')/1920
  elif typ=='AE.ADBE Noise HLS':d['noise']=max(d['noise'],v('Lightness')/100)
  elif typ=='AE.ADBE Solid Composite':d['flash']=max(d['flash'],v('Opacity')/100)
 return {k:round(float(v),6)for k,v in d.items()}

pack=nodes['5'];categories=['glitch','offset_color','offset','stretch_echo','stretch_glow','stretch','wiggle_color','wiggle','zoom_color','zoom'];recipes=[];records=[]
for group,category in zip(children(pack),categories):
 for child in children(group):
  leaves=[child]if child.tag=='TreeItem'else children(child)
  fx=[e for leaf in leaves for e in effects(leaf)];original=name(child);number=int(re.search(r'(\d+)\s*$',original).group(1));id='wgfx_'+category+'_'+str(number).zfill(2)
  samples=[sample(fx,i/8)for i in range(9)];base=dict(samples[0])
  # Multi-effect zoom presets include static 50%/200% mirror scaffolding.
  # Normalize its baseline so the adaptation meets unmodified footage at both ends.
  for i,s in enumerate(samples):
   s['sx']=max(.2,min(5,round(s['sx']/max(.01,base['sx']),6)));s['sy']=max(.2,min(5,round(s['sy']/max(.01,base['sy']),6)))
  if category=='stretch_glow':
   for s in samples:s['flash']=max(s['flash'],round(s['echo']*.35,6))
  display=(category.replace('_',' ').title()+' '+str(number).zfill(2))
  recipes.append({'id':id,'name':display,'category':category,'sourceName':original,'sourceObjectIds':[leaf.get('ObjectID')for leaf in leaves],'effects':sorted(set(e['matchName']for e in fx)),'samples':samples})
  records.append({'id':id,'sourceName':original,'category':name(group),'leaves':[{'objectId':leaf.get('ObjectID'),'name':name(leaf)}for leaf in leaves],'effects':fx})
assert len(recipes)==74 and len(set(x['id']for x in recipes))==74
report={'source':str(source),'sha256':sha,'bytes':len(b),'designCount':74,'presetComponentCount':118,'effectCount':367,'categories':categories,'format':'PremiereData XML Version 3','authority':'Direct XML parsing; not Premiere runtime observation','limitations':['No Adobe render comparison was supplied.','Mirror and Invert operators are not executed; mirror scaffolding is normalized and edge behavior uses wrap/clamp.','Adobe Bezier tangents, mirror tiling, per-channel blur, echo compositing and lens math are adapted, not reproduced exactly.','Numeric key values are retained in the inventory; render recipes use nine normalized linear samples.'],'records':records}
(out/'wgfx-recipes.json').write_text(json.dumps({'version':1,'sourceSha256':sha,'recipes':recipes},indent=2))
(out/'wgfx-source-report.json').write_text(json.dumps(report,indent=2))
base=[{'id':x,'name':n,'category':'basic','adapted':False}for x,n in [('cross_dissolve','Cross dissolve'),('dip_black','Dip to black'),('dip_white','Dip to white'),('wipe_left_to_right','Wipe left to right'),('wipe_right_to_left','Wipe right to left'),('wipe_top_to_bottom','Wipe top to bottom'),('wipe_bottom_to_top','Wipe bottom to top')]]
catalog=base+[{'id':s['id'],'name':'WGFX · '+s['name']+' (adapted)','category':s['category'],'adapted':True}for s in recipes]
(out/'ui/transition-model.js').write_text('// Locally adapted from the user-supplied WGFX preset XML; see wgfx-source-report.json.\nexport const transitionCatalog='+json.dumps(catalog,indent=2)+';\nexport const transitionIds=transitionCatalog.map(s=>s.id);\nexport const storyTransitionIds=["none",...transitionIds];\nexport function transitionSettings(kind="none",seconds=.4){if(!storyTransitionIds.includes(kind))throw Error("Choose an available scene transition.");if(!Number.isFinite(seconds)||seconds<.1||seconds>2)throw Error("Transition duration must be 0.1–2 seconds.");return {kind,seconds};}\n')
print(json.dumps({'designs':74,'groups':10,'sourceSha256':sha}))
