declare module 'mammoth/mammoth.browser' {
 const mammoth:{
  extractRawText:(input:{arrayBuffer:ArrayBuffer})=>
   Promise<{value:string;messages:Array<{type:string;message:string}>}>
  convertToHtml:(input:{arrayBuffer:ArrayBuffer},options?:{styleMap?:string[]})=>
   Promise<{value:string;messages:Array<{type:string;message:string}>}>
 }
 export default mammoth
}
