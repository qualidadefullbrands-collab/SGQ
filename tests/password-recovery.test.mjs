import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const app=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8')
const start=app.indexOf('async function requestPasswordReset(')
const end=app.indexOf('function resetNewInspection(',start)
const recovery=app.slice(start,end)
const loginUI=app.slice(app.indexOf('if (!userId || recoveryMode) {'),app.indexOf("if (!profile) return"))

test('reset email always targets the public SGQ, not local development',()=>{
 assert.match(app,/const RECOVERY_REDIRECT_URL = 'https:\/\/app-sgq\.onrender\.com\/\?auth=recovery'/)
 assert.match(recovery,/redirectTo: RECOVERY_REDIRECT_URL/)
 assert.doesNotMatch(recovery,/redirectTo:\s*window\.location\.(origin|href)/)
 assert.match(recovery,/supabase\.auth\.resetPasswordForEmail\(email/)
})
test('password update is authorized only by a verified recovery event, not an existing login',()=>{
 assert.match(app,/const \[recoveryVerified, setRecoveryVerified\] = useState\(false\)/)
 assert.match(app,/if \(event === 'PASSWORD_RECOVERY'\) \{[\s\S]*setRecoveryVerified\(!!session\?\.user\)/)
 assert.match(recovery,/if \(!userId \|\| !recoveryVerified\) return setError/)
 assert.match(loginUI,/userId && recoveryVerified \?/)
 assert.match(loginUI,/userId && recoveryVerified && <button/)
 assert.match(loginUI,/!userId \|\| !recoveryVerified/)
 assert.match(recovery,/supabase\.auth\.updateUser\(\{ password: recoveryPassword \}\)/)
})
test('invalid or reused token can request a new link without using an old session',()=>{
 assert.match(app,/recoveryUrlError === 'otp_expired'/)
 for(const key of ['auth','error','error_code','error_description']){
  assert.ok(app.includes("url.searchParams.delete('"+key+"')"))
 }
 assert.match(loginUI,/setRecoveryVerified\(false\);setForgotPassword\(true\)/)
 assert.match(recovery,/setRecoveryVerified\(false\)/)
 assert.match(loginUI,/Enviar link de recuperação/)
})
