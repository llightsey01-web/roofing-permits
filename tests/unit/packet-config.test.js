// tests/unit/packet-config.test.js
// ZIG-10: packet requirement loading + config validation + retry semantics
'use strict'

const {
  loadPacketRequirements,
  isPacketConfigValid,
  packetConfigMissingError,
} = require('../../lib/ahj/packet-config.js')
const { withRetry } = require('../../lib/automation/retry.js')
const {
  runPermitPacketSkeleton,
  PERMIT_PACKET_RUN_TYPE,
} = require('../../lib/automation/permit-packet.js')

function validRow(overrides) {
  return Object.assign(
    {
      id: 'req-1',
      ahj_id: 'ahj-1',
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

function mockRequirementsClient(rowsOrError) {
  var lastOrders = []
  var eqAhjId = null
  return {
    lastOrders: lastOrders,
    getEqAhjId: function () {
      return eqAhjId
    },
    from: function (table) {
      expect(table).toBe('ahj_document_requirements')
      var chain = {
        select: function () {
          return chain
        },
        eq: function (col, val) {
          expect(col).toBe('ahj_id')
          eqAhjId = val
          return chain
        },
        order: function (col, opts) {
          lastOrders.push({ col: col, opts: opts })
          return chain
        },
        then: function (resolve, reject) {
          return Promise.resolve(
            rowsOrError && rowsOrError.error
              ? { data: null, error: rowsOrError.error }
              : { data: rowsOrError || [], error: null }
          ).then(resolve, reject)
        },
      }
      return chain
    },
  }
}

describe('packet-config (ZIG-10)', function () {
  test('valid manifest passes', function () {
    var result = isPacketConfigValid([
      validRow(),
      validRow({
        document_role: 'notice_of_commencement',
        display_name: 'NOC',
        sort_order: 5,
      }),
    ])
    expect(result.valid).toBe(true)
  })

  test('zero rows → packet_config_missing via loadPacketRequirements', async function () {
    var client = mockRequirementsClient([])
    await expect(loadPacketRequirements(client, 'ahj-1')).rejects.toMatchObject({
      errorCode: 'packet_config_missing',
      nonRetryable: true,
    })
  })

  test('dart_generated with missing template_storage_path fails', function () {
    var result = isPacketConfigValid([
      validRow({
        source_type: 'dart_generated',
        template_storage_path: '  ',
        field_map: { Owner: 'job.owner_name' },
      }),
    ])
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/template_storage_path/)
  })

  test('dart_generated with empty field_map fails', function () {
    var result = isPacketConfigValid([
      validRow({
        source_type: 'dart_generated',
        template_storage_path: 'templates/app.pdf',
        field_map: {},
      }),
    ])
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/field_map/)
  })

  test('no required + included row fails', function () {
    var result = isPacketConfigValid([
      validRow({ required: false, include_in_submission_packet: true }),
      validRow({
        document_role: 'approved_permit',
        display_name: 'Approved',
        required: true,
        include_in_submission_packet: false,
      }),
    ])
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/include_in_submission_packet=true AND required=true/)
  })

  test('blank document_role fails', function () {
    var result = isPacketConfigValid([validRow({ document_role: '   ' })])
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/document_role/)
  })

  test('blank display_name fails', function () {
    var result = isPacketConfigValid([validRow({ display_name: '' })])
    expect(result.valid).toBe(false)
    expect(result.reason).toMatch(/display_name/)
  })

  test('ordering is sort_order, then document_role', async function () {
    var rows = [
      validRow({ document_role: 'b_role', sort_order: 1 }),
      validRow({ document_role: 'a_role', sort_order: 1 }),
    ]
    var client = mockRequirementsClient(rows)
    var loaded = await loadPacketRequirements(client, 'ahj-xyz')
    expect(client.getEqAhjId()).toBe('ahj-xyz')
    expect(client.lastOrders).toEqual([
      { col: 'sort_order', opts: { ascending: true } },
      { col: 'document_role', opts: { ascending: true } },
    ])
    expect(loaded.length).toBe(2)
  })

  test('packet_config_missing.nonRetryable === true', function () {
    var err = packetConfigMissingError('ahj-1', 'test reason')
    expect(err.errorCode).toBe('packet_config_missing')
    expect(err.nonRetryable).toBe(true)
    expect(err.message).toMatch(/test reason/)
  })

  test('withRetry stops after one attempt for packet_config_missing', async function () {
    var attempts = 0
    await expect(
      withRetry(
        async function () {
          attempts += 1
          throw packetConfigMissingError('ahj-1', 'zero rows')
        },
        { maxAttempts: 3, delayMs: 1, label: 'packet-config-test' }
      )
    ).rejects.toMatchObject({ errorCode: 'packet_config_missing' })
    expect(attempts).toBe(1)
  })
})

describe('permit-packet integrates packet-config (ZIG-10)', function () {
  function mockPacketClient(opts) {
    var options = opts || {}
    var rpcCalls = []
    var requirementRows = options.requirementRows
    if (requirementRows === undefined) {
      requirementRows = [validRow({ ahj_id: 'ahj-1' })]
    }

    return {
      rpcCalls: rpcCalls,
      client: {
        rpc: async function (name, args) {
          rpcCalls.push({ name: name, args: args })
          if (options.rpcError) {
            return { data: null, error: options.rpcError }
          }
          return {
            data: {
              job_id: args.p_job_id,
              company_id: 'company-a',
              action_id: 'action-1',
              action_created: true,
              job_status: READY_FOR_PHYSICAL_SUBMISSION,
            },
            error: null,
          }
        },
        from: function (table) {
          if (table === 'ahj_document_requirements') {
            var chain = {
              select: function () {
                return chain
              },
              eq: function () {
                return chain
              },
              order: function () {
                return chain
              },
              then: function (resolve, reject) {
                return Promise.resolve({ data: requirementRows, error: null }).then(
                  resolve,
                  reject
                )
              },
            }
            return chain
          }
          return {
            update: function () {
              return {
                eq: async function () {
                  return { error: null }
                },
              }
            },
          }
        },
      },
    }
  }

  test('runPermitPacketSkeleton does not call the handoff RPC when config is invalid', async function () {
    var mock = mockPacketClient({ requirementRows: [] })
    await expect(
      runPermitPacketSkeleton(
        mock.client,
        { id: 'job-1', company_id: 'company-a', ahj_id: 'ahj-1' },
        { id: 'run-1', run_type: PERMIT_PACKET_RUN_TYPE }
      )
    ).rejects.toMatchObject({ errorCode: 'packet_config_missing', nonRetryable: true })
    expect(mock.rpcCalls.length).toBe(0)
  })
})
