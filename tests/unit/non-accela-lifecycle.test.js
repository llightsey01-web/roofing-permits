// tests/unit/non-accela-lifecycle.test.js
// ZIG-13 PR 3: successful runAutomationLifecycle terminalizes to complete
'use strict'

const fs = require('fs')
const path = require('path')
const {
  RUN_STATUS_COMPLETE,
  RUN_STATUS_ERROR,
  RUN_STATUS_RUNNING,
} = require('../../lib/automation/run-status.js')

var mockStore = { updates: [] }

function mockCreateFakeSupabase(targetStore) {
  return {
    from: function (table) {
      return {
        update: function (payload) {
          targetStore.updates.push({ table: table, payload: payload })
          return { eq: function () { return { error: null } } }
        },
        select: function () {
          return {
            eq: function () {
              return {
                eq: function () {
                  return {
                    eq: function () {
                      return {
                        single: async function () {
                          return {
                            data: { username: 'demo', portal_password: 'x' },
                            error: null,
                          }
                        },
                      }
                    },
                    single: async function () {
                      return {
                        data: { username: 'demo', portal_password: 'x' },
                        error: null,
                      }
                    },
                  }
                },
              }
            },
          }
        },
      }
    },
  }
}

jest.mock('playwright', function () {
  return {
    chromium: {
      launch: async function () {
        return {
          newPage: async function () {
            return { setDefaultTimeout: function () {} }
          },
          close: async function () {},
        }
      },
    },
  }
})

jest.mock('../../automation/shared/recovery', function () {
  return {
    logRecoveryStart: jest.fn(async function () {
      return { stepNumber: 0, stepName: null, isResume: false }
    }),
  }
})

jest.mock('../../lib/credentials/secure-credential-service.js', function () {
  return {
    getCredentials: async function () {
      return { username: 'demo', password: 'x' }
    },
  }
})

jest.mock('@supabase/supabase-js', function () {
  return {
    createClient: function () {
      return mockCreateFakeSupabase(mockStore)
    },
  }
})

const {
  runAutomationLifecycle,
  finalizeSuccessfulLifecycleRun,
} = require('../../automation/ahjs/shared/base-runner.js')
const { handleRunError } = require('../../automation/shared/errors.js')
const { runLakeCounty } = require('../../automation/ahjs/lake-county.runner.js')
const lakeConfig = require('../../automation/ahjs/configs/lake-county.config.js')

function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(__dirname, '../..', relativePath), 'utf8')
}

function sliceFunction(src, name) {
  var start = src.indexOf('async function ' + name)
  if (start < 0) start = src.indexOf('function ' + name)
  expect(start).toBeGreaterThan(-1)
  var brace = src.indexOf('{', start)
  var depth = 0
  for (var i = brace; i < src.length; i++) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error('Could not slice function ' + name)
}

var BASE_SRC = readRepoFile('automation/ahjs/shared/base-runner.js')
var ERRORS_SRC = readRepoFile('automation/shared/errors.js')
var WORKER_INDEX_SRC = readRepoFile('worker/index.js')
var WORKER_RUNNER_SRC = readRepoFile('worker/runner.js')
var LAKE_SRC = readRepoFile('automation/ahjs/lake-county.runner.js')
var CITIZENSERVE_SRC = readRepoFile('automation/ahjs/shared/citizenserve-base-runner.js')
var CUSTOM_SRC = readRepoFile('automation/ahjs/shared/custom-base-runner.js')
var ACCELA_BASE_SRC = readRepoFile('automation/ahjs/shared/accela-base-runner.js')
var POLK_SRC = readRepoFile('automation/ahjs/polk-county.runner.js')

function lifecycleConfig() {
  return {
    id: 'lifecycle-fixture',
    name: 'Lifecycle Fixture',
    state: 'FL',
    portalUrl: 'https://example.test/login',
    loginType: 'custom',
    workflowFile: 'custom-base-runner.js',
  }
}

function jobData() {
  return {
    id: 'job-1',
    company_id: 'co-1',
    ahj_id: 'ahj-1',
    owner_name: 'Test Owner',
    property_address: '1 Main St',
  }
}

describe('non-Accela lifecycle success terminalization (ZIG-13 PR 3)', function () {
  beforeEach(function () {
    mockStore.updates = []
  })

  test('finalizeSuccessfulLifecycleRun writes complete and completed_at once', async function () {
    var local = { updates: [] }
    var result = await finalizeSuccessfulLifecycleRun('run-1', mockCreateFakeSupabase(local))
    expect(local.updates).toHaveLength(1)
    expect(local.updates[0].table).toBe('automation_runs')
    expect(local.updates[0].payload.run_status).toBe(RUN_STATUS_COMPLETE)
    expect(local.updates[0].payload.run_status).toBe('complete')
    expect(typeof local.updates[0].payload.completed_at).toBe('string')
    expect(local.updates[0].payload.completed_at.length).toBeGreaterThan(0)
    expect(result.run_status).toBe(RUN_STATUS_COMPLETE)
    expect(result.completed_at).toBe(local.updates[0].payload.completed_at)
  })

  test('successful runAutomationLifecycle writes complete exactly once', async function () {
    var steps = 0
    await runAutomationLifecycle({
      jobData: jobData(),
      runId: 'run-success',
      config: lifecycleConfig(),
      executeSteps: async function () {
        steps += 1
      },
    })
    expect(steps).toBe(1)
    var runUpdates = mockStore.updates.filter(function (row) {
      return row.table === 'automation_runs'
    })
    expect(runUpdates).toHaveLength(1)
    expect(runUpdates[0].payload.run_status).toBe(RUN_STATUS_COMPLETE)
    expect(runUpdates[0].payload.completed_at).toBeTruthy()
  })

  test('failed lifecycle still writes error and does not write complete', async function () {
    await expect(
      runAutomationLifecycle({
        jobData: jobData(),
        runId: 'run-fail',
        config: lifecycleConfig(),
        executeSteps: async function () {
          throw new Error('portal timeout')
        },
      })
    ).rejects.toThrow(/portal timeout/)
    var runUpdates = mockStore.updates.filter(function (row) {
      return row.table === 'automation_runs'
    })
    expect(runUpdates.length).toBeGreaterThanOrEqual(1)
    var statuses = runUpdates.map(function (row) { return row.payload.run_status })
    expect(statuses).toContain(RUN_STATUS_ERROR)
    expect(statuses).not.toContain(RUN_STATUS_COMPLETE)
  })

  test('handleRunError still writes error and needs_correction', async function () {
    await handleRunError('run-err', 'job-1', new Error('captcha failed'))
    expect(mockStore.updates.some(function (row) {
      return row.table === 'automation_runs' && row.payload.run_status === RUN_STATUS_ERROR
    })).toBe(true)
    expect(mockStore.updates.some(function (row) {
      return row.table === 'jobs' && row.payload.job_status === 'needs_correction'
    })).toBe(true)
  })

  test('successful completed run is not eligible for recoverStuckRuns requeue', function () {
    var recoverFn = sliceFunction(WORKER_INDEX_SRC, 'recoverStuckRuns')
    expect(recoverFn).toMatch(/\.eq\('run_status', 'running'\)/)
    expect(recoverFn).toMatch(/run_status:\s*'queued'/)
    function wouldRecover(runStatus) {
      return runStatus === RUN_STATUS_RUNNING
    }
    expect(wouldRecover(RUN_STATUS_COMPLETE)).toBe(false)
    expect(wouldRecover('complete')).toBe(false)
    expect(wouldRecover(RUN_STATUS_ERROR)).toBe(false)
    expect(wouldRecover(RUN_STATUS_RUNNING)).toBe(true)
  })

  test('worker executeRun does not terminalize success after the runner returns', function () {
    var executeRun = sliceFunction(WORKER_RUNNER_SRC, 'executeRun')
    var tryBlock = executeRun.slice(0, executeRun.indexOf('} catch'))
    expect(tryBlock).toMatch(/await runPermitWorkflow/)
    expect(tryBlock).not.toMatch(/run_status/)
    expect(executeRun).toMatch(/run_status:\s*'error'/)
  })

  test('Lake does not call runAutomationLifecycle and remains fail-closed', async function () {
    expect(LAKE_SRC).not.toMatch(/runAutomationLifecycle/)
    expect(LAKE_SRC).not.toMatch(/base-runner/)
    expect(LAKE_SRC).toMatch(/does NOT call runAccelaPortal/)
    await expect(runLakeCounty({ id: 'job-lake' }, 'run-lake', {})).rejects.toMatchObject({
      errorCode: 'unsupported_platform',
    })
    expect(lakeConfig.loginType).toBe('custom')
  })

  test('CitizenServe and custom scaffolds are the live runAutomationLifecycle callers', function () {
    expect(CITIZENSERVE_SRC).toMatch(/const \{ runAutomationLifecycle \} = require\('\.\/base-runner'\)/)
    expect(CITIZENSERVE_SRC).toMatch(/return runAutomationLifecycle\(/)
    expect(CUSTOM_SRC).toMatch(/const \{ runAutomationLifecycle \} = require\('\.\/base-runner'\)/)
    expect(CUSTOM_SRC).toMatch(/return runAutomationLifecycle\(/)
    expect(ACCELA_BASE_SRC).toMatch(/return runAutomationLifecycle\(/)
    expect(POLK_SRC).not.toMatch(/runAutomationLifecycle/)
    expect(POLK_SRC).toMatch(/async function runAccelaPortal\(/)
  })

  test('handleRunSuccess is removed and no forbidden run_status writers were added', function () {
    var errors = require('../../automation/shared/errors.js')
    expect(errors.handleRunSuccess).toBeUndefined()
    expect(ERRORS_SRC).not.toMatch(/handleRunSuccess/)
    expect(ERRORS_SRC).not.toMatch(/run_status:\s*'needs_review'/)
    ;[BASE_SRC, ERRORS_SRC].forEach(function (src) {
      expect(src).not.toMatch(/run_status:\s*'completed'/)
      expect(src).not.toMatch(/run_status:\s*'submitted'/)
      expect(src).not.toMatch(/run_status:\s*'failed'/)
    })
    expect(BASE_SRC).toMatch(/run_status:\s*RUN_STATUS_COMPLETE/)
    expect(ERRORS_SRC).toMatch(/run_status:\s*RUN_STATUS_ERROR/)
  })
})
