// Speech units are sentences. Subtitle groups are a separate presentation concern.
const clean=text=>text.replace(/\s+/gu,' ').trim();
export function sentenceChunks(scenes){
 const segmenter=new Intl.Segmenter('en',{granularity:'sentence'}),chunks=[];
 for(const [sceneIndex,text]of scenes.entries()){
  const sentences=[];for(const {segment}of segmenter.segment(text)){const next=clean(segment);if(!next)continue;const previous=sentences.at(-1);if(previous&&/(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc)\.|\b(?:[A-Z]\.){2,})$/iu.test(previous))sentences[sentences.length-1]+=' '+next;else sentences.push(next);}
  for(const sentence of sentences){if(sentence.length>1000||sentence.split(/\s+/u).length>60)throw Error('A narration sentence exceeds 60 words or 1000 characters. Add sentence punctuation to keep local TTS segments bounded.');chunks.push({sceneIndex,text:sentence});}
 }
 if(chunks.length>500)throw Error('This script exceeds 500 speech sentences. Create multiple stories.');if(chunks.reduce((sum,c)=>sum+Math.ceil(c.text.split(/\s+/u).length/9),0)>500)throw Error('This script exceeds 500 subtitle groups. Create multiple stories.');return chunks;
}
export function sentenceCaptions(text,start,duration){
 if(!Number.isFinite(start)||start<0||!Number.isFinite(duration)||duration<=0)throw Error('Invalid sentence caption timing.');
 const words=clean(text).split(' '),count=Math.ceil(words.length/9),groups=[];let index=0;
 // Balance short captions so a ten-word sentence does not leave a lone-word cue.
 for(let i=0;i<count;i++){const size=Math.ceil((words.length-index)/(count-i)),end=index+size;groups.push({text:words.slice(index,end).join(' '),start:start+duration*index/words.length,end:end===words.length?start+duration:start+duration*end/words.length});index=end;}
 return groups;
}
