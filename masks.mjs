export const maskDefaults={x:.25,y:.25,width:.5,height:.5,feather:0,inverted:false,opacity:1};
export function validateMask(mask,kind='video'){
 if(mask===undefined)return;
 if(kind!=='video'||!mask||typeof mask!=='object'||Array.isArray(mask)||Object.keys(mask).some(k=>!['shape',...Object.keys(maskDefaults)].includes(k))||!['rectangle','ellipse'].includes(mask.shape))throw Error('Mask requires a video item and a rectangle or ellipse.');
 const m={...maskDefaults,...mask};for(const [key,min,max]of [['x',0,1],['y',0,1],['width',.01,1],['height',.01,1],['feather',0,.25],['opacity',0,1]])if(!Number.isFinite(m[key])||m[key]<min||m[key]>max)throw Error('Invalid mask '+key+'.');
 if(typeof m.inverted!=='boolean'||m.x+m.width>1+1e-8||m.y+m.height>1+1e-8)throw Error('Mask bounds must fit inside the cropped source image.');
}
export function maskFilter(mask){
 if(!mask)return '';validateMask(mask);const m={...maskDefaults,...mask},cx=m.x+m.width/2,cy=m.y+m.height/2;
 const distance=m.shape==='rectangle'?`min(min(X/W-${m.x},${m.x+m.width}-X/W),min(Y/H-${m.y},${m.y+m.height}-Y/H))`:`(1-sqrt(pow((X/W-${cx})/${m.width/2},2)+pow((Y/H-${cy})/${m.height/2},2)))*${Math.min(m.width,m.height)/2}`;
 const coverage=m.feather?`clip(0.5+(${distance})/${m.feather},0,1)`:`gte(${distance},0)`,alpha=`${m.opacity}*(${m.inverted?'1-':''}(${coverage}))`;
 return `,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*(${alpha})'`;
}
