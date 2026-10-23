// Shared catalogue: the UI and CAD kernel use the same parameter defaults.
export const SHAPES={
 box:{name:'Quader',symbol:'▱',color:'#67aba9',params:{width:30,depth:25,height:15},fields:[['width','Breite · X'],['depth','Tiefe · Y'],['height','Höhe · Z']]},
 cylinder:{name:'Zylinder',symbol:'▥',color:'#b1a3c9',params:{radius:12,height:25},fields:[['radius','Radius'],['height','Höhe']]},
 sphere:{name:'Kugel',symbol:'●',color:'#e3af70',params:{radius:12},fields:[['radius','Radius']]},
 cone:{name:'Kegel',symbol:'▲',color:'#d99082',params:{radius:12,topRadius:0,height:25},fields:[['radius','Radius unten'],['topRadius','Radius oben'],['height','Höhe']]},
 tube:{name:'Rohr',symbol:'◎',color:'#81bca0',params:{radius:12,innerRadius:8,height:25},fields:[['radius','Außenradius'],['innerRadius','Innenradius'],['height','Höhe']]},
 torus:{name:'Ring',symbol:'◉',color:'#82acd0',params:{radius:15,tubeRadius:4},fields:[['radius','Ringradius'],['tubeRadius','Querschnittsradius']]},
 wedge:{name:'Keil',symbol:'◩',color:'#c9b471',params:{width:30,depth:25,height:20},fields:[['width','Breite'],['depth','Tiefe'],['height','Höhe']]},
 pyramid:{name:'Pyramide',symbol:'△',color:'#bf99b4',params:{width:25,depth:25,height:25},fields:[['width','Breite'],['depth','Tiefe'],['height','Höhe']]},
 prism:{name:'Vieleck-Prisma',symbol:'⬡',color:'#8eadd0',params:{radius:14,sides:6,height:20},fields:[['radius','Umkreisradius'],['sides','Seiten'],['height','Höhe']]},
 capsule:{name:'Kapsel',symbol:'⬭',color:'#a6b982',params:{radius:8,height:30},fields:[['radius','Radius'],['height','Gesamthöhe']]},
};
export const shapeName=kind=>SHAPES[kind]?.name||({imported:'STEP-Körper',boolean:'Kombination',profile:'Skizzenkörper'})[kind]||kind;
export const sketchName=kind=>({rectangle:'Rechteck',circle:'Kreis',ellipse:'Ellipse',polygon:'Vieleck'})[kind]||kind;
export const isRadial=kind=>kind==='circle'||kind==='polygon';
