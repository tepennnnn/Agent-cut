import {cueWordAlignment} from './word-timing.js';
import {fontIds,validateCaptionFont} from './font-model.js';
// Pinned captions.js 1.10.0 presets. Local fonts replace online font requests.
export const motionStyles=[
  {
    "id": "motion:karaoke",
    "name": "Karaoke",
    "font": "sans-bold"
  },
  {
    "id": "motion:focus-box",
    "name": "Focus Box",
    "font": "sans-bold"
  },
  {
    "id": "motion:banger",
    "name": "Banger",
    "font": "sans-bold"
  },
  {
    "id": "motion:acid",
    "name": "Acid",
    "font": "sans-bold"
  },
  {
    "id": "motion:lovly",
    "name": "Lovly",
    "font": "sans-bold"
  },
  {
    "id": "motion:marvel",
    "name": "Marvel",
    "font": "sans-bold"
  },
  {
    "id": "motion:marker",
    "name": "Marker",
    "font": "sans-bold"
  },
  {
    "id": "motion:neon-pulse",
    "name": "Neon Pulse",
    "font": "sans-bold"
  },
  {
    "id": "motion:beasty",
    "name": "Beasty",
    "font": "sans-bold"
  },
  {
    "id": "motion:crazy",
    "name": "Crazy",
    "font": "sans-bold"
  },
  {
    "id": "motion:safari",
    "name": "Safari",
    "font": "sans-bold"
  },
  {
    "id": "motion:popline",
    "name": "Popline",
    "font": "sans-bold"
  },
  {
    "id": "motion:desert",
    "name": "Desert",
    "font": "sans-bold"
  },
  {
    "id": "motion:hook",
    "name": "Hook",
    "font": "sans-bold"
  },
  {
    "id": "motion:sky",
    "name": "Sky",
    "font": "sans-bold"
  },
  {
    "id": "motion:flamingo",
    "name": "Flamingo",
    "font": "sans-bold"
  },
  {
    "id": "motion:deep-diver-b-w",
    "name": "Deep Diver B&W",
    "font": "sans-bold"
  },
  {
    "id": "motion:new",
    "name": "New",
    "font": "sans-bold"
  },
  {
    "id": "motion:catchy",
    "name": "Catchy",
    "font": "sans-bold"
  },
  {
    "id": "motion:from",
    "name": "From",
    "font": "sans-bold"
  },
  {
    "id": "motion:classic",
    "name": "Classic",
    "font": "sans-bold"
  },
  {
    "id": "motion:classic-big",
    "name": "Classic Big",
    "font": "sans-bold"
  },
  {
    "id": "motion:old-money",
    "name": "Old Money",
    "font": "serif"
  },
  {
    "id": "motion:cinema",
    "name": "Cinema",
    "font": "sans-bold"
  },
  {
    "id": "motion:midnight-serif",
    "name": "Midnight Serif",
    "font": "serif"
  },
  {
    "id": "motion:aurora-ink",
    "name": "Aurora Ink",
    "font": "sans-bold"
  }
];

export const captionStyles=[{id:'clean',name:'Clean · white'},{id:'emphasis',name:'Emphasis · lime'},...motionStyles];
export const captionStyleIds=captionStyles.map(s=>s.id);
export function motionStyle(id){return motionStyles.find(s=>s.id===id);}
export function validateMotion(value){if(value===undefined)return;if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['preset','font'].includes(k))||!motionStyle(value.preset))throw Error('Choose an available captions.js preset.');if(value.font!==undefined&&!fontIds.includes(value.font))throw Error('Choose an available local caption font.');}
export function localPreset(id,getPreset,fontId){const spec=motionStyle(id);if(!spec)throw Error('Unknown animated caption style.');validateCaptionFont(fontId);const font=fontId&&fontId!=='preset'?fontId:spec.font;const preset=structuredClone(getPreset(spec.name));preset.captionsSettings.style.font.fontFamily='AgentCut-'+font;preset.captionsSettings.style.font.fontWeight='regular';preset.captionsSettings.position='bottom';const shadow=preset.captionsSettings.style.font.shadow;if(shadow&&!/^#[a-f0-9]{6,8}$/i.test(shadow.fontShadowColor))shadow.fontShadowColor='#00000000';return preset;}
// Existing narration has measured phrase boundaries only. Word timing is an
// explicit proportional estimate, never represented as speech alignment.
export function motionWords(captions,offset=0,alignment){return captions.flatMap(c=>{const aligned=cueWordAlignment(c,alignment);if(aligned)return aligned.map(w=>({word:w.text,startTime:w.start-offset,endTime:w.end-offset,sentenceStartTime:c.start-offset,sentenceEndTime:c.end-offset}));const words=c.text.trim().split(/\s+/u),weights=words.map(w=>Math.max(1,[...w].length)),sum=weights.reduce((a,b)=>a+b,0);let cursor=c.start;return words.map((word,i)=>{const startTime=cursor-offset;cursor=i===words.length-1?c.end:cursor+(c.end-c.start)*weights[i]/sum;return {word,startTime,endTime:cursor-offset,sentenceStartTime:c.start-offset,sentenceEndTime:c.end-offset};});});}
