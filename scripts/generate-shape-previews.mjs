// Run npm run dev first, then node scripts/generate-shape-previews.mjs.
// Render the same WASM solids used by the editor; no extra runtime WebGL contexts.
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const browser=await chromium.launch();
try{
 const page=await browser.newPage();
 await page.goto('http://127.0.0.1:5173/');
 const previews=await page.evaluate(async()=>{
  const THREE=await import('/vendor/three.module.js');
  const {SHAPES}=await import('/shapes.js');
  const {calculate}=await import('/cad-client.js');
  const objects=Object.entries(SHAPES).filter(([kind])=>!['box','cylinder'].includes(kind)).map(([kind,s])=>({id:kind,kind,params:s.params}));
  const result=await calculate('model',{project:{version:1,objects}});
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
  renderer.setSize(256,192);renderer.outputColorSpace=THREE.SRGBColorSpace;
  const scene=new THREE.Scene();scene.add(new THREE.HemisphereLight(0xffffff,0x778794,2.2));
  const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(-40,-60,100);scene.add(light);
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.1,1000);camera.up.set(0,0,1);
  const output={};
  for(const model of result.objects){
   const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(model.mesh.vertices.flat(),3));geometry.setIndex(model.mesh.triangles.flat());geometry.computeVertexNormals();
   const material=new THREE.MeshStandardMaterial({color:SHAPES[model.id].color,roughness:.65,metalness:.05});
   const mesh=new THREE.Mesh(geometry,material);scene.add(mesh);
   const edges=new THREE.EdgesGeometry(geometry,30),edgeMaterial=new THREE.LineBasicMaterial({color:0x344d5b,transparent:true,opacity:.22});
   const lines=new THREE.LineSegments(edges,edgeMaterial);scene.add(lines);
   const bounds=new THREE.Box3(new THREE.Vector3(...model.bounds.min),new THREE.Vector3(...model.bounds.max)),center=bounds.getCenter(new THREE.Vector3());
   const radius=bounds.getSize(new THREE.Vector3()).length()/2,half=radius*.92;
   camera.left=-half*4/3;camera.right=half*4/3;camera.top=half;camera.bottom=-half;camera.position.copy(center).add(new THREE.Vector3(1,-1.5,1.1).normalize().multiplyScalar(150));camera.lookAt(center);camera.updateProjectionMatrix();
   renderer.render(scene,camera);output[model.id]=renderer.domElement.toDataURL('image/png').split(',')[1];
   scene.remove(mesh,lines);geometry.dispose();material.dispose();edges.dispose();edgeMaterial.dispose();
  }
  renderer.dispose();return output;
 });
 await mkdir(new URL('../web/public/shapes/',import.meta.url),{recursive:true});
 for(const [kind,data] of Object.entries(previews))await writeFile(new URL(`../web/public/shapes/${kind}.png`,import.meta.url),Buffer.from(data,'base64'));
 console.log(`Generated ${Object.keys(previews).length} CAD shape previews.`);
}finally{await browser.close();}
