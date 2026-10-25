// Approved local fonts. Bundled fonts never require a runtime web request.
export const fontChoices=[
 {id:'sans',name:'Arial · regular',group:'System',use:'Neutral captions and longer explanations'},
 {id:'sans-bold',name:'Arial · bold',group:'System',use:'Familiar bold captions'},
 {id:'serif',name:'Times New Roman',group:'System',use:'Traditional editorial storytelling'},
 {id:'montserrat',name:'Montserrat ExtraBold',group:'Clean & versatile',use:'Strong general-purpose captions, business and education'},
 {id:'inter',name:'Inter Bold',group:'Clean & versatile',use:'Interviews, technology and clear explanations'},
 {id:'poppins',name:'Poppins Bold',group:'Clean & versatile',use:'Lifestyle, wellness and friendly storytelling'},
 {id:'roboto-condensed',name:'Roboto Condensed Bold',group:'Condensed & bold',use:'Longer captions, news and explainers'},
 {id:'oswald',name:'Oswald Bold',group:'Condensed & bold',use:'Documentary, sports and punchy headlines'},
 {id:'anton',name:'Anton',group:'Condensed & bold',use:'Heavy, compact hooks and emphasis'},
 {id:'bebas-neue',name:'Bebas Neue',group:'Condensed & bold',use:'Tall uppercase hooks and short captions'},
 {id:'archivo-black',name:'Archivo Black',group:'Display & story',use:'Heavy headlines, fitness and bold statements'},
 {id:'bangers',name:'Bangers',group:'Display & story',use:'Playful comics, gaming and entertainment'},
 {id:'lora',name:'Lora SemiBold',group:'Display & story',use:'Serif storytelling, cinematic and editorial captions'}
];
export const fontIds=fontChoices.map(f=>f.id);
export function validateCaptionFont(id){if(id!==undefined&&id!=='preset'&&!fontIds.includes(id))throw Error('Choose an available local caption font.');}
