// Deliberately small arithmetic language. No JavaScript evaluation or property access.
const functions={abs:[1,Math.abs],sqrt:[1,Math.sqrt],sin:[1,x=>Math.sin(x*Math.PI/180)],cos:[1,x=>Math.cos(x*Math.PI/180)],tan:[1,x=>Math.tan(x*Math.PI/180)],floor:[1,Math.floor],ceil:[1,Math.ceil],round:[1,Math.round],min:[2,Math.min],max:[2,Math.max],pow:[2,Math.pow]};
const constants={pi:Math.PI,e:Math.E};
const fail=message=>{throw new Error(message);};
export function variableName(name){
 if(typeof name!=='string'||!/^[A-Za-z_][A-Za-z_0-9]{0,39}$/.test(name)||Object.hasOwn(functions,name)||Object.hasOwn(constants,name)||['__proto__','constructor','prototype'].includes(name))fail(`Ungültiger oder reservierter Variablenname: ${name}`);
 return name;
}
export function evaluateExpression(source,lookup=()=>undefined){
 if(typeof source==='number'){if(!Number.isFinite(source))fail('Endliche Zahl erwartet.');return source;}
 if(typeof source!=='string'||!source.trim()||source.length>256)fail('Eine Zahl oder Formel mit höchstens 256 Zeichen eingeben.');
 const input=source.trim().replace(/^=/,''),tokens=[];let offset=0;
 while(offset<input.length){
  const match=/^(\s+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z_][A-Za-z_0-9]*|[+*/%^(),-])/.exec(input.slice(offset));
  if(!match)fail(`Ungültiges Zeichen in Formel bei „${input.slice(offset,offset+12)}“.`);
  offset+=match[0].length;if(!/^\s+$/.test(match[0]))tokens.push(match[0]);
 }
 let index=0,depth=0;
 const take=token=>tokens[index]===token?(index++,true):false;
 const finite=value=>{if(!Number.isFinite(value)||Math.abs(value)>1e12)fail('Formel ergibt keinen endlichen Wert innerhalb ±10¹².');return value;};
 function primary(){
  if(++depth>32)fail('Formel zu tief verschachtelt.');
  try{
   if(take('(')){const value=sum();if(!take(')'))fail('Schließende Klammer fehlt.');return value;}
   const token=tokens[index++];if(!token)fail('Unvollständige Formel.');
   if(/^(\d|\.)/.test(token))return finite(Number(token));
   if(!/^[A-Za-z_]/.test(token))fail(`Unerwartetes Zeichen: ${token}`);
   if(take('(')){
    if(!Object.hasOwn(functions,token))fail(`Unbekannte Funktion: ${token}`);
    const args=[sum()];while(take(','))args.push(sum());
    if(!take(')'))fail('Schließende Funktionsklammer fehlt.');
    const [arity,fn]=functions[token];if(args.length!==arity)fail(`${token} erwartet ${arity} Argumente.`);return finite(fn(...args));
   }
   if(Object.hasOwn(constants,token))return constants[token];
   const value=lookup(token);if(typeof value!=='number')fail(`Unbekannte Variable: ${token}`);return finite(value);
  }finally{depth--;}
 }
 function power(){const left=primary();return take('^')?finite(left**unary()):left;}
 function unary(){if(take('+'))return unary();if(take('-'))return -unary();return power();}
 function product(){let value=unary();while(['*','/','%'].includes(tokens[index])){const op=tokens[index++],right=unary();value=finite(op==='*'?value*right:op==='/'?value/right:value%right);}return value;}
 function sum(){let value=product();while(['+','-'].includes(tokens[index])){const op=tokens[index++],right=product();value=finite(op==='+'?value+right:value-right);}return value;}
 const value=sum();if(index!==tokens.length)fail(`Unerwartetes Zeichen: ${tokens[index]}`);return finite(value);
}
export function resolveVariables(definitions={}){
 if(!definitions||typeof definitions!=='object'||Array.isArray(definitions)||Object.keys(definitions).length>64)fail('Maximal 64 benannte Variablen möglich.');
 const values=Object.create(null),visiting=new Set();Object.keys(definitions).forEach(variableName);
 const resolve=name=>{
  if(Object.hasOwn(values,name))return values[name];
  if(!Object.hasOwn(definitions,name))fail(`Unbekannte Variable: ${name}`);
  if(visiting.has(name))fail(`Zyklische Variablen: ${[...visiting,name].join(' → ')}`);
  visiting.add(name);try{return values[name]=evaluateExpression(definitions[name],resolve);}finally{visiting.delete(name);}
 };
 Object.keys(definitions).forEach(resolve);return values;
}
