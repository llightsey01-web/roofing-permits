// tests/unit/job-monitor.test.js
// ZIG-13 PR 4: last-success / failed-run reader semantics
'use strict'

const {
  getLastSuccessfulRunAt,
  countFailedRunsLastHour,
} = require('../../lib/monitoring/job-monitor.js')
const { SUCCESS_READ_STATUSES, FAILURE_READ_STATUSES } = require('../../lib/automation/run-status.js')

function createFilterClient(rows) {
  var captured = { inValues: null }
  return {
    captured: captured,
    from: function () {
      var chain = {
        select: function () { return chain },
        in: function (col, values) {
          captured.column = col
          captured.inValues = values.slice()
          return chain
        },
        eq: function () { return chain },
        gte: function () { return chain },
        not: function () { return chain },
        order: function () { return chain },
        limit: function () { return chain },
        maybeSingle: async function () {
          var match = (rows || []).find(function (row) {
            return captured.inValues && captured.inValues.indexOf(row.run_status) !== -1
          })
          return { data: match || null, error: null }
        },
        then: function (resolve) {
          var matched = (rows || []).filter(function (row) {
            return captured.inValues && captured.inValues.indexOf(row.run_status) !== -1
          })
          return Promise.resolve({ data: matched, error: null }).then(resolve)
        },
      }
      return chain
    },
  }
}

describe('job monitor run-status readers (ZIG-13 PR 4)', function () {
  test('last successful run query uses complete + completed, not needs_review', async function () {
    var client = createFilterClient([
      { run_status: 'needs_review', completed_at: '2026-08-03T00:00:00Z' },
      { run_status: 'complete', completed_at: '2026-08-02T00:00:00Z' },
    ])
    var last = await getLastSuccessfulRunAt(client)
    expect(client.captured.column).toBe('run_status')
    expect(client.captured.inValues).toEqual(SUCCESS_READ_STATUSES.slice())
    expect(client.captured.inValues).not.toContain('needs_review')
    expect(last).toBe('2026-08-02T00:00:00Z')
  })

  test('needs_review alone is not a last successful run', async function () {
    var client = createFilterClient([
      { run_status: 'needs_review', completed_at: '2026-08-03T00:00:00Z' },
    ])
    var last = await getLastSuccessfulRunAt(client)
    expect(last).toBe(null)
  })

  test('historical completed still counts as last successful run', async function () {
    var client = createFilterClient([
      { run_status: 'completed', completed_at: '2026-07-01T00:00:00Z' },
    ])
    var last = await getLastSuccessfulRunAt(client)
    expect(last).toBe('2026-07-01T00:00:00Z')
  })

  test('failed-run count uses error + historical failed, not needs_review', async function () {
    var client = createFilterClient([
      { run_status: 'needs_review', completed_at: '2026-08-03T00:00:00Z' },
      { run_status: 'error', completed_at: '2026-08-03T01:00:00Z' },
      { run_status: 'failed', completed_at: '2026-08-03T02:00:00Z' },
    ])
    var result = await countFailedRunsLastHour(client)
    expect(client.captured.inValues).toEqual(FAILURE_READ_STATUSES.slice())
    expect(client.captured.inValues).not.toContain('needs_review')
    expect(result.count).toBe(2)
  })
})
