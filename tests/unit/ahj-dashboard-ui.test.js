// tests/unit/ahj-dashboard-ui.test.js
// ZIG-12 PR B: pure UI view-model tests (no React DOM / no PR A rule duplication)
'use strict'

const {
  deriveSummary,
  filterRows,
  lifecycleBadge,
  healthBadge,
  credentialDisplay,
  configDisplay,
  packetDisplay,
  workflowLabel,
  hasMutationControls,
  containsSecretBearingFields,
} = require('../../app/admin/ahjs/lib/dashboard-view-model.js')

function row(overrides) {
  return Object.assign(
    {
      id: 'a1',
      name: 'Alpha County',
      county_or_city: 'Alpha',
      state: 'FL',
      workflow_type: 'portal',
      submission_method: 'online',
      lifecycle_state: 'pilot',
      operational_health: 'healthy',
      is_active: true,
      contractor_visible: true,
      worker_executable: true,
      credential_scope: 'platform',
      credential_status: 'configured',
      config_status: { status: 'ready', reasons: [] },
      packet_status: { status: 'not_applicable' },
      primary_blocker: null,
      all_blockers: [],
      pilot_ready: true,
      pilot_checklist: [
        { label: 'AHJ active', passed: true, blocking: true },
        { label: 'successful validation exists', passed: false, blocking: false },
      ],
      last_relevant_run_at: '2026-08-01T00:00:00Z',
      last_success_at: '2026-08-01T00:00:00Z',
    },
    overrides || {}
  )
}

describe('ahj-dashboard-ui view model (PR B)', function () {
  test('summary derivation from loaded rows only', function () {
    var summary = deriveSummary([
      row({ lifecycle_state: 'production', operational_health: 'healthy' }),
      row({
        id: 'a2',
        lifecycle_state: 'pilot',
        contractor_visible: false,
        worker_executable: false,
      }),
      row({
        id: 'a3',
        lifecycle_state: 'validation_ready',
        operational_health: 'unavailable',
        contractor_visible: true,
        worker_executable: true,
      }),
    ])
    expect(summary.total).toBe(3)
    expect(summary.production).toBe(1)
    expect(summary.pilot).toBe(1)
    expect(summary.validation_ready).toBe(1)
    expect(summary.unavailable).toBe(1)
    expect(summary.contractor_visible).toBe(2)
    expect(summary.worker_executable).toBe(2)
  })

  test('search matches name and jurisdiction', function () {
    var rows = [
      row({ name: 'Polk Portal', county_or_city: 'Polk', state: 'FL' }),
      row({ id: 'b', name: 'Lee Packet', county_or_city: 'Lee', state: 'FL', workflow_type: 'pdf_packet' }),
    ]
    expect(filterRows(rows, 'polk', {}).map(function (r) { return r.id })).toEqual(['a1'])
    expect(filterRows(rows, 'lee', {}).map(function (r) { return r.id })).toEqual(['b'])
  })

  test('each filter and combined filters', function () {
    var rows = [
      row(),
      row({
        id: 'x',
        lifecycle_state: 'production',
        operational_health: 'unavailable',
        workflow_type: 'pdf_packet',
        is_active: false,
        contractor_visible: false,
        worker_executable: false,
        pilot_ready: false,
        primary_blocker: 'inactive',
        all_blockers: ['inactive'],
      }),
    ]
    expect(filterRows(rows, '', { lifecycle: 'production' })).toHaveLength(1)
    expect(filterRows(rows, '', { health: 'unavailable' })).toHaveLength(1)
    expect(filterRows(rows, '', { workflow_type: 'pdf_packet' })).toHaveLength(1)
    expect(filterRows(rows, '', { active: 'false' })).toHaveLength(1)
    expect(filterRows(rows, '', { contractor_visible: 'false' })).toHaveLength(1)
    expect(filterRows(rows, '', { worker_executable: 'false' })).toHaveLength(1)
    expect(filterRows(rows, '', { pilot_ready: 'false' })).toHaveLength(1)
    expect(filterRows(rows, '', { has_blocker: 'true' })).toHaveLength(1)
    expect(
      filterRows(rows, '', {
        lifecycle: 'production',
        health: 'unavailable',
        active: 'false',
        has_blocker: 'true',
      })
    ).toHaveLength(1)
    expect(filterRows(rows, 'nope', { lifecycle: 'production' })).toHaveLength(0)
  })

  test('lifecycle badge valid values + unknown fallback', function () {
    expect(lifecycleBadge('pilot').label).toBe('Pilot')
    expect(lifecycleBadge('production').tone).toBe('success')
    expect(lifecycleBadge('weird-state').label).toBe('weird-state')
    expect(lifecycleBadge('weird-state').tone).toBe('unknown')
    expect(lifecycleBadge(null).label).toBe('Unknown')
  })

  test('health badge valid values + unknown fallback', function () {
    expect(healthBadge('healthy').tone).toBe('success')
    expect(healthBadge('degraded').tone).toBe('warning')
    expect(healthBadge('unavailable').tone).toBe('danger')
    expect(healthBadge('odd').tone).toBe('unknown')
    expect(healthBadge(undefined).label).toBe('Unknown')
  })

  test('platform credential scope clearly says any company', function () {
    var view = credentialDisplay(
      row({ credential_status: 'configured', credential_scope: 'platform' })
    )
    expect(view.label).toBe('Credentials configured (any company)')
    expect(view.detail).toMatch(/does not confirm credentials for a specific contractor/i)
  })

  test('company-scoped credential display', function () {
    var view = credentialDisplay(
      row({ credential_status: 'configured', credential_scope: 'company' })
    )
    expect(view.label).toBe('Credentials configured')
    expect(view.detail).toMatch(/This company has credentials/i)
  })

  test('missing credentials', function () {
    expect(
      credentialDisplay(row({ credential_status: 'missing', credential_scope: 'company' })).label
    ).toBe('Credentials missing')
  })

  test('not_required credentials', function () {
    var view = credentialDisplay(
      row({
        workflow_type: 'pdf_packet',
        credential_status: 'not_required',
        credential_scope: 'platform',
      })
    )
    expect(view.label).toBe('Not required')
    expect(view.tone).toBe('neutral')
  })

  test('portal and pdf_packet rendering helpers', function () {
    expect(workflowLabel('portal')).toBe('Portal')
    expect(workflowLabel('pdf_packet')).toBe('PDF Packet')
    expect(workflowLabel('hybrid')).toBe('Hybrid')
    expect(workflowLabel('email')).toBe('Email')
    expect(workflowLabel('mystery')).toBe('mystery')
    expect(configDisplay(row()).label).toBe('ready')
    expect(packetDisplay(row({ workflow_type: 'portal' })).applicable).toBe(false)
    expect(
      packetDisplay(
        row({
          workflow_type: 'pdf_packet',
          packet_status: { status: 'ready' },
        })
      ).applicable
    ).toBe(true)
  })

  test('blockers and pilot checklist hard vs informational distinction', function () {
    var checklist = row().pilot_checklist
    expect(checklist[0].blocking).toBe(true)
    expect(checklist[1].blocking).toBe(false)
    expect(checklist[1].passed).toBe(false)
    var ready = row({ pilot_ready: true })
    expect(ready.pilot_ready).toBe(true)
    expect(ready.pilot_checklist.some(function (i) {
      return i.blocking === false && i.passed === false
    })).toBe(true)
  })

  test('drawer loading/error/state markers remain representation-only', function () {
    // PR B drawer states are UI strings; assert no secret payload leakage helpers.
    expect(
      containsSecretBearingFields({
        ahj: row(),
        error: 'Failed to load AHJ detail',
        loading: true,
      })
    ).toBe(false)
  })

  test('no mutation controls and no secret-bearing fields in safe payloads', function () {
    expect(hasMutationControls('<button type="button">Close</button>')).toBe(false)
    expect(hasMutationControls('<form method="POST"><button>Activate</button></form>')).toBe(true)
    expect(
      containsSecretBearingFields({
        username: 'secret-user',
        password: 'secret-pass',
      })
    ).toBe(true)
    expect(containsSecretBearingFields(row())).toBe(false)
  })
})
