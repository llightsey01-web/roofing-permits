// tests/unit/workflow-type-dispatch.test.js
// ZIG-8: type-first dispatch + unsupported_workflow_type non-retryable
'use strict'

const {
  selectExecutionFamily,
  unsupportedWorkflowTypeError,
  dispatchByWorkflowType,
  PORTAL_FAMILY,
  PDF_PACKET_FAMILY,
  UNSUPPORTED_FAMILY,
} = require('../../lib/automation/workflow-type-dispatch.js')
const { withRetry } = require('../../lib/automation/retry.js')
const {
  PERMIT_RUN_TYPES,
  isPermitWorkerRunType,
  PERMIT_PACKET_RUN_TYPE,
  PORTAL_PERMIT_RUN_TYPES,
} = require('../../lib/automation/permit-run-types.js')
const { workerCanExecuteAhj } = require('../../lib/ahj/ahj-readiness.js')

describe('workflow-type-dispatch (ZIG-8)', function () {
  test('portal family maps to portal', function () {
    expect(selectExecutionFamily('portal')).toBe(PORTAL_FAMILY)
  })

  test('pdf_packet family maps to pdf_packet', function () {
    expect(selectExecutionFamily('pdf_packet')).toBe(PDF_PACKET_FAMILY)
  })

  test('hybrid / email / unknown / missing map to unsupported', function () {
    expect(selectExecutionFamily('hybrid')).toBe(UNSUPPORTED_FAMILY)
    expect(selectExecutionFamily('email')).toBe(UNSUPPORTED_FAMILY)
    expect(selectExecutionFamily('api')).toBe(UNSUPPORTED_FAMILY)
    expect(selectExecutionFamily(null)).toBe(UNSUPPORTED_FAMILY)
    expect(selectExecutionFamily(undefined)).toBe(UNSUPPORTED_FAMILY)
    expect(selectExecutionFamily('')).toBe(UNSUPPORTED_FAMILY)
  })

  test('unsupportedWorkflowTypeError is non-retryable with exact errorCode', function () {
    var err = unsupportedWorkflowTypeError('hybrid')
    expect(err.errorCode).toBe('unsupported_workflow_type')
    expect(err.nonRetryable).toBe(true)
    expect(String(err.message)).toMatch(/hybrid/)
  })

  test('portal dispatch invokes portal handler only (regression)', async function () {
    var portalCalls = 0
    var packetCalls = 0
    var ahj = {
      workflow_type: 'portal',
      workflow_file: 'polk-county.runner.js',
      name: 'Polk',
    }
    await dispatchByWorkflowType(ahj, { id: 'j1' }, { id: 'r1' }, 'r1', {
      runPortalWorkflowByFile: async function () {
        portalCalls += 1
      },
      runPermitPacketSkeleton: async function () {
        packetCalls += 1
      },
    })
    expect(portalCalls).toBe(1)
    expect(packetCalls).toBe(0)
  })

  test('pdf_packet never calls portal/Playwright handler', async function () {
    var portalCalls = 0
    var packetCalls = 0
    var ahj = {
      workflow_type: 'pdf_packet',
      workflow_file: null,
      name: 'Packet AHJ',
    }
    await dispatchByWorkflowType(ahj, { id: 'j1', company_id: 'c1' }, { id: 'r1', run_type: 'permit_packet' }, 'r1', {
      runPortalWorkflowByFile: async function () {
        portalCalls += 1
        throw new Error('Playwright loader must not run for pdf_packet')
      },
      runPermitPacketSkeleton: async function () {
        packetCalls += 1
        return { ok: true }
      },
    })
    expect(packetCalls).toBe(1)
    expect(portalCalls).toBe(0)
  })

  test('hybrid fails closed with unsupported_workflow_type', async function () {
    await expect(
      dispatchByWorkflowType(
        { workflow_type: 'hybrid' },
        { id: 'j1' },
        { id: 'r1' },
        'r1',
        {
          runPortalWorkflowByFile: async function () {},
          runPermitPacketSkeleton: async function () {},
        }
      )
    ).rejects.toMatchObject({ errorCode: 'unsupported_workflow_type', nonRetryable: true })
  })

  test('email fails closed with unsupported_workflow_type', async function () {
    await expect(
      dispatchByWorkflowType(
        { workflow_type: 'email' },
        { id: 'j1' },
        { id: 'r1' },
        'r1',
        {
          runPortalWorkflowByFile: async function () {},
          runPermitPacketSkeleton: async function () {},
        }
      )
    ).rejects.toMatchObject({ errorCode: 'unsupported_workflow_type', nonRetryable: true })
  })

  test('unknown workflow type fails closed with unsupported_workflow_type', async function () {
    await expect(
      dispatchByWorkflowType(
        { workflow_type: 'fax' },
        { id: 'j1' },
        { id: 'r1' },
        'r1',
        {
          runPortalWorkflowByFile: async function () {},
          runPermitPacketSkeleton: async function () {},
        }
      )
    ).rejects.toMatchObject({ errorCode: 'unsupported_workflow_type', nonRetryable: true })
  })

  test('unsupported_workflow_type is non-retryable via withRetry', async function () {
    var calls = 0
    await expect(
      withRetry(
        async function () {
          calls += 1
          throw unsupportedWorkflowTypeError('email')
        },
        { maxAttempts: 3, delayMs: 1, label: 'zig8_unsupported' }
      )
    ).rejects.toMatchObject({ errorCode: 'unsupported_workflow_type' })
    expect(calls).toBe(1)
  })

  test('ZIG-6 readiness still applies to executable pdf_packet AHJs', function () {
    expect(
      workerCanExecuteAhj({
        is_active: true,
        lifecycle_state: 'production',
        operational_health: 'healthy',
        workflow_type: 'pdf_packet',
        workflow_file: null,
      })
    ).toBe(true)
    expect(
      workerCanExecuteAhj({
        is_active: false,
        lifecycle_state: 'production',
        operational_health: 'healthy',
        workflow_type: 'pdf_packet',
        workflow_file: null,
      })
    ).toBe(false)
  })

  test('permit worker claim allowlist includes permit_packet and portal types', function () {
    PORTAL_PERMIT_RUN_TYPES.forEach(function (t) {
      expect(isPermitWorkerRunType(t)).toBe(true)
    })
    expect(isPermitWorkerRunType(PERMIT_PACKET_RUN_TYPE)).toBe(true)
    expect(isPermitWorkerRunType(null)).toBe(true)
    expect(isPermitWorkerRunType('build_packet')).toBe(false)
    expect(PERMIT_RUN_TYPES).toContain('permit_packet')
    expect(PERMIT_RUN_TYPES.filter(function (t) { return t === 'permit_packet' }).length).toBe(1)
  })
})
