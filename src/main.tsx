import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)


// New releases must never silently leave an already-open SGQ tab on an
// obsolete form. Offer a deliberate reload, protecting unsaved user entries.
function showSgqUpdateNotice(){
  if(document.getElementById('sgq-update-ready'))return
  const bar=document.createElement('div')
  bar.id='sgq-update-ready'
  bar.setAttribute('role','status')
  bar.style.cssText='position:fixed;bottom:16px;left:16px;right:16px;z-index:99999;max-width:520px;background:#173e56;color:#fff;padding:13px 16px;border-radius:11px;box-shadow:0 6px 25px #0004;display:flex;align-items:center;gap:13px;flex-wrap:wrap;font:14px sans-serif;'
  const message=document.createElement('span')
  message.textContent='Uma atualização do SGQ está disponível. Salve o que estiver preenchendo e atualize a tela.'
  message.style.cssText='flex:1;min-width:200px;line-height:1.5;'
  const button=document.createElement('button')
  button.type='button'
  button.textContent='Atualizar SGQ'
  button.style.cssText='background:#fff;color:#173e56;border:0;border-radius:7px;padding:9px 13px;font:600 13px sans-serif;cursor:pointer;'
  button.addEventListener('click',()=>window.location.reload())
  bar.append(message,button)
  document.body.append(bar)
}
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    let alreadyControlled=Boolean(navigator.serviceWorker.controller)
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(alreadyControlled)showSgqUpdateNotice()
      alreadyControlled=true
    })
    navigator.serviceWorker.register('/sw.js',{updateViaCache:'none'}).then(registration=>{
      if(registration.waiting&&navigator.serviceWorker.controller)showSgqUpdateNotice()
      registration.addEventListener('updatefound',()=>{
        const worker=registration.installing
        worker?.addEventListener('statechange',()=>{
          if(worker.state==='installed'&&navigator.serviceWorker.controller)showSgqUpdateNotice()
        })
      })
      // Also discover releases in long-lived tabs without requiring a manual reload.
      const check=()=>{if(document.visibilityState==='visible')void registration.update().catch(()=>undefined)}
      window.addEventListener('focus',check)
      window.setInterval(check,180000)
    }).catch(() => undefined)
  })
}
