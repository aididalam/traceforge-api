import { normalizeProductFields } from "./product-metadata.js";
export const maxProductQuantity=Number.MAX_SAFE_INTEGER;
export const removalReasons=["Sold","Lost","Damaged","Spoiled","Disposed","Other"] as const;
export const reservedProductLabels=new Set(["id","quantity","schemaversion","name","product name","product / batch id","initial quantity","number of items"]);
const invalidUnicode=/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const controls=/[\x00-\x1f\x7f-\x9f]/;
export function productId(value:unknown):string {
 if(typeof value!=="string"||!value.trim()||Array.from(value.trim()).length>120||controls.test(value)||invalidUnicode.test(value))throw new Error("Enter a product or batch ID.");
 return value.trim();
}
export function productQuantity(value:unknown=1):number {
 if(typeof value!=="number"||!Number.isSafeInteger(value)||value<1)throw new Error("Enter a positive whole number of items.");
 return value;
}
export function productRegistration(input:{name:string;id:string;quantity?:number;description?:string;fields?:unknown}) {
 const fields=normalizeProductFields(input.fields);
 if(fields.some(field=>reservedProductLabels.has(field.label.toLowerCase())))throw new Error("Use the dedicated product ID and quantity fields.");
 const name=input.name.trim();
 if(!name||name.length>240||controls.test(name)||invalidUnicode.test(name))throw new Error("Enter a product name.");
 return {schemaVersion:2,name,id:productId(input.id),quantity:productQuantity(input.quantity),
  ...(input.description?.trim()?{description:input.description.trim()}:{}),fields};
}
export function removalInput(input:{reason?:unknown;reasonText?:unknown}) {
 const reason=input.reason??"Sold",text=input.reasonText??"";
 if(typeof reason!=="string"||!removalReasons.includes(reason as typeof removalReasons[number])||typeof text!=="string"||
   Array.from(text).length>256||Buffer.byteLength(text,"utf8")>1024||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/.test(text)||
   /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text)||
   (reason!=="Sold"&&!text.trim()))throw new Error("Give a valid removal reason and explanation.");
 return {reason:reason as typeof removalReasons[number],reasonText:text};
}
