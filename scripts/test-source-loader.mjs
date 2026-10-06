import {readFileSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {stripTypeScriptTypes,createRequire} from "node:module";
import {pathToFileURL} from "node:url";
const urls=new Map();
export function sourceUrl(path){
 const file=resolve(path);if(urls.has(file))return urls.get(file);
 const require=createRequire(pathToFileURL(file));
 const code=stripTypeScriptTypes(readFileSync(file,"utf8")).replace(/(^import[^;\n]*?\bfrom\s*|^import\s*)(["'])([^"']+)\2/gm,(whole,start,quote,specifier)=>{
  if(specifier.startsWith("node:"))return whole;
  const target=specifier.startsWith(".")?sourceUrl(resolve(dirname(file),specifier.replace(/\.js$/,".ts"))):pathToFileURL(require.resolve(specifier)).href;
  return start+JSON.stringify(target);
 });
 const url="data:text/javascript;base64,"+Buffer.from(code).toString("base64");urls.set(file,url);return url;
}
export const loadSourceFile=path=>import(sourceUrl(path));
