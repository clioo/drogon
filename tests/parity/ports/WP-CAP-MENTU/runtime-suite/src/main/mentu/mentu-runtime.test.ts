import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { ProcessResult, ProcessSpec } from '../../shared/child-process/run-process'
import type { WslResult, WslSpec } from '../wsl/wsl-runner'
import { MentuRuntime } from './mentu-runtime'
import { resolvePinnedMentuExecutable } from './mentu-runtime-identity'

const tempRoots: string[] = []

async function workspace(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'drogon-mentu-'))
  tempRoots.push(root)
  await mkdir(path.join(root, '.mentu', 'recipes'), { recursive: true })
  return root
}

function exited(stdout = '', stderr = '', code = 0): ProcessResult {
  return { code, signal: null, stdout, stderr, timedOut: false }
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('Mentu host runtime', () => {
  it('probes the installed CLI and returns version plus adapter capabilities', async () => {
    const calls: ProcessSpec[] = []
    const runtime = new MentuRuntime({
      runProcess: async (spec) => {
        calls.push(spec)
        if (spec.args?.[0] === '--version') {
          return exited('mentu-recipes 0.3.0\n')
        }
        return exited(
          JSON.stringify([
            {
              name: 'shell',
              execution_kind: 'shell',
              completion_policy: 'shell_exit_code',
              requires_credential: false,
              supports_structured_completion: false,
              future: 'retained'
            }
          ])
        )
      }
    })
    const root = await workspace()
    const capability = await runtime.detectCapability({ workspacePath: root })
    expect(capability).toMatchObject({
      status: 'available',
      version: '0.3.0',
      installation: 'explicit-user-action',
      networkInstallation: false
    })
    expect(capability.capabilities[0]?.raw.future).toBe('retained')
    expect(capability.capabilities[0]).toMatchObject({
      execution_kind: 'shell',
      completion_policy: 'shell_exit_code',
      requires_credential: false,
      supports_structured_completion: false
    })
    expect(calls.map((call) => [call.program, call.args])).toEqual([
      [resolvePinnedMentuExecutable(), ['--version']],
      [resolvePinnedMentuExecutable(), ['adapters', '--json']]
    ])
  })

  it('reports a missing executable as unavailable without attempting installation', async () => {
    const error = Object.assign(new Error('not found'), { code: 'ENOENT' })
    const runtime = new MentuRuntime({
      runProcess: async () => {
        throw error
      }
    })
    const capability = await runtime.detectCapability({ workspacePath: await workspace() })
    expect(capability).toMatchObject({
      status: 'unavailable',
      reason: 'not-installed',
      installation: 'explicit-user-action',
      networkInstallation: false
    })
  })

  it('discovers JSON recipes recursively under .mentu/recipes', async () => {
    const root = await workspace()
    const outside = await workspace()
    const recipeRoot = path.join(root, '.mentu', 'recipes')
    await writeFile(
      path.join(recipeRoot, 'valid.json'),
      JSON.stringify({ name: 'valid', steps: [{ label: 'one', prompt: 'one' }] })
    )
    await writeFile(path.join(recipeRoot, 'broken.json'), '{ broken')
    await writeFile(path.join(recipeRoot, 'orca-vm.yaml'), 'name: unrelated-orca-recipe')
    await mkdir(path.join(recipeRoot, 'nested'))
    await writeFile(
      path.join(recipeRoot, 'nested', 'hidden.json'),
      JSON.stringify({ name: 'hidden', steps: [{ label: 'one', prompt: 'one' }] })
    )
    const outsideRecipe = path.join(outside, '.mentu', 'recipes', 'outside.json')
    await writeFile(
      outsideRecipe,
      JSON.stringify({ name: 'outside', steps: [{ label: 'one', prompt: 'one' }] })
    )
    await symlink(outsideRecipe, path.join(recipeRoot, 'escape.json'))

    const catalog = await new MentuRuntime().discoverRecipes({
      workspacePath: root,
      workspaceKind: 'folder'
    })
    expect(catalog.status).toBe('available')
    expect(catalog.entries.map((entry) => path.basename(entry.path))).toEqual([
      'broken.json',
      'hidden.json',
      'valid.json'
    ])
    expect(catalog.entries.find((entry) => entry.name === 'valid')?.status).toBe('valid')
  })

  it('atomically saves an edited recipe while preserving unknown fields', async () => {
    const root = await workspace()
    const recipePath = path.join(root, '.mentu', 'recipes', 'demo.json')
    const source = `${JSON.stringify({
      name: 'demo',
      future_root: { keep: true },
      steps: [{ label: 'build', prompt: 'Build', future_step: ['keep'] }]
    })}\n`
    await writeFile(recipePath, source)
    const runtime = new MentuRuntime()
    const loaded = await runtime.loadRecipe({ workspacePath: root }, 'demo')
    expect(loaded.status).toBe('valid')
    if (loaded.status !== 'valid') {
      return
    }
    expect(loaded.document.source).toBe(source)
    loaded.document.recipe.steps![0] = {
      ...loaded.document.recipe.steps![0]!,
      backend: 'codex'
    }

    const saved = await runtime.saveRecipe({
      recipe: 'demo',
      workspace: { workspacePath: root },
      document: loaded.document,
      expectedSource: source
    })
    expect(saved.status).toBe('saved')
    expect(JSON.parse(await readFile(recipePath, 'utf8'))).toMatchObject({
      future_root: { keep: true },
      steps: [{ backend: 'codex', future_step: ['keep'] }]
    })
  })

  it('rejects stale or cyclic recipe edits without overwriting the source', async () => {
    const root = await workspace()
    const recipePath = path.join(root, '.mentu', 'recipes', 'demo.json')
    const source = `${JSON.stringify({
      name: 'demo',
      steps: [
        { label: 'build', prompt: 'Build' },
        { label: 'test', prompt: 'Test', depends_on: ['build'] }
      ]
    })}\n`
    await writeFile(recipePath, source)
    const runtime = new MentuRuntime()
    const loaded = await runtime.loadRecipe({ workspacePath: root }, 'demo')
    if (loaded.status !== 'valid') {
      throw new Error('fixture did not load')
    }
    loaded.document.recipe.steps![0] = {
      ...loaded.document.recipe.steps![0]!,
      depends_on: ['test']
    }
    const invalid = await runtime.saveRecipe({
      recipe: 'demo',
      workspace: { workspacePath: root },
      document: loaded.document,
      expectedSource: source
    })
    expect(invalid.status).toBe('invalid')
    expect(await readFile(recipePath, 'utf8')).toBe(source)

    const externalSource = source.replace('"demo"', '"changed-elsewhere"')
    await writeFile(recipePath, externalSource)
    loaded.document.recipe.steps![0] = {
      ...loaded.document.recipe.steps![0]!,
      depends_on: undefined
    }
    const conflict = await runtime.saveRecipe({
      recipe: 'demo',
      workspace: { workspacePath: root },
      document: loaded.document,
      expectedSource: source
    })
    expect(conflict.status).toBe('conflict')
    expect(await readFile(recipePath, 'utf8')).toBe(externalSource)
  })

  it('rejects a malformed save payload at the runtime boundary', async () => {
    const root = await workspace()
    const result = await new MentuRuntime().saveRecipe({
      recipe: 'demo',
      workspace: { workspacePath: root },
      document: null,
      expectedSource: ''
    } as never)

    expect(result).toMatchObject({ status: 'invalid' })
  })

  it('reads run records, events, state, output references, and quarantine evidence', async () => {
    const root = await workspace()
    const runDir = path.join(root, '.mentu', 'runs', 'run_20260904_ABC')
    await mkdir(path.join(runDir, 'quarantine'), { recursive: true })
    await writeFile(
      path.join(runDir, 'run.json'),
      JSON.stringify({
        run_id: 'run_20260904_ABC',
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
            attempts: 1,
            output_file: 'build.stdout',
            error_file: 'build.stderr',
            hooks: [
              {
                event: 'after_step',
                command: 'echo done',
                exit_code: 0,
                output_file: 'hook-after-step.stdout',
                error_file: 'hook-after-step.stderr'
              }
            ],
            git: { quarantine_files: ['quarantine/undeclared.patch'] },
            future_step_field: 'retained'
          }
        ],
        hooks: [],
        events_file: 'events.jsonl',
        state_file: 'state.json',
        baseline_file: 'baseline.json',
        future_run_field: { retained: true }
      })
    )
    await writeFile(
      path.join(runDir, 'events.jsonl'),
      `${JSON.stringify({ id: 'evt_1', run_id: 'run_20260904_ABC', sequence: 1, timestamp: '2026-09-04T00:00:00Z', kind: 'run_started', recipe_name: 'demo', future_event_field: 'retained' })}\nnot-json\n`
    )
    await writeFile(
      path.join(runDir, 'state.json'),
      JSON.stringify({
        run_id: 'run_20260904_ABC',
        recipe_name: 'demo',
        recipe_ref: 'demo.json',
        started_at: '2026-09-04T00:00:00Z',
        updated_at: '2026-09-04T00:00:01Z',
        vars: {},
        steps: {
          build: {
            label: 'build',
            state: 'running',
            attempts: 1,
            updated_at: '2026-09-04T00:00:01Z'
          }
        }
      })
    )
    await writeFile(path.join(runDir, 'baseline.json'), JSON.stringify({ files: [] }))
    await writeFile(path.join(runDir, 'build.stdout'), 'stdout evidence')
    await writeFile(path.join(runDir, 'build.stderr'), 'stderr evidence')
    await writeFile(path.join(runDir, 'hook-after-step.stdout'), 'hook stdout')
    await writeFile(path.join(runDir, 'hook-after-step.stderr'), 'hook stderr')
    await writeFile(path.join(runDir, 'quarantine', 'undeclared.patch'), 'patch evidence')

    const evidence = await new MentuRuntime().readRun({
      runId: 'run_20260904_ABC',
      workspace: { workspacePath: root }
    })
    expect(evidence).toMatchObject({
      status: 'running',
      evidence: { kind: 'local-run-evidence', formalCommitmentProtocol: false },
      commitmentProtocol: { kind: 'not-present' }
    })
    if (!('evidence' in evidence)) {
      return
    }
    expect(evidence.events).toHaveLength(1)
    expect(evidence.invalidEventLines).toEqual(['not-json'])
    expect(evidence.outputs.build?.stdout.content).toBe('stdout evidence')
    expect(evidence.outputs.build?.stderr.content).toBe('stderr evidence')
    expect(evidence.hookOutputs).toMatchObject([
      {
        scope: 'step',
        stepLabel: 'build',
        event: 'after_step',
        index: 0,
        stdout: { content: 'hook stdout' },
        stderr: { content: 'hook stderr' }
      }
    ])
    expect(evidence.quarantine[0]).toMatchObject({
      relativePath: path.join('quarantine', 'undeclared.patch'),
      content: 'patch evidence'
    })
    expect(evidence.quarantineMetadata).toEqual([
      {
        stepLabel: 'build',
        files: ['quarantine/undeclared.patch'],
        raw: { quarantine_files: ['quarantine/undeclared.patch'] }
      }
    ])
    expect(evidence.run.raw.future_run_field).toEqual({ retained: true })
    expect(evidence.events[0]?.raw.future_event_field).toBe('retained')
  })

  it('refuses output and quarantine symlinks that escape the run directory', async () => {
    const root = await workspace()
    const outside = await workspace()
    const runDir = path.join(root, '.mentu', 'runs', 'run_20260904_ESCAPE')
    await mkdir(runDir, { recursive: true })
    const secret = path.join(outside, 'secret.txt')
    await writeFile(secret, 'must not be exposed')
    await symlink(secret, path.join(runDir, 'leak.stdout'))
    await symlink(outside, path.join(runDir, 'quarantine'))
    await writeFile(
      path.join(runDir, 'run.json'),
      JSON.stringify({
        run_id: 'run_20260904_ESCAPE',
        recipe_name: 'demo',
        started_at: '2026-09-04T00:00:00Z',
        outcome: 'failed',
        cloud_mode: 'local-only',
        steps: [
          {
            label: 'build',
            backend: 'shell',
            exit_code: 1,
            local_complete: false,
            duration_seconds: 1,
            attempts: 1,
            output_file: 'leak.stdout',
            error_file: 'missing.stderr'
          }
        ],
        hooks: []
      })
    )

    const evidence = await new MentuRuntime().readRun({
      runId: 'run_20260904_ESCAPE',
      workspace: { workspacePath: root }
    })
    expect(evidence.status).toBe('failed')
    if (!('evidence' in evidence)) {
      return
    }
    expect(evidence.outputs.build?.stdout).toMatchObject({
      content: null,
      error: 'reference_outside_run_directory'
    })
    expect(evidence.quarantine).toEqual([])
  })

  it('rejects a run record that does not satisfy the public required fields', async () => {
    const root = await workspace()
    const runId = 'run_20260904_INVALID'
    const runDir = path.join(root, '.mentu', 'runs', runId)
    await mkdir(runDir, { recursive: true })
    await writeFile(
      path.join(runDir, 'run.json'),
      JSON.stringify({
        run_id: runId,
        recipe_name: 'demo',
        started_at: '2026-09-04T00:00:00Z',
        outcome: 'failed',
        cloud_mode: 'local-only',
        steps: [{ label: 'missing-required-fields' }],
        hooks: []
      })
    )

    await expect(
      new MentuRuntime().readRun({ runId, workspace: { workspacePath: root } })
    ).resolves.toMatchObject({
      status: 'invalid',
      hostObservation: 'live',
      message: 'run.json does not match the Mentu run record schema.'
    })
  })

  it('uses argv-only operations and never runs an SSH-owned workspace locally', async () => {
    const root = await workspace()
    await writeFile(
      path.join(root, '.mentu', 'recipes', 'demo.json'),
      JSON.stringify({ name: 'demo', steps: [{ label: 'build', prompt: 'Build' }] })
    )
    const calls: ProcessSpec[] = []
    const runtime = new MentuRuntime({
      runProcess: async (spec) => {
        calls.push(spec)
        return exited(
          spec.args?.[0] === 'doctor'
            ? JSON.stringify({ recipe_name: 'demo', score: 90, findings: [] })
            : 'ok'
        )
      }
    })
    await runtime.check({ recipe: 'demo', workspace: { workspacePath: root } })
    await runtime.doctor({ recipe: 'demo', workspace: { workspacePath: root }, strict: true })
    const directRun = await runtime.run({
      recipe: 'demo',
      workspace: { workspacePath: root },
      vars: { MESSAGE: 'hello; do not interpret' }
    })
    const directResume = await runtime.resume({
      runId: 'run_20260904_ABC',
      workspace: { workspacePath: root }
    })
    const directRetry = await runtime.retryStep({
      runId: 'run_20260904_ABC',
      stepLabel: 'build',
      workspace: { workspacePath: root }
    })
    expect([directRun, directResume, directRetry]).toMatchObject([
      { status: 'invalid', admission: { kind: 'legacy-bypass-refused' } },
      { status: 'invalid', admission: { kind: 'legacy-bypass-refused' } },
      { status: 'invalid', admission: { kind: 'legacy-bypass-refused' } }
    ])
    expect(calls.every((call) => call.program === resolvePinnedMentuExecutable())).toBe(true)
    expect(calls.some((call) => call.args?.includes('MESSAGE=hello; do not interpret'))).toBe(false)
    expect(
      calls.every((call) => call.args?.every((argument) => typeof argument === 'string'))
    ).toBe(true)

    const sshResult = await runtime.run({
      recipe: 'demo',
      workspace: { workspacePath: root, executionHostId: 'ssh:remote-host' }
    })
    expect(sshResult).toMatchObject({
      status: 'unavailable',
      hostObservation: 'unverifiable',
      owner: { transport: 'ssh', remoteTarget: 'remote-host' }
    })
    const pairedResult = await runtime.run({
      recipe: 'demo',
      workspace: { workspacePath: root, executionHostId: 'runtime:paired-host' }
    })
    expect(pairedResult).toMatchObject({
      status: 'unavailable',
      hostObservation: 'unverifiable',
      owner: { transport: 'paired-runtime', runtimeEnvironmentId: 'paired-host' }
    })
    expect(calls).toHaveLength(2)
  })

  it('preserves a failed CLI exit as failed evidence', async () => {
    const root = await workspace()
    await writeFile(
      path.join(root, '.mentu', 'recipes', 'demo.json'),
      JSON.stringify({ name: 'demo', steps: [{ label: 'build', prompt: 'Build' }] })
    )
    const runtime = new MentuRuntime({ runProcess: async () => exited('', 'recipe failed', 2) })
    await expect(
      runtime.check({ recipe: 'demo', workspace: { workspacePath: root } })
    ).resolves.toMatchObject({ status: 'failed', hostObservation: 'exited', exitCode: 2 })
  })

  it('routes WSL through the existing WSL runner contract with guest paths', async () => {
    const root = await workspace()
    await writeFile(
      path.join(root, '.mentu', 'recipes', 'demo.json'),
      JSON.stringify({ name: 'demo', steps: [{ label: 'build', prompt: 'Build' }] })
    )
    const calls: WslSpec[] = []
    const runtime = new MentuRuntime({
      runWslProcess: async (spec) => {
        calls.push(spec)
        return {
          environmentResolved: true,
          code: 0,
          stdout: 'ok',
          stderr: '',
          timedOut: false
        } satisfies WslResult
      }
    })
    await runtime.check({
      recipe: 'demo',
      workspace: {
        workspacePath: root,
        wsl: { distro: 'Ubuntu', guestWorkspacePath: '/workspace' }
      }
    })
    await runtime.run({
      recipe: 'demo',
      workspace: {
        workspacePath: root,
        wsl: { distro: 'Ubuntu', guestWorkspacePath: '/workspace' }
      }
    })
    await runtime.resume({
      runId: 'run_20260904_ABC',
      workspace: {
        workspacePath: root,
        wsl: { distro: 'Ubuntu', guestWorkspacePath: '/workspace' }
      }
    })
    expect(calls[0]).toMatchObject({
      program: resolvePinnedMentuExecutable(),
      cwd: '/workspace',
      distro: 'Ubuntu',
      loginPath: 'preferred'
    })
    expect(calls.map((call) => call.args)).toEqual([
      ['check', '/workspace/.mentu/recipes/demo.json']
    ])
    expect(calls).toHaveLength(1)
  })
})
