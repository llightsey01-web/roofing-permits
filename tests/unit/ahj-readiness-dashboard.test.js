// tests/unit/ahj-readiness-dashboard.test.js
// PR A: AHJ readiness dashboard aggregation + sanitization
'use strict'

const {
  buildAhjDashboardRow,
  sanitizeDashboardError,
  aggregateRunMetrics,
  loadAhjDashboardRows,
  loadAhjDashboardRow,
  resolveCredentialStatus,
  resolveConfigStatus,
  deriveBlockers,
  buildPilotChecklist,
  emptyRunMetrics,
  SUCCESS_STATUSES,
  FAILURE_STATUSES,
  RELEVANT_RUN_TYPES,
} = require('../../lib/ahj/ahj-readiness-dashboard.js')
const { evaluatePacketReadinessFromRows } = require('../../lib/ahj/packet-config.js')

function portalAhj(overrides) {
  return Object.assign(
    {
      id: 'ahj-portal-1',
      name: 'Portal County',
      county_or_city: 'Portal',
      state: 'FL',
      workflow_type: 'portal',
      submission_method: 'online',
      lifecycle_state: 'pilot',
      operational_health: 'healthy',
      is_active: true,
      workflow_file: 'polk-county.runner.js',
    },
    overrides || {}
  )
}

function packetAhj(overrides) {
  return Object.assign(
    {
      id: 'ahj-packet-1',
      name: 'Packet City',
      county_or_city: 'Packet',
      state: 'FL',
      workflow_type: 'pdf_packet',
      submission_method: 'physical',
      lifecycle_state: 'pilot',
      operational_health: 'healthy',
      is_active: true,
      workflow_file: null,
    },
    overrides || {}
  )
}

function validPacketRow(overrides) {
  return Object.assign(
    {
      id: 'req-1',
      ahj_id: 'ahj-packet-1',
      document_role: 'product_approval',
      display_name: 'Product Approval',
      required: true,
      include_in_submission_packet: true,
      source_type: 'contractor_uploaded',
      template_storage_path: null,
      field_map: null,
      sort_order: 10,
    },
    overrides || {}
  )
}

function successMetrics() {
  return {
    last_relevant_run_at: '2026-08-01T00:00:00Z',
    last_success_at: '2026-08-01T00:00:00Z',
    last_failure_at: null,
    relevant_run_count: 1,
    success_count: 1,
    failure_count: 0,
    recent_failure_streak: 0,
    last_error_message: null,
  }
}

function assertNoSecrets(payload) {
  var json = JSON.stringify(payload)
  var forbidden = [
    'credential_key',
    '"username"',
    '"password"',
    'encrypted_username',
    'encrypted_password',
    'password_encrypted',
    'portal_password',
    'SUPABASE_SERVICE_ROLE_KEY',
    'service_role',
    'sk_live_',
  ]
  forbidden.forEach(function (needle) {
    expect(json).not.toContain(needle)
  })
}

describe('ahj-readiness-dashboard (PR A)', function () {
  test('portal ready → pilot_ready when hard checklist + credentials configured', function () {
    var row = buildAhjDashboardRow(
      portalAhj(),
      successMetrics(),
      'configured',
      { status: 'not_applicable' }
    )
    expect(row.contractor_visible).toBe(true)
    expect(row.worker_executable).toBe(true)
    expect(row.credential_status).toBe('configured')
    expect(row.credential_scope).toBe('platform')
    expect(row.config_status.status).toBe('ready')
    expect(row.pilot_ready).toBe(true)
    expect(row.primary_blocker).toBeNull()
    assertNoSecrets(row)
  })

  test('company-scoped missing credentials hard-block pilot_ready for portal AHJs', function () {
    var row = buildAhjDashboardRow(
      portalAhj(),
      successMetrics(),
      'missing',
      { status: 'not_applicable' },
      'company'
    )
    expect(row.credential_scope).toBe('company')
    expect(row.credential_status).toBe('missing')
    expect(row.pilot_ready).toBe(false)
    expect(row.all_blockers).toContain('required_credentials_missing')
    var credItem = row.pilot_checklist.find(function (i) {
      return i.label === 'credentials configured/not required'
    })
    expect(credItem.passed).toBe(false)
    expect(credItem.blocking).toBe(true)
    // ZIG-6 eligibility remains independent of company credential scope
    expect(row.worker_executable).toBe(true)
    expect(row.contractor_visible).toBe(true)
  })

  test('portal inactive blocks pilot_ready', function () {
    var row = buildAhjDashboardRow(
      portalAhj({ is_active: false }),
      successMetrics(),
      'configured',
      { status: 'not_applicable' }
    )
    expect(row.pilot_ready).toBe(false)
    expect(row.primary_blocker).toBe('inactive')
    expect(row.contractor_visible).toBe(false)
  })

  test('portal missing workflow_file → incomplete config + not visible', function () {
    var row = buildAhjDashboardRow(
      portalAhj({ workflow_file: null }),
      successMetrics(),
      'configured',
      { status: 'not_applicable' }
    )
    expect(row.config_status.status).toBe('incomplete')
    expect(row.contractor_visible).toBe(false)
    expect(row.pilot_ready).toBe(false)
    expect(row.all_blockers).toContain('workflow_configuration_incomplete')
  })

  test('portal unavailable health blocks', function () {
    var row = buildAhjDashboardRow(
      portalAhj({ operational_health: 'unavailable' }),
      successMetrics(),
      'configured',
      { status: 'not_applicable' }
    )
    expect(row.primary_blocker).toBe('operational_health_unavailable')
    expect(row.pilot_ready).toBe(false)
  })

  test('portal missing credentials blocks hard checklist', function () {
    var row = buildAhjDashboardRow(
      portalAhj(),
      successMetrics(),
      'missing',
      { status: 'not_applicable' }
    )
    expect(row.credential_status).toBe('missing')
    expect(row.pilot_ready).toBe(false)
    expect(row.all_blockers).toContain('required_credentials_missing')
  })

  test('pdf_packet ready with valid packet config', function () {
    var packet = evaluatePacketReadinessFromRows([validPacketRow()], 'pdf_packet')
    var row = buildAhjDashboardRow(packetAhj(), successMetrics(), 'not_required', packet)
    expect(packet.status).toBe('ready')
    expect(row.credential_status).toBe('not_required')
    expect(row.config_status.status).toBe('ready')
    expect(row.packet_status.status).toBe('ready')
    expect(row.pilot_ready).toBe(true)
  })

  test('pdf_packet missing packet config', function () {
    var packet = evaluatePacketReadinessFromRows([], 'pdf_packet')
    var row = buildAhjDashboardRow(packetAhj(), successMetrics(), 'not_required', packet)
    expect(packet.status).toBe('missing')
    expect(row.config_status.status).toBe('incomplete')
    expect(row.pilot_ready).toBe(false)
    expect(row.all_blockers).toContain('packet_configuration_missing')
  })

  test('pdf_packet invalid packet config', function () {
    var packet = evaluatePacketReadinessFromRows(
      [validPacketRow({ display_name: '' })],
      'pdf_packet'
    )
    var row = buildAhjDashboardRow(packetAhj(), successMetrics(), 'not_required', packet)
    expect(packet.status).toBe('invalid')
    expect(row.pilot_ready).toBe(false)
    expect(row.all_blockers).toContain('packet_configuration_invalid')
  })

  test('unsupported workflow is hard blocker; ZIG-6 may still be true', function () {
    var ahj = portalAhj({ workflow_type: 'hybrid', workflow_file: null })
    var row = buildAhjDashboardRow(ahj, successMetrics(), 'not_required', {
      status: 'not_applicable',
    })
    expect(row.worker_executable).toBe(true)
    expect(row.config_status.status).toBe('not_applicable')
    expect(row.primary_blocker).toBe('unsupported_workflow')
    expect(row.pilot_ready).toBe(false)
  })

  test('no successful validation is informational — does not alone fail pilot_ready', function () {
    var metrics = emptyRunMetrics()
    var row = buildAhjDashboardRow(
      portalAhj(),
      metrics,
      'configured',
      { status: 'not_applicable' }
    )
    expect(row.pilot_ready).toBe(true)
    expect(row.all_blockers).toContain('no_successful_validation')
    var info = row.pilot_checklist.find(function (i) {
      return i.label === 'successful validation exists'
    })
    expect(info.blocking).toBe(false)
    expect(info.passed).toBe(false)
  })

  test('failure streak is informational', function () {
    var metrics = aggregateRunMetrics([
      { run_status: 'failed', started_at: '2026-08-02T00:00:00Z', error_message: 'boom' },
      { run_status: 'error', started_at: '2026-08-01T00:00:00Z' },
    ])
    expect(metrics.recent_failure_streak).toBe(2)
    var row = buildAhjDashboardRow(
      portalAhj(),
      Object.assign(metrics, { success_count: 1, last_success_at: '2026-07-01T00:00:00Z' }),
      'configured',
      { status: 'not_applicable' }
    )
    expect(row.pilot_ready).toBe(true)
    expect(row.all_blockers).toContain('repeated_recent_failures')
  })

  test('blocker precedence: inactive before unsupported before lifecycle', function () {
    var blockers = deriveBlockers(
      portalAhj({
        is_active: false,
        workflow_type: 'email',
        lifecycle_state: 'planned',
        operational_health: 'unavailable',
      }),
      'missing',
      { status: 'incomplete', reasons: ['x'] },
      { status: 'not_applicable' },
      emptyRunMetrics()
    )
    expect(blockers.primary_blocker).toBe('inactive')
    expect(blockers.all_blockers[0]).toBe('inactive')
    expect(blockers.all_blockers).toContain('unsupported_workflow')
    expect(blockers.all_blockers).toContain('lifecycle_not_pilot_production')
  })

  test('checklist hard vs informational behavior', function () {
    var result = buildPilotChecklist(
      portalAhj(),
      'configured',
      { status: 'ready', reasons: [] },
      { status: 'not_applicable' },
      emptyRunMetrics(),
      true,
      true
    )
    var hard = result.items.filter(function (i) {
      return i.blocking
    })
    var soft = result.items.filter(function (i) {
      return !i.blocking
    })
    expect(hard.length).toBe(7)
    expect(soft.length).toBe(4)
    expect(result.pilot_ready).toBe(true)
  })

  test('success statuses: complete and completed count as success; needs_review does not', function () {
    expect(SUCCESS_STATUSES.has('needs_review')).toBe(false)
    expect(SUCCESS_STATUSES.has('complete')).toBe(true)
    expect(SUCCESS_STATUSES.has('completed')).toBe(true)

    var metrics = aggregateRunMetrics([
      { run_status: 'running', started_at: '2026-08-04T00:00:00Z' },
      {
        run_status: 'complete',
        started_at: '2026-08-03T00:00:00Z',
        completed_at: '2026-08-03T01:00:00Z',
      },
      {
        run_status: 'completed',
        started_at: '2026-08-02T00:00:00Z',
        completed_at: '2026-08-02T01:00:00Z',
      },
      {
        run_status: 'needs_review',
        started_at: '2026-08-01T00:00:00Z',
        completed_at: '2026-08-01T01:00:00Z',
      },
      { run_status: 'failed', started_at: '2026-07-29T00:00:00Z' },
    ])
    expect(metrics.success_count).toBe(2)
    expect(metrics.intervention_count).toBe(1)
    expect(metrics.failure_count).toBe(1)
    expect(metrics.relevant_run_count).toBe(5)
    expect(metrics.last_success_at).toBe('2026-08-03T01:00:00Z')
    expect(metrics.last_intervention_at).toBe('2026-08-01T01:00:00Z')
    expect(metrics.recent_failure_streak).toBe(0)
  })

  test('unknown run status counts as neither and does not crash', function () {
    var metrics = aggregateRunMetrics([
      { run_status: 'running', started_at: '2026-08-03T00:00:00Z' },
      { run_status: 'queued', started_at: '2026-08-02T00:00:00Z' },
      { run_status: 'completed', started_at: '2026-08-01T00:00:00Z' },
      { run_status: 'failed', started_at: '2026-07-29T00:00:00Z' },
    ])
    expect(metrics.success_count).toBe(1)
    expect(metrics.failure_count).toBe(1)
    expect(metrics.relevant_run_count).toBe(4)
    expect(metrics.recent_failure_streak).toBe(0)
  })

  test('complete success breaks failure streak for validation history', function () {
    var metrics = aggregateRunMetrics([
      {
        run_status: 'complete',
        started_at: '2026-08-03T00:00:00Z',
        completed_at: '2026-08-03T01:00:00Z',
      },
      { run_status: 'failed', started_at: '2026-08-02T00:00:00Z' },
      { run_status: 'error', started_at: '2026-08-01T00:00:00Z' },
    ])
    expect(metrics.success_count).toBe(1)
    expect(metrics.failure_count).toBe(2)
    expect(metrics.recent_failure_streak).toBe(0)
    expect(metrics.last_success_at).toBe('2026-08-03T01:00:00Z')
  })

  test('NOC / unrelated run types are excluded from RELEVANT_RUN_TYPES', function () {
    expect(RELEVANT_RUN_TYPES.has('noc_generate')).toBe(false)
    expect(RELEVANT_RUN_TYPES.has('proof_send')).toBe(false)
    expect(RELEVANT_RUN_TYPES.has('erecord_submit')).toBe(false)
    expect(RELEVANT_RUN_TYPES.has('ops_health')).toBe(false)
    expect(RELEVANT_RUN_TYPES.has('permit_phase_1')).toBe(true)
    expect(RELEVANT_RUN_TYPES.has('permit_packet')).toBe(true)
  })

  test('error sanitization truncates and redacts secret-looking strings', function () {
    var long = 'x'.repeat(400)
    expect(sanitizeDashboardError(long).length).toBe(200)

    var secret =
      'Login failed password=SuperSecret123 token=abc.def.ghi Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaa.bbb'
    var cleaned = sanitizeDashboardError(secret)
    expect(cleaned).not.toContain('SuperSecret123')
    expect(cleaned).not.toMatch(/Bearer\s+eyJ/)
    expect(cleaned).toContain('[redacted]')

    var stack = 'Boom\n    at Object.<anonymous> (/tmp/secret.js:1:1)\n    at Module._compile'
    expect(sanitizeDashboardError(stack)).not.toContain('at Object')
  })

  test('serialized dashboard output has no secret-bearing keys/values', function () {
    var row = buildAhjDashboardRow(
      portalAhj(),
      Object.assign(successMetrics(), {
        last_error_message: sanitizeDashboardError('password=leak token=xyz'),
      }),
      'configured',
      { status: 'not_applicable' }
    )
    assertNoSecrets(row)
    expect(JSON.stringify(row)).not.toContain('password=')
  })

  test('resolveCredentialStatus canonical values', function () {
    expect(resolveCredentialStatus(packetAhj(), {}, false)).toBe('not_required')
    expect(resolveCredentialStatus(portalAhj(), { 'ahj-portal-1': true }, false)).toBe(
      'configured'
    )
    expect(resolveCredentialStatus(portalAhj(), {}, false)).toBe('missing')
    expect(resolveCredentialStatus(portalAhj(), {}, true)).toBe('unknown')
  })

  test('resolveConfigStatus derives pdf_packet from packet readiness', function () {
    expect(
      resolveConfigStatus(packetAhj(), { status: 'ready' }).status
    ).toBe('ready')
    expect(
      resolveConfigStatus(packetAhj(), { status: 'missing', reason: 'packet_config_missing' })
        .status
    ).toBe('incomplete')
    expect(resolveConfigStatus(portalAhj({ workflow_type: 'email' }), { status: 'not_applicable' })
      .status).toBe('not_applicable')
  })
})

describe('ahj-readiness-dashboard batch aggregation', function () {
  function createMockSupabase(opts) {
    var portals = opts.portals || []
    var jobs = opts.jobs || []
    var runs = opts.runs || []
    var vault = opts.vault || []
    var legacy = opts.legacy || []
    var requirements = opts.requirements || []
    var queryCounts = {
      ahj_portals: 0,
      jobs: 0,
      automation_runs: 0,
      company_credentials: 0,
      company_ahj_credentials: 0,
      ahj_document_requirements: 0,
    }

    function chainFor(table) {
      var state = { filters: {}, inFilters: {} }
      var chain = {
        select: function () {
          return chain
        },
        eq: function (col, val) {
          state.filters[col] = val
          return chain
        },
        not: function () {
          return chain
        },
        or: function () {
          return chain
        },
        in: function (col, vals) {
          state.inFilters[col] = vals
          return chain
        },
        order: function () {
          return chain
        },
        limit: function () {
          return chain
        },
        then: function (resolve, reject) {
          return Promise.resolve(resolveTable(table, state)).then(resolve, reject)
        },
      }
      return chain
    }

    function resolveTable(table, state) {
      queryCounts[table] = (queryCounts[table] || 0) + 1
      if (table === 'ahj_portals') {
        var rows = portals
        if (state.inFilters.id) {
          rows = portals.filter(function (p) {
            return state.inFilters.id.indexOf(p.id) !== -1
          })
        }
        return { data: rows, error: null }
      }
      if (table === 'jobs') {
        return {
          data: jobs.filter(function (j) {
            return !state.inFilters.ahj_id || state.inFilters.ahj_id.indexOf(j.ahj_id) !== -1
          }),
          error: null,
        }
      }
      if (table === 'automation_runs') {
        return {
          data: runs.filter(function (r) {
            if (state.inFilters.job_id && state.inFilters.job_id.indexOf(r.job_id) === -1) {
              return false
            }
            if (state.inFilters.run_type && state.inFilters.run_type.indexOf(r.run_type) === -1) {
              return false
            }
            return true
          }),
          error: null,
        }
      }
      if (table === 'company_credentials') {
        return {
          data: vault.filter(function (row) {
            if (state.filters.company_id && row.company_id !== state.filters.company_id) {
              return false
            }
            return true
          }),
          error: null,
        }
      }
      if (table === 'company_ahj_credentials') {
        return {
          data: legacy.filter(function (row) {
            if (state.filters.company_id && row.company_id !== state.filters.company_id) {
              return false
            }
            return true
          }),
          error: null,
        }
      }
      if (table === 'ahj_document_requirements') {
        return { data: requirements, error: null }
      }
      return { data: [], error: { message: 'unknown table ' + table } }
    }

    return {
      queryCounts: queryCounts,
      from: function (table) {
        return chainFor(table)
      },
    }
  }

  test('loadAhjDashboardRows batches portals/jobs/runs/creds/packets without per-AHJ N+1', async function () {
    var portals = [
      portalAhj({ id: 'a1', name: 'A1' }),
      portalAhj({ id: 'a2', name: 'A2', workflow_file: 'lee-county.runner.js' }),
      packetAhj({ id: 'p1', name: 'P1' }),
    ]
    var supabase = createMockSupabase({
      portals: portals,
      jobs: [
        { id: 'j1', ahj_id: 'a1' },
        { id: 'j2', ahj_id: 'a2' },
      ],
      runs: [
        {
          id: 'r1',
          job_id: 'j1',
          run_type: 'permit_phase_1',
          run_status: 'completed',
          started_at: '2026-08-01T00:00:00Z',
          completed_at: '2026-08-01T01:00:00Z',
        },
        {
          id: 'r-noc',
          job_id: 'j1',
          run_type: 'noc_generate',
          run_status: 'completed',
          started_at: '2026-08-02T00:00:00Z',
        },
      ],
      vault: [{ ahj_id: 'a1' }, { ahj_id: 'a2' }],
      legacy: [],
      requirements: [validPacketRow({ ahj_id: 'p1' })],
    })

    var rows = await loadAhjDashboardRows(supabase)
    expect(rows.length).toBe(3)

    // One portals query; credential tables once each; jobs once; requirements once.
    // automation_runs may be chunked but not once-per-AHJ for 3 AHJs with 2 jobs.
    expect(supabase.queryCounts.ahj_portals).toBe(1)
    expect(supabase.queryCounts.jobs).toBe(1)
    expect(supabase.queryCounts.company_credentials).toBe(1)
    expect(supabase.queryCounts.company_ahj_credentials).toBe(1)
    expect(supabase.queryCounts.ahj_document_requirements).toBe(1)
    expect(supabase.queryCounts.automation_runs).toBeLessThanOrEqual(2)

    var a1 = rows.find(function (r) {
      return r.id === 'a1'
    })
    expect(a1.success_count).toBe(1)
    expect(a1.credential_status).toBe('configured')
    expect(a1.credential_scope).toBe('platform')

    var p1 = rows.find(function (r) {
      return r.id === 'p1'
    })
    expect(p1.packet_status.status).toBe('ready')
    expect(p1.credential_status).toBe('not_required')
    expect(p1.credential_scope).toBe('platform')

    rows.forEach(assertNoSecrets)
  })

  test('company-scoped credentials ignore other companies; platform sees any presence', async function () {
    var companyA = '11111111-1111-4111-8111-111111111111'
    var companyB = '22222222-2222-4222-8222-222222222222'
    var portals = [portalAhj({ id: 'ahj-1' })]
    var supabase = createMockSupabase({
      portals: portals,
      vault: [{ ahj_id: 'ahj-1', company_id: companyB }],
      legacy: [],
    })

    var platformRows = await loadAhjDashboardRows(supabase)
    expect(platformRows[0].credential_scope).toBe('platform')
    expect(platformRows[0].credential_status).toBe('configured')

    var scopedMissing = await loadAhjDashboardRows(supabase, { companyId: companyA })
    expect(scopedMissing[0].credential_scope).toBe('company')
    expect(scopedMissing[0].credential_status).toBe('missing')
    expect(scopedMissing[0].pilot_ready).toBe(false)
    expect(scopedMissing[0].all_blockers).toContain('required_credentials_missing')
    // No hardcoded company identifiers in row output
    expect(JSON.stringify(scopedMissing[0])).not.toContain(companyA)
    expect(JSON.stringify(scopedMissing[0])).not.toContain(companyB)

    var scopedConfigured = await loadAhjDashboardRows(supabase, { companyId: companyB })
    expect(scopedConfigured[0].credential_scope).toBe('company')
    expect(scopedConfigured[0].credential_status).toBe('configured')
    expect(scopedConfigured[0].pilot_ready).toBe(true)

    var detail = await loadAhjDashboardRow(supabase, 'ahj-1', { companyId: companyA })
    expect(detail.credential_scope).toBe('company')
    expect(detail.credential_status).toBe('missing')

    // Still batched: one vault + one legacy per load call
    expect(supabase.queryCounts.company_credentials).toBeGreaterThanOrEqual(3)
    expect(supabase.queryCounts.company_credentials).toBeLessThanOrEqual(4)
  })

  test('per-AHJ evaluation failure becomes safe unknown row', async function () {
    var broken = portalAhj({ id: 'broken' })
    Object.defineProperty(broken, 'lifecycle_state', {
      get: function () {
        throw new Error('password=should-not-leak stack boom')
      },
    })
    var supabase = createMockSupabase({
      portals: [broken, portalAhj({ id: 'ok' })],
      vault: [{ ahj_id: 'ok' }],
    })
    var rows = await loadAhjDashboardRows(supabase)
    expect(rows.length).toBe(2)
    var bad = rows.find(function (r) {
      return r.id === 'broken'
    })
    expect(bad.pilot_ready).toBe(false)
    expect(bad.primary_blocker).toBe('unknown')
    expect(JSON.stringify(bad)).not.toContain('password=should-not-leak')
  })

  test('loadAhjDashboardRow returns single AHJ', async function () {
    var supabase = createMockSupabase({
      portals: [portalAhj({ id: 'only' })],
      vault: [{ ahj_id: 'only' }],
    })
    var row = await loadAhjDashboardRow(supabase, 'only')
    expect(row.id).toBe('only')
    expect(row.credential_status).toBe('configured')
    expect(row.credential_scope).toBe('platform')
  })

  test('FAILURE_STATUSES includes failed and error, not needs_review', function () {
    expect(FAILURE_STATUSES.has('failed')).toBe(true)
    expect(FAILURE_STATUSES.has('error')).toBe(true)
    expect(FAILURE_STATUSES.has('needs_review')).toBe(false)
    expect(SUCCESS_STATUSES.has('needs_review')).toBe(false)
  })

  test('needs_review is intervention and does not raise success or failure scores', function () {
    var metrics = aggregateRunMetrics([
      {
        run_status: 'needs_review',
        started_at: '2026-08-03T00:00:00Z',
        completed_at: '2026-08-03T01:00:00Z',
      },
      { run_status: 'error', started_at: '2026-08-02T00:00:00Z' },
    ])
    expect(metrics.success_count).toBe(0)
    expect(metrics.intervention_count).toBe(1)
    expect(metrics.failure_count).toBe(1)
    expect(metrics.recent_failure_streak).toBe(0)
    var row = buildAhjDashboardRow(
      portalAhj(),
      metrics,
      'configured',
      { status: 'not_applicable' }
    )
    expect(row.all_blockers).toContain('no_successful_validation')
    var info = row.pilot_checklist.find(function (i) {
      return i.label === 'successful validation exists'
    })
    expect(info.passed).toBe(false)
  })
})
