// tests/unit/contractor-credential-ahjs.test.js
// ZIG-5 + ZIG-6: contractor credential-entry AHJ list pushdown filters.
'use strict'

const {
  fetchContractorCredentialAhjs,
  isVisibleForCredentialEntry,
  contractorCanSeeAhj,
} = require('../../lib/ahj/contractor-credential-ahjs.js')

function base(overrides) {
  return Object.assign({
    is_active: true,
    lifecycle_state: 'production',
    operational_health: 'healthy',
    workflow_type: 'portal',
    workflow_file: 'x.runner.js',
  }, overrides || {})
}

const FIXTURES = [
  base({
    id: 'active-populated',
    name: 'Polk County Building Department',
    lifecycle_state: 'production',
    workflow_file: 'polk-county.runner.js',
  }),
  base({
    id: 'active-null',
    name: 'Active Missing Runner',
    workflow_file: null,
  }),
  base({
    id: 'inactive-populated',
    name: 'Hillsborough County Building Department',
    is_active: false,
    lifecycle_state: 'validation_ready',
    workflow_file: 'hillsborough-county.runner.js',
  }),
  base({
    id: 'inactive-null',
    name: 'Inactive Missing Runner',
    is_active: false,
    lifecycle_state: 'planned',
    workflow_file: null,
  }),
  base({
    id: 'lee-active-populated',
    name: 'Lee County Building Department',
    lifecycle_state: 'pilot',
    workflow_file: 'lee-county.runner.js',
  }),
  base({
    id: 'validation-ready-active',
    name: 'Charlotte County Building Department',
    is_active: true,
    lifecycle_state: 'validation_ready',
    workflow_file: 'charlotte-county.runner.js',
  }),
  base({
    id: 'unavailable-polk-shape',
    name: 'Unavailable AHJ',
    lifecycle_state: 'production',
    operational_health: 'unavailable',
    workflow_file: 'polk-county.runner.js',
  }),
]

function rowMatchesQueryState(row, state) {
  if (state.requireActive && row.is_active !== true) return false
  if (state.lifecycleIn && state.lifecycleIn.indexOf(row.lifecycle_state) < 0) return false
  if (state.healthNeq && row.operational_health === state.healthNeq) return false
  if (state.portalOr) {
    var nonPortal = row.workflow_type != null && row.workflow_type !== 'portal'
    var hasFile = row.workflow_file != null
    if (!nonPortal && !hasFile) return false
  }
  return true
}

/**
 * Minimal thenable query builder mirroring ZIG-6 pushdown filters.
 */
function createMockSupabase(rows) {
  const state = {
    table: null,
    selectCols: null,
    requireActive: false,
    lifecycleIn: null,
    healthNeq: null,
    portalOr: false,
    orderCol: null,
  }

  const chain = {
    select: jest.fn(function (cols) {
      state.selectCols = cols
      return chain
    }),
    eq: jest.fn(function (col, val) {
      if (col === 'is_active' && val === true) state.requireActive = true
      return chain
    }),
    in: jest.fn(function (col, vals) {
      if (col === 'lifecycle_state') state.lifecycleIn = vals.slice()
      return chain
    }),
    neq: jest.fn(function (col, val) {
      if (col === 'operational_health') state.healthNeq = val
      return chain
    }),
    or: jest.fn(function (expr) {
      if (expr === 'workflow_type.neq.portal,workflow_file.not.is.null') {
        state.portalOr = true
      }
      return chain
    }),
    not: jest.fn(function () { return chain }),
    order: jest.fn(function (col) {
      state.orderCol = col
      return chain.then(function (result) {
        return result
      })
    }),
    then: function (onFulfilled, onRejected) {
      var filtered = rows.filter(function (row) {
        return rowMatchesQueryState(row, state)
      })
      if (state.orderCol === 'name') {
        filtered = filtered.slice().sort(function (a, b) {
          return String(a.name || '').localeCompare(String(b.name || ''))
        })
      }
      return Promise.resolve({ data: filtered, error: null }).then(onFulfilled, onRejected)
    },
  }

  return {
    state: state,
    from: jest.fn(function (table) {
      state.table = table
      return chain
    }),
    chain: chain,
  }
}

describe('contractor credential-entry AHJ visibility (ZIG-5 + ZIG-6)', function () {
  test('isVisibleForCredentialEntry aliases contractorCanSeeAhj', function () {
    FIXTURES.forEach(function (f) {
      expect(isVisibleForCredentialEntry(f)).toBe(contractorCanSeeAhj(f))
    })
  })

  test('policy: inactive + populated excluded; Polk/Lee shapes included', function () {
    expect(isVisibleForCredentialEntry(FIXTURES[0])).toBe(true)
    expect(isVisibleForCredentialEntry(FIXTURES[1])).toBe(false)
    expect(isVisibleForCredentialEntry(FIXTURES[2])).toBe(false)
    expect(isVisibleForCredentialEntry(FIXTURES[3])).toBe(false)
    expect(isVisibleForCredentialEntry(FIXTURES[4])).toBe(true)
    expect(isVisibleForCredentialEntry(FIXTURES[5])).toBe(false)
    expect(isVisibleForCredentialEntry(FIXTURES[6])).toBe(false)
  })

  test('fetch pushes ZIG-6 filters (no broad client filter)', async function () {
    const mock = createMockSupabase(FIXTURES)
    const result = await fetchContractorCredentialAhjs(mock)

    expect(mock.from).toHaveBeenCalledWith('ahj_portals')
    expect(mock.chain.select).toHaveBeenCalledWith('id, name, county_or_city, portal_url')
    expect(mock.chain.eq).toHaveBeenCalledWith('is_active', true)
    expect(mock.chain.in).toHaveBeenCalledWith('lifecycle_state', ['pilot', 'production'])
    expect(mock.chain.neq).toHaveBeenCalledWith('operational_health', 'unavailable')
    expect(mock.chain.or).toHaveBeenCalledWith('workflow_type.neq.portal,workflow_file.not.is.null')
    expect(mock.chain.order).toHaveBeenCalledWith('name')

    const ids = (result.data || []).map(function (r) { return r.id }).sort()
    expect(ids).toEqual(['active-populated', 'lee-active-populated'])
  })

  test('query ↔ policy equivalence over fixtures', async function () {
    const mock = createMockSupabase(FIXTURES)
    const result = await fetchContractorCredentialAhjs(mock)
    const queryIds = (result.data || []).map(function (r) { return r.id }).sort()
    const policyIds = FIXTURES.filter(contractorCanSeeAhj).map(function (r) { return r.id }).sort()
    expect(queryIds).toEqual(policyIds)
  })

  test('regression: is_active=false + populated workflow_file is excluded', async function () {
    const mock = createMockSupabase(FIXTURES)
    const result = await fetchContractorCredentialAhjs(mock)
    const ids = (result.data || []).map(function (r) { return r.id })
    expect(ids).not.toContain('inactive-populated')
  })

  test('non-regression: Polk/Lee remain included', async function () {
    const mock = createMockSupabase(FIXTURES)
    const result = await fetchContractorCredentialAhjs(mock)
    const ids = (result.data || []).map(function (r) { return r.id })
    expect(ids).toContain('active-populated')
    expect(ids).toContain('lee-active-populated')
    expect(result.data).toHaveLength(2)
  })

  test('validation_ready with runner is not contractor-visible', async function () {
    const mock = createMockSupabase(FIXTURES)
    const result = await fetchContractorCredentialAhjs(mock)
    expect((result.data || []).map(function (r) { return r.id })).not.toContain('validation-ready-active')
  })
})
