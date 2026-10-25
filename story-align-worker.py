"""Local English CTC alignment. Never downloads models or opens network sockets."""
import os
os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', DO_NOT_TRACK='1')
import sys,json,socket,wave,unicodedata,re,itertools,difflib,contextlib

def denied(*args,**kwargs): raise RuntimeError('Alignment is offline. Configure an existing local acoustic model.')
socket.create_connection=denied
socket.socket.connect=denied
socket.socket.connect_ex=denied
socket.getaddrinfo=denied

def main(r):
 with contextlib.redirect_stdout(sys.stderr):
  import torch,torchaudio,numpy as np
  if not torch.__version__.startswith('2.6.') or not torchaudio.__version__.startswith('2.6.'):
   raise RuntimeError('This alignment adapter requires the verified torch/torchaudio 2.6 runtime.')
  if r['action']=='probe':return {'torch':torch.__version__,'torchaudio':torchaudio.__version__,'offline':True,'language':'en','method':'CTC forced alignment'}
  torch.set_num_threads(r.get('threads',2))
  labels=torchaudio.pipelines.WAV2VEC2_ASR_BASE_960H.get_labels();dictionary={c:i for i,c in enumerate(labels)}
  normalized=[]
  for word in r['words']:
   value=unicodedata.normalize('NFKD',word.replace('’',"'").replace('‘',"'")).upper()
   value=''.join(c for c in value if not unicodedata.combining(c));value=re.sub(r"[^A-Z']",'',value).strip("'")
   if not value or any(c.isdigit() for c in word) or any(c.isalpha() and c not in "ABCDEFGHIJKLMNOPQRSTUVWXYZ'" for c in unicodedata.normalize('NFKD',word).upper() if not unicodedata.combining(c)):
    raise RuntimeError('English alignment requires written-out English words; unsupported token: '+word)
   normalized.append(value)
  tokens=[]
  for i,word in enumerate(normalized):
   if i:tokens.append(dictionary['|'])
   tokens.extend(dictionary[c] for c in word)
  with wave.open(r['wav'],'rb') as f:
   if f.getnchannels()!=1 or f.getsampwidth()!=2 or f.getframerate()!=16000:raise RuntimeError('Expected normalized mono 16 kHz PCM.')
   duration=f.getnframes()/16000
   if not .2<=duration<=120:raise RuntimeError('Alignment supports 0.2–120 seconds of English narration.')
   signal=torch.from_numpy(np.frombuffer(f.readframes(f.getnframes()),dtype='<i2').copy()).float()/32768
  model=torchaudio.models.wav2vec2_base(aux_num_out=len(labels))
  state=torch.load(r['modelPath'],map_location='cpu',weights_only=True)
  # Official torchaudio bundle removes the fairseq BOS/PAD/EOS output rows (1,2,3).
  for key in ['aux.weight','aux.bias']:
   if state[key].size(0)==32:state[key]=state[key][[0]+list(range(4,32))]
  model.load_state_dict(state,strict=True);model.eval()
  emissions=[];frame_starts=[];frame_ends=[]
  with torch.inference_mode():
   # Bound acoustic attention memory. The final short tail is included with its previous window.
   span=20*16000;offset=0
   while offset<len(signal):
    end=min(len(signal),offset+span)
    if 0<len(signal)-end<1600:end=len(signal)
    emission,_=model(signal[offset:end].unsqueeze(0));emission=emission.log_softmax(-1).cpu();n=emission.size(1)
    emissions.append(emission)
    for j in range(n):frame_starts.append((offset+j*320)/16000);frame_ends.append(min(end/16000,(offset+(j+1)*320)/16000))
    offset=end
   emission=torch.cat(emissions,dim=1)
   target=torch.tensor([tokens],dtype=torch.int32)
   aligned,scores=torchaudio.functional.forced_align(emission,target,blank=0)
   spans=torchaudio.functional.merge_tokens(aligned[0],scores[0].exp())
  if [s.token for s in spans]!=tokens:raise RuntimeError('Alignment did not cover every script token.')
  words=[];pos=0
  for original,word in zip(r['words'],normalized):
   if pos:pos+=1
   selected=spans[pos:pos+len(word)];pos+=len(word)
   words.append({'text':original,'start':frame_starts[selected[0].start],'end':frame_ends[selected[-1].end-1],'score':sum(float(s.score) for s in selected)/len(selected)})
  greedy=''.join(labels[i] for i,_ in itertools.groupby(emission.argmax(-1)[0].tolist()) if i!=0).replace('|',' ').strip()
  similarity=difflib.SequenceMatcher(None,re.sub(r'[^A-Z]','',' '.join(normalized)),re.sub(r'[^A-Z]','',greedy),autojunk=False).ratio()
  if similarity<.65:raise RuntimeError('Audio/script match is too weak for reliable resync. Check that this narration reads the same script.')
  return {'method':'ctc-wav2vec2-base-en-v1','language':'en','duration':duration,'words':words,'quality':{'transcriptSimilarity':similarity,'meanScore':sum(w['score'] for w in words)/len(words),'lowScoreWords':[i for i,w in enumerate(words) if w['score']<.35]},'timing':'Acoustic word alignment; machine estimates requiring review','offline':True,'greedyTranscript':greedy}
if __name__=='__main__':
 try:
  with open(sys.argv[1],encoding='utf-8-sig') as f:r=json.load(f)
  print(json.dumps(main(r)))
 except Exception as e:
  print(type(e).__name__+': '+str(e),file=sys.stderr);sys.exit(1)

