declare module 'mammoth/mammoth.browser' {
 const mammoth:{
  convertToHtml:(input:{arrayBuffer:ArrayBuffer},options?:{styleMap?:string[]})=>
   Promise<{value:string;messages:Array<{type:string;message:string}>}>
 }
 export default mammoth
}
