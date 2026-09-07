import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProcessResult, ProcessSpec } from '../../shared/child-process/run-process'
import type {
  MentuExecutableIdentity,
  MentuRunnerIdentity,
  MentuSessionExecutionRequest
} from '../../shared/mentu-session-approval'
import { MentuRuntime } from './mentu-runtime'

const roots: string[] = []

async function workspace(): Promise<string> {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), 'mentu-session-execution-')))
  roots.push(root)
  await mkdir(path.join(root, '.mentu', 'recipes'), { recursive: true })
  return root
}

function exited(stdout = '', stderr = '', code: number | null = 0): ProcessResult {
  return { code, signal: null, stdout, stderr, timedOut: false }
}

const runner: MentuRunnerIdentity = {
  path: '/app/mentu-recipes',
  version: '0.4.0',
  sha256: 'runner-sha',
  revision: 'fixture-runner-revision',
  lockSha256: 'lock-sha'
}
const pi: MentuExecutableIdentity = {
  path: '/app/pi',
  version: '0.84.1',
  sha256: 'pi-sha'
}

function request(
  root: string,
  overrides: Partial<MentuSessionExecutionRequest> = {}
): MentuSessionExecutionRequest {
  return {
    sessionId: 'session-1',
    intent: 'run',
    workspace: { workspacePath: root, workspaceKind: 'folder', workspaceKey: `folder:${root}` },
    recipe: 'demo',
    ...overrides
  }
}

async function writeRecipe(root: string, source: unknown, name = 'demo'): Promise<void> {
  await writeFile(path.join(root, '.mentu', 'recipes', `${name}.json`), JSON.stringify(source))
}

function harness(
  options: {
    calls?: ProcessSpec[]
    checkCode?: number
    check?: (spec: ProcessSpec) => Promise<ProcessResult>
    run?: (spec: ProcessSpec) => Promise<ProcessResult> | ProcessResult
  } = {}
) {
  const calls = options.calls ?? []
  const runProcess = async (spec: ProcessSpec): Promise<ProcessResult> => {
    calls.push(spec)
    if (spec.args?.[0] === '--version') {
      return exited('mentu-recipes 0.4.0\n')
    }
    if (spec.args?.[0] === 'adapters') {
      return exited(JSON.stringify([{ name: 'shell', available: true, raw: true }]))
    }
    if (spec.args?.[0] === 'check') {
      return options.check ? options.check(spec) : exited('', '', options.checkCode ?? 0)
    }
    if (spec.args?.[0] === 'doctor') {
      return exited(JSON.stringify({ recipe_name: 'demo', findings: [] }))
    }
    if (spec.args?.[0] === 'plan') {
      return exited(
        JSON.stringify({
          recipe: 'demo',
          version: 1,
          source: spec.args?.[1],
          children: [],
          digest: 'plan-digest',
          steps: [{ label: 'build', backend: 'shell' }]
        })
      )
    }
    if (options.run) {
      return options.run(spec)
    }
    return exited('run_20260904_EXEC')
  }
  return { calls, runProcess }
}

function makeRuntime(
  options: {
    calls?: ProcessSpec[]
    checkCode?: number
    check?: (spec: ProcessSpec) => Promise<ProcessResult>
    run?: (spec: ProcessSpec) => Promise<ProcessResult> | ProcessResult
  } = {}
) {
  const mocked = harness(options)
  return {
    calls: mocked.calls,
    runtime: new MentuRuntime({
      command: '/app/mentu-recipes',
      runnerIdentity: async () => runner,
      piIdentity: async () => pi,
      runProcess: mocked.runProcess
    })
  }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Mentu session execution admission', () => {
  it('requires admission and refuses the old direct run entrypoint', async () => {
    const root = await workspace()
    await writeRecipe(root, { name: 'demo', steps: [{ label: 'build', prompt: 'Build' }] })
    const { runtime, calls } = makeRuntime()
    const result = await runtime.run({ recipe: 'demo', workspace: { workspacePath: root } })
    expect(result.status).toBe('invalid')
    expect(result.stderr).toContain('review and approve')
    expect(calls).toHaveLength(0)
  })

  it('runs hard checks before approval and surfaces blocking findings', async () => {
    const root = await workspace()
    await writeRecipe(root, { name: 'demo', steps: [{ label: 'build', prompt: 'Build' }] })
    const { runtime, calls } = makeRuntime({ checkCode: 2 })
    const result = await runtime.reviewSession(request(root))
    expect(result.status).toBe('invalid')
    expect(result.review?.scope.checks.check.status).toBe('failed')
    expect(result.review?.scope.findings.map((finding) => finding.code)).toContain('check-failed')
    expect(calls.map((call) => call.args?.[0])).toEqual([
      '--version',
      'adapters',
      'check',
      'doctor',
      'plan'
    ])
    if (result.review) {
      await expect(runtime.approveSession(result.review.reviewId)).resolves.toMatchObject({
        status: 'invalid'
      })
    }
  })

  it('binds nested effective provider routing and rejects changed child inputs', async () => {
    const root = await workspace()
    await writeRecipe(root, {
      name: 'demo',
      type: 'compound',
      steps: [],
      recipes: [{ label: 'child', recipe: 'child', vars: { TARGET: 'one' } }]
    })
    await writeRecipe(
      root,
      {
        name: 'child',
        backend: 'codex',
        model: 'gpt-5',
        steps: [{ label: 'build', backend: 'codex', model: 'gpt-5', prompt: 'Build' }]
      },
      'child'
    )
    const calls: ProcessSpec[] = []
    const mocked = harness({ calls })
    mocked.runProcess = async (spec) => {
      calls.push(spec)
      if (spec.args?.[0] === '--version') {
        return exited('mentu-recipes 0.4.0\n')
      }
      if (spec.args?.[0] === 'adapters') {
        return exited(JSON.stringify([{ name: 'codex', available: true }]))
      }
      if (spec.args?.[0] === 'check') {
        return exited()
      }
      if (spec.args?.[0] === 'doctor') {
        return exited(JSON.stringify({ recipe_name: 'demo', findings: [] }))
      }
      if (spec.args?.[0] === 'plan') {
        return exited(
          JSON.stringify({
            digest: 'nested-plan',
            version: 1,
            source: path.join(root, '.mentu', 'recipes', 'demo.json'),
            steps: [],
            children: [
              {
                version: 1,
                digest: 'child-plan',
                source: path.join(root, '.mentu', 'recipes', 'child.json'),
                children: [],
                steps: [{ label: 'build', backend: 'codex', model: 'gpt-5' }]
              }
            ]
          })
        )
      }
      return exited('run_20260904_NESTED')
    }
    const instance = new MentuRuntime({
      command: '/app/mentu-recipes',
      runnerIdentity: async () => runner,
      piIdentity: async () => pi,
      runProcess: mocked.runProcess
    })
    const reviewed = await instance.reviewSession(request(root))
    expect(reviewed.status).toBe('ready')
    expect(reviewed.review?.scope.effectiveSteps).toEqual([
      { label: 'child.build', backend: 'codex', adapter: 'codex', model: 'gpt-5' }
    ])
    expect(reviewed.review?.scope.recipe.inputs.map((input) => path.basename(input.path))).toEqual([
      'child.json',
      'child.json#prompt:build',
      'demo.json'
    ])
    if (!reviewed.review) {
      return
    }
    await writeFile(
      path.join(root, '.mentu', 'recipes', 'child.json'),
      JSON.stringify({
        name: 'child',
        backend: 'codex',
        model: 'gpt-5',
        steps: [{ label: 'build', backend: 'codex', model: 'gpt-5', prompt: 'Changed' }]
      })
    )
    const approved = await instance.approveSession(reviewed.review.reviewId)
    expect(approved.status).toBe('approved')
    if (approved.status === 'approved') {
      await expect(instance.executeSession(approved.approval.approvalId)).resolves.toMatchObject({
        status: 'invalid',
        admission: { kind: 'plan-changed' }
      })
    }
    expect(calls.filter((call) => call.args?.[0] === 'run')).toHaveLength(0)
  })

  it('coalesces simultaneous surfaces and uses one real request key', async () => {
    const root = await workspace()
    await writeRecipe(root, { name: 'demo', steps: [{ label: 'build', prompt: 'Build' }] })
    const { runtime, calls } = makeRuntime()
    const [first, second] = await Promise.all([
      runtime.reviewSession(request(root)),
      runtime.reviewSession(request(root))
    ])
    expect(first.status).toBe('ready')
    expect(second.status).toBe('ready')
    expect(first.review?.reviewId).toBe(second.review?.reviewId)
    expect(calls.filter((call) => call.args?.[0] === 'plan')).toHaveLength(1)
    if (!first.review) {
      return
    }
    const [approvedA, approvedB] = await Promise.all([
      runtime.approveSession(first.review.reviewId),
      runtime.approveSession(second.review!.reviewId)
    ])
    expect(approvedA).toMatchObject({ status: 'approved' })
    expect(approvedB).toMatchObject({ status: 'approved' })
    if (approvedA.status !== 'approved' || approvedB.status !== 'approved') {
      return
    }
    const [a, b] = await Promise.all([
      runtime.executeSession(approvedA.approval.approvalId),
      runtime.executeSession(approvedB.approval.approvalId)
    ])
    expect(a).toEqual(b)
    expect(calls.filter((call) => call.args?.[0] === 'run')).toHaveLength(1)
    expect(calls.find((call) => call.args?.[0] === 'run')?.args).toContain('--plan-digest')
    expect(calls.find((call) => call.args?.[0] === 'run')?.args).toContain(
      first.review.scope.requestKey
    )
  })

  it('refreshes a completed review after an edit without requiring a failed launch', async () => {
    const root = await workspace()
    await writeRecipe(root, { name: 'demo', steps: [{ label: 'build', prompt: 'Build' }] })
    const { runtime } = makeRuntime()
    const first = await runtime.reviewSession(request(root))
    expect(first.status).toBe('ready')
    await writeRecipe(root, { name: 'demo', steps: [{ label: 'build', prompt: 'New scope' }] })
    const second = await runtime.reviewSession(request(root))
    expect(second.status).toBe('ready')
    expect(second.review?.scope.recipe.treeDigest).not.toBe(first.review?.scope.recipe.treeDigest)
  })

  it.each([1, null])(
    'keeps process failure %s even when an older run record succeeded',
    async (code) => {
      const root = await workspace()
      const runId = 'run_20260904_PREVIOUS'
      await writeRecipe(root, { name: 'demo', steps: [{ label: 'build', prompt: 'Build' }] })
      const runDir = path.join(root, '.mentu', 'runs', runId)
      await mkdir(runDir, { recursive: true })
      await writeFile(
        path.join(runDir, 'run.json'),
        JSON.stringify({
          run_id: runId,
          recipe_name: 'demo',
          started_at: '2026-09-04T00:00:00Z',
          ended_at: '2026-09-04T00:00:01Z',
          outcome: 'ok',
          cloud_mode: 'local-only',
          steps: [
            {
              label: 'build',
              backend: 'shell',
              exit_code: 0,
              local_complete: true,
              duration_seconds: 1,
              attempts: 1,
              output_file: 'build.stdout',
              error_file: 'build.stderr'
            }
          ],
          hooks: []
        })
      )
      const { runtime } = makeRuntime({
        run: () => exited(runId, 'Current invocation failed', code)
      })
      const reviewed = await runtime.reviewSession(request(root))
      if (reviewed.status !== 'ready') {
        throw new Error(JSON.stringify(reviewed))
      }
      const approved = await runtime.approveSession(reviewed.review.reviewId)
      if (approved.status !== 'approved') {
        throw new Error(JSON.stringify(approved))
      }
      const result = await runtime.executeSession(approved.approval.approvalId)
      expect(result.run?.status).toBe('successful')
      expect(result.status).toBe(code === null ? 'unavailable' : 'failed')
    }
  )

  it('keeps a known process failure when the current run evidence is missing', async () => {
    const root = await workspace()
    const runId = 'run_20260904_MISSING'
    await writeRecipe(root, { name: 'demo', steps: [{ label: 'build', prompt: 'Build' }] })
    const { runtime } = makeRuntime({ run: () => exited(runId, 'Current invocation failed', 2) })
    const reviewed = await runtime.reviewSession(request(root))
    if (reviewed.status !== 'ready') {
      throw new Error(JSON.stringify(reviewed))
    }
    const approved = await runtime.approveSession(reviewed.review.reviewId)
    if (approved.status !== 'approved') {
      throw new Error(JSON.stringify(approved))
    }

    const result = await runtime.executeSession(approved.approval.approvalId)

    expect(result).toMatchObject({
      status: 'failed',
      hostObservation: 'exited',
      exitCode: 2
    })
    expect(result.run).toBeUndefined()
    expect(result.stderr).toContain('Run evidence unavailable')
  })

  it('refuses substitutions on recovery because the pinned CLI cannot apply new ones', async () => {
    const root = await workspace()
    await writeRecipe(root, { name: 'demo', steps: [{ label: 'build', prompt: 'Build' }] })
    const { runtime, calls } = makeRuntime()

    const result = await runtime.reviewSession(
      request(root, { intent: 'resume', runId: 'run_20260904_RECOVER', vars: { TARGET: 'new' } })
    )

    expect(result).toMatchObject({
      status: 'invalid',
      message: 'Recovery does not accept new substitutions; start a new reviewed run.'
    })
    expect(calls).toHaveLength(0)
  })

  it('cancels revalidation before starting a worker or remaining checks', async () => {
    const root = await workspace()
    await writeRecipe(root, { name: 'demo', steps: [{ label: 'build', prompt: 'Build' }] })
    let validating = false
    let started: (() => void) | undefined
    const checkStarted = new Promise<void>((resolve) => {
      started = resolve
    })
    const { runtime, calls } = makeRuntime({
      check: async (spec) => {
        if (!validating) {
          return exited()
        }
        started?.()
        return new Promise((resolve) => {
          if (spec.signal?.aborted) {
            resolve(exited('', '', null))
            return
          }
          spec.signal?.addEventListener('abort', () => resolve(exited('', '', null)), {
            once: true
          })
        })
      }
    })
    const reviewed = await runtime.reviewSession(request(root))
    if (reviewed.status !== 'ready') {
      throw new Error(JSON.stringify(reviewed))
    }
    const approved = await runtime.approveSession(reviewed.review.reviewId)
    if (approved.status !== 'approved') {
      throw new Error(JSON.stringify(approved))
    }
    validating = true
    const pending = runtime.executeSession(approved.approval.approvalId)
    await checkStarted
    expect(runtime.cancelSession(approved.approval.approvalId).status).toBe('cancelled')
    expect((await pending).status).toBe('unavailable')
    expect(calls.filter((call) => call.args?.[0] === 'doctor')).toHaveLength(1)
    expect(calls.some((call) => call.args?.[0] === 'run')).toBe(false)
    expect(runtime.cancelSession(approved.approval.approvalId).status).toBe('not-running')
  })

  it('reviews and executes recovery only for the host-owned run target', async () => {
    const root = await workspace()
    const runId = 'run_20260904_RECOVER'
    await writeRecipe(root, { name: 'demo', steps: [{ label: 'build', prompt: 'Build' }] })
    const runDir = path.join(root, '.mentu', 'runs', runId)
    await mkdir(runDir, { recursive: true })
    await writeFile(
      path.join(runDir, 'run.json'),
      JSON.stringify({
        run_id: runId,
        recipe_name: 'demo',
        recipe_ref: 'demo.json',
        started_at: '2026-09-04T00:00:00Z',
        outcome: 'running',
        cloud_mode: 'local-only',
        steps: [
          {
            label: 'build',
            backend: 'shell',
            exit_code: 0,
            local_complete: true,
            duration_seconds: 1,
            attempts: 1,
            output_file: 'build.stdout',
            error_file: 'build.stderr'
          }
        ],
        hooks: []
      })
    )
    const { runtime, calls } = makeRuntime({ run: () => exited('', '', 0) })
    const reviewed = await runtime.reviewSession(request(root, { intent: 'resume', runId }))
    expect(reviewed.status).toBe('ready')
    expect(reviewed.review?.scope.recoveryEvidenceDigest).toBeTruthy()
    if (!reviewed.review) {
      return
    }
    const approved = await runtime.approveSession(reviewed.review.reviewId)
    if (approved.status !== 'approved') {
      throw new Error('recovery approval unexpectedly blocked')
    }
    const result = await runtime.executeSession(approved.approval.approvalId)
    expect(result.run?.run.value.run_id).toBe(runId)
    expect(calls.find((call) => call.args?.[0] === 'resume')?.args).toEqual([
      'resume',
      runId,
      '--workspace',
      root,
      '--plan-digest',
      reviewed.review.scope.planDigest,
      '--request-key',
      reviewed.review.scope.requestKey
    ])
  })

  it('cancels a local process through the bounded child-process signal contract', async () => {
    const root = await workspace()
    await writeRecipe(root, { name: 'demo', steps: [{ label: 'build', prompt: 'Build' }] })
    let resolveRun: ((result: ProcessResult) => void) | null = null
    const { runtime } = makeRuntime({
      run: (spec) =>
        spec.args?.[0] === 'run'
          ? new Promise<ProcessResult>((resolve) => {
              resolveRun = resolve
              spec.signal?.addEventListener('abort', () => resolve(exited('', '', null)))
            })
          : exited('run_20260904_CANCEL')
    })
    const reviewed = await runtime.reviewSession(request(root))
    if (reviewed.status !== 'ready') {
      throw new Error('review unexpectedly blocked')
    }
    const approved = await runtime.approveSession(reviewed.review.reviewId)
    if (approved.status !== 'approved') {
      throw new Error('approval unexpectedly blocked')
    }
    const resultPromise = runtime.executeSession(approved.approval.approvalId)
    for (let attempt = 0; attempt < 20 && resolveRun === null; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
    const cancel = runtime.cancelSession(approved.approval.approvalId)
    expect(cancel.status).toBe('cancelled')
    const result = await resultPromise
    expect(result.hostObservation).toBe('unverifiable')
    expect(resolveRun).not.toBeNull()
  })

  it('keeps folder ownership and remote loss unverifiable', async () => {
    const root = await workspace()
    await writeRecipe(root, { name: 'demo', steps: [{ label: 'build', prompt: 'Build' }] })
    const { runtime } = makeRuntime()
    const folder = await runtime.reviewSession(request(root))
    expect(folder.status).toBe('ready')
    expect(folder.review?.scope.owner.workspaceKind).toBe('folder')
    const remote = await runtime.reviewSession(
      request(root, {
        workspace: { workspacePath: root, workspaceKind: 'folder', executionHostId: 'ssh:builder' }
      })
    )
    expect(remote).toMatchObject({ status: 'unavailable', owner: { transport: 'ssh' } })
    expect(remote.status === 'unavailable' ? remote.owner.transport : null).toBe('ssh')
  })

  it('restores terminal evidence from the host after restart', async () => {
    const root = await workspace()
    const runId = 'run_20260904_RESTORED'
    const runDir = path.join(root, '.mentu', 'runs', runId)
    await mkdir(runDir, { recursive: true })
    await writeFile(
      path.join(runDir, 'run.json'),
      JSON.stringify({
        run_id: runId,
        recipe_name: 'demo',
        started_at: '2026-09-04T00:00:00Z',
        outcome: 'running',
        cloud_mode: 'local-only',
        steps: [
          {
            label: 'build',
            backend: 'shell',
            exit_code: 0,
            local_complete: true,
            duration_seconds: 1,
            attempts: 2,
            invocation_count: 1,
            output_file: 'build.stdout',
            error_file: 'build.stderr'
          }
        ],
        hooks: []
      })
    )
    const evidence = await new MentuRuntime().readRun({ runId, workspace: { workspacePath: root } })
    expect(evidence).toMatchObject({ status: 'running', hostObservation: 'live' })
    if ('evidence' in evidence) {
      expect(evidence.run.value.steps[0]).toMatchObject({ attempts: 2, invocation_count: 1 })
    }
    expect(await readFile(path.join(runDir, 'run.json'), 'utf8')).toContain(runId)
  })
})
