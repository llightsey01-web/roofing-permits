// tests/unit/contractor-credential-ahjs.test.js
// ZIG-5: contractor credential-entry AHJ list must require is_active AND workflow_file.
'use strict'

const {
  fetchContractorCredentialAhjs,
  isVisibleForCredentialEntry,
} = require('../../lib/ahj/contractor-credential-ahjs.js')

const FIXTURES = [
  {
    id: 'active-populated',
    name: 'Polk County Building Department',
    is_active: true,
    workflow_file: 'polk-county.runner.js',
  },
  {
    id: 'active-null',
    name: 'Active Missing Runner',
    is_active: true,
    workflow_file: null,
  },
  {
    id: 'inactive-populated',
    name: 'Hillsborough County Building Department',
    is_active: false,
    workflow_file: 'hillsborough-county.runner.js',
  },
  {
    id: 'inactive-null',
    name: 'Inactive Missing Runner',
    is_active: false,
    workflow_file: null,
  },
  {
    id: 'lee-active-populated',
    name: 'Lee County Building Department',
    is_active: true,
    workflow_file: 'lee-county.runner.js',
  },
]

/**
 * Minimal thenable query builder that applies the same filter semantics
 * as the production Supabase chain when filters are recorded.
 */
function createMockSupabase(rows) {
  const state = {
    table: null,
    selectCols: null,
    requireActive: false,
    requireWorkflowFile: false,
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
    not: jest.fn(function (col, op, val) {
      if (col === 'workflow_file' && op === 'is' && val === null) {
        state.requireWorkflowFile = true
      }
      return chain
    }),
    order: jest.fn(function (col) {
      state.orderCol = col
      return chain.then(function (result) {
        return result
      })
    }),
    then: function (onFulfilled, onRejected) {
      var filtered = rows.filter(function (row) {
        if (state.requireActive && row.is_active !== true) return false
        if (state.requireWorkflowFile && row.workflow_file == null) return false
        return true
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

describe('contractor credential-entry AHJ visibility (ZIG-5)', function () {
  test('isVisibleForCredentialEntry covers all is_active x workflow_file combinations', function () {
    expect(isVisibleForCredentialEntry(FIXTURES[0])).toBe(true) // active + populated
    expect(isVisibleForCredentialEntry(FIXTURES[1])).toBe(false) // active + null
    expect(isVisibleForCredentialEntry(FIXTURES[2])).toBe(false) // inactive + populated (exposed-data shape)
    expect(isVisibleForCredentialEntry(FIXTURES[3])).toBe(false) // inactive + null
  })

  test('fetch applies is_active=true and workflow_file IS NOT NULL', async function () {
    const mock = createMockSupabase(FIXTURES)
    const result = await fetchContractorCredentialAhjs(mock)

    expect(mock.from).toHaveBeenCalledWith('ahj_portals')
    expect(mock.chain.select).toHaveBeenCalledWith('id, name, county_or_city, portal_url')
    expect(mock.chain.eq).toHaveBeenCalledWith('is_active', true)
    expect(mock.chain.not).toHaveBeenCalledWith('workflow_file', 'is', null)
    expect(mock.chain.order).toHaveBeenCalledWith('name')
    expect(mock.state.requireActive).toBe(true)
    expect(mock.state.requireWorkflowFile).toBe(true)

    const ids = (result.data || []).map(function (r) { return r.id }).sort()
    expect(ids).toEqual(['active-populated', 'lee-active-populated'])
  })

  test('regression: is_active=false + populated workflow_file is excluded', async function () {
    const mock = createMockSupabase(FIXTURES)
    const result = await fetchContractorCredentialAhjs(mock)
    const ids = (result.data || []).map(function (r) { return r.id })

    expect(ids).not.toContain('inactive-populated')
    expect(
      (result.data || []).some(function (r) {
        return r.is_active === false && r.workflow_file != null
      })
    ).toBe(false)
  })

  test('non-regression: active + populated AHJs (Polk/Lee shape) remain included', async function () {
    const mock = createMockSupabase(FIXTURES)
    const result = await fetchContractorCredentialAhjs(mock)
    const ids = (result.data || []).map(function (r) { return r.id })

    expect(ids).toContain('active-populated')
    expect(ids).toContain('lee-active-populated')
    expect(result.data).toHaveLength(2)
  })

  test('pre-fix query (workflow_file only) would incorrectly include inactive+populated', async function () {
    // Documents that the old 13a60fa filter alone fails the ZIG-5 gate.
    const unsafeIds = FIXTURES.filter(function (row) {
      return row.workflow_file != null
    }).map(function (r) { return r.id })

    expect(unsafeIds).toContain('inactive-populated')
    expect(unsafeIds).toContain('active-populated')

    const mock = createMockSupabase(FIXTURES)
    const result = await fetchContractorCredentialAhjs(mock)
    const safeIds = (result.data || []).map(function (r) { return r.id })
    expect(safeIds).not.toContain('inactive-populated')
  })
})
