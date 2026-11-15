/**
 * SGQ release gate: read-only GitHub/Render checks and public smoke.
 * No deployment, database writes, test credentials or access to Omie.
 */
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const REPO = 'qualidadefullbrands-collab/SGQ'
const FRONT_ID = 'srv-daum6c49v7es73a3vh40'
const API_ID = 'srv-davs50rtqb8s73djoun0'
export const REQUIRED_MAIN_CHECKS = ['frontend', 'api', 'word', 'inventory-photo-edge']
export const REQUIRED_PR_CHECKS = [
  ...REQUIRED_MAIN_CHECKS,
  'JWT real → PostgREST/RLS + Storage → API .NET → Word',
  'API ASP.NET 10 → Word FastAPI · HTTP sintético',
  'PostgreSQL real · migrações SGQ / conciliação física',
  'QC publicado · frontend e API (somente leitura)',
  'Auth real · Storage RLS · dados totalmente sintéticos',
  'Roles reais · RLS/PostgREST/Storage · SQL de políticas do SGQ',
  'Chromium desktop e mobile · dados sintéticos',
]

export function hasIndependentApproval(mergedPr, reviews) {
  if (!mergedPr?.user?.login || !mergedPr?.head?.sha || !Array.isArray(reviews)) return false
  const lastByReviewer = new Map()
  const submitted = reviews.filter((r) => r?.user?.login && r.submitted_at)
    .sort((a, b) => a.submitted_at.localeCompare(b.submitted_at))
  for (const review of submitted) lastByReviewer.set(review.user.login.toLowerCase(), review)
  return [...lastByReviewer.values()].some((r) =>
    r.user.login.toLowerCase() !== mergedPr.user.login.toLowerCase() &&
    r.state === 'APPROVED' &&
    r.commit_id === mergedPr.head.sha
  )
}

function successfulChecks(runs, required, label, blockers) {
  if (!Array.isArray(runs)) {
    blockers.push(label+': lista de verificações indisponível')
    return
  }
  for (const name of required) {
    const matches = runs.filter((r) => r.name === name)
    if (!matches.length || !matches.some((r) => r.status === 'completed' && r.conclusion === 'success')) {
      blockers.push(label+': '+name+' sem execução aprovada')
    }
  }
}

/** Pure decision function. Its output is safe to save as CI evidence. */
export function assessRelease({ candidateSha, mainSha, mergedPr, prReviews, mainChecks, prChecks, frontendDeploy, apiDeploy, smokePassed, operationalApproved, homologationReference }) {
  const blockers = []
  const shaIsValid = /^[0-9a-f]{40}$/i.test(candidateSha ?? '')
  if (!shaIsValid) blockers.push('SHA candidato inválido (exige 40 caracteres hexadecimais)')
  if (!mainSha || candidateSha !== mainSha) blockers.push('Candidato não é o HEAD atual de main')
  if (!mergedPr || !mergedPr.merged_at || mergedPr.base?.ref !== 'main' || mergedPr.merge_commit_sha !== candidateSha || !/^[0-9a-f]{40}$/i.test(mergedPr.head?.sha ?? '')) {
    blockers.push('PR revisável integrado em main não localizado para o SHA candidato')
  }
  if (!hasIndependentApproval(mergedPr, prReviews)) blockers.push('PR não possui aprovação independente válida no commit revisado')
  successfulChecks(mainChecks, REQUIRED_MAIN_CHECKS, 'main', blockers)
  successfulChecks(prChecks, REQUIRED_PR_CHECKS, 'PR original', blockers)
  if (!frontendDeploy || frontendDeploy.status !== 'live' || frontendDeploy.commit?.id !== candidateSha) blockers.push('Frontend Render não está LIVE no SHA candidato')
  if (!apiDeploy || apiDeploy.status !== 'live' || apiDeploy.commit?.id !== candidateSha) blockers.push('API Render não está LIVE no SHA candidato')
  if (!smokePassed) blockers.push('Smoke público pós-deploy não aprovado')
  if (operationalApproved !== true || !/^[A-Za-z0-9._:/#-]{8,120}$/.test(homologationReference ?? '')) blockers.push('Homologação operacional sem atestado/referência verificável')
  return {
    decision: blockers.length ? 'NO-GO' : 'GO_TECNICO_COM_ATESTADO',
    candidateSha: shaIsValid ? candidateSha : '(inválido)',
    githubMainSha: mainSha ?? null,
    prNumber: mergedPr?.number ?? null,
    independentReviewApproved: hasIndependentApproval(mergedPr, prReviews),
    prHeadSha: mergedPr?.head?.sha ?? null,
    renderFrontendSha: frontendDeploy?.commit?.id ?? null,
    renderApiSha: apiDeploy?.commit?.id ?? null,
    smokePassed: smokePassed === true,
    operationalApproved: operationalApproved === true,
    homologationReference: homologationReference ?? null,
    blockers,
    timestampUtc: new Date().toISOString(),
  }
}

async function readJson(url, token, provider) {
  if (!token) throw new Error(provider+': credencial de leitura ausente')
  const headers = { accept: 'application/json', authorization: 'Bearer '+token }
  if (provider === 'GitHub') headers['X-GitHub-Api-Version'] = '2022-11-28'
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(provider+': HTTP '+response.status+' em consulta somente leitura')
  return response.json()
}

function liveDeploy(items) {
  if (!Array.isArray(items)) return null
  return items.map((x) => x.deploy ?? x).find((x) => x?.status === 'live') ?? null
}

function smoke() {
  const result = spawnSync(process.execPath, ['--test', 'tests/qa/production-smoke.mjs'], {
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 1024 * 1024,
    env: { ...process.env, SGQ_QC_FRONTEND_URL: 'https://app-sgq.onrender.com', SGQ_QC_API_URL: 'https://app-sgq-api.onrender.com' },
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) console.error('Smoke:', result.error.code ?? 'erro de execução')
  return result.status === 0 && !result.error
}

async function main() {
  const candidateSha = (process.env.SGQ_CANDIDATE_SHA ?? '').trim()
  const homologationReference = (process.env.SGQ_HOMOLOGATION_REF ?? '').trim()
  const operationalApproved = process.env.SGQ_OPERATIONAL_APPROVED === 'true'
  let mainSha = null, mergedPr = null, prReviews = [], mainChecks = [], prChecks = [], frontendDeploy = null, apiDeploy = null
  const preliminaryErrors = []
  try {
    if (!/^[0-9a-f]{40}$/i.test(candidateSha)) throw new Error('SHA inválido')
    const githubToken = process.env.GITHUB_TOKEN
    const renderToken = process.env.RENDER_API_KEY
    const base = 'https://api.github.com/repos/'+REPO
    const [branch, associated, mainResult] = await Promise.all([
      readJson(base+'/branches/main', githubToken, 'GitHub'),
      readJson(base+'/commits/'+candidateSha+'/pulls', githubToken, 'GitHub'),
      readJson(base+'/commits/'+candidateSha+'/check-runs?per_page=100', githubToken, 'GitHub'),
    ])
    mainSha = branch?.commit?.sha ?? null
    mergedPr = Array.isArray(associated) ? associated.find((p) => p.merged_at && p.merge_commit_sha === candidateSha) : null
    mainChecks = mainResult?.check_runs ?? []
    if (mergedPr?.head?.sha) {
      const [prResult, reviews] = await Promise.all([
        readJson(base+'/commits/'+mergedPr.head.sha+'/check-runs?per_page=100', githubToken, 'GitHub'),
        readJson(base+'/pulls/'+mergedPr.number+'/reviews?per_page=100', githubToken, 'GitHub'),
      ])
      prChecks = prResult?.check_runs ?? []
      prReviews = reviews
    }
    const renderBase = 'https://api.render.com/v1/services'
    const [front, api] = await Promise.all([
      readJson(renderBase+'/'+FRONT_ID+'/deploys?limit=20', renderToken, 'Render'),
      readJson(renderBase+'/'+API_ID+'/deploys?limit=20', renderToken, 'Render'),
    ])
    frontendDeploy = liveDeploy(front)
    apiDeploy = liveDeploy(api)
  } catch (e) {
    preliminaryErrors.push('Consulta não concluída: '+(e instanceof Error ? e.message : 'erro desconhecido'))
  }
  // Always run public smoke, even when prior evidence is missing, so no failure is hidden.
  const smokePassed = smoke()
  const verdict = assessRelease({ candidateSha, mainSha, mergedPr, prReviews, mainChecks, prChecks, frontendDeploy, apiDeploy, smokePassed, operationalApproved, homologationReference })
  verdict.blockers.unshift(...preliminaryErrors)
  if (preliminaryErrors.length) verdict.decision = 'NO-GO'
  const output = JSON.stringify(verdict, null, 2)+'\n'
  writeFileSync('sgq-release-evidence.json', output)
  console.log(output)
  if (process.env.GITHUB_STEP_SUMMARY) {
    const summary = '## SGQ — '+verdict.decision+'\n\nSHA: '+verdict.candidateSha+' · PR: #'+(verdict.prNumber ?? '?')+'\n\nBloqueios: '+(verdict.blockers.length ? verdict.blockers.join('; ') : 'nenhum na verificação automática')+'\n\n**Atenção:** referência de homologação é um atestado manual, não comprovação independente.\n'
    const { appendFileSync } = await import('node:fs')
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary)
  }
  if (verdict.decision === 'NO-GO') process.exitCode = 1
}

if (process.argv[1] && import.meta.url === new URL('file://'+process.argv[1]).href) {
  main().catch((e) => { console.error('Gate não concluído:', e.message); process.exitCode = 1 })
}
