// tests/unit/packet-fingerprint.test.js
// ZIG-17 PR 4 Phase B: canonical packet fingerprints — no Storage, no RPC
'use strict'

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const {
  ERROR_CODE,
  canonicalJson,
  sha256Hex,
  buildInputDocument,
  inputFingerprint,
  contentFingerprint,
  buildStoredFingerprint,
  fingerprintsEqual,
} = require('../../lib/permits/packet-fingerprint.js')

var MODULE_SRC = fs.readFileSync(
  path.join(__dirname, '../../lib/permits/packet-fingerprint.js'),
  'utf8'
)

function requirement(overrides) {
  return Object.assign(
    {
      id: 'req-a',
      ahj_id: 'ahj-1',
      sort_order: 10,
      document_role: 'product_approval',
      source_type: 'contractor_uploaded',
      required: true,
      include_in_submission_packet: true,
      template_storage_path: null,
      field_map: null,
    },
    overrides || {}
  )
}

function artifact(overrides) {
  return Object.assign(
    {
      documentId: 'doc-a',
      documentType: 'product_approval',
      filePath: 'jobs/job-1/a.pdf',
      bytes: Buffer.from('pdf-a'),
    },
    overrides || {}
  )
}

function entry(overrides) {
  var data = overrides || {}
  return {
    ahjId: data.ahjId || 'ahj-1',
    requirement: requirement(data.requirement),
    resolvedValues: data.resolvedValues != null ? data.resolvedValues : {},
    artifact: artifact(data.artifact),
  }
}

function dartFieldMap() {
  return {
    fields: [
      { pdfField: 'Owner', source: 'job.owner_name', type: 'text', required: true },
      { pdfField: 'City', source: 'job.property_city', type: 'text', required: true },
    ],
  }
}

describe('packet-fingerprint', function () {
  describe('canonicalization', function () {
    test('object key order does not change canonical JSON/hash', function () {
      var a = canonicalJson({ b: 1, a: 2 })
      var b = canonicalJson({ a: 2, b: 1 })
      expect(a).toBe('{"a":2,"b":1}')
      expect(b).toBe(a)
      expect(sha256Hex(a)).toBe(sha256Hex(b))
    })

    test('nested object keys are stable', function () {
      var json = canonicalJson({
        z: { b: true, a: { d: 1, c: 2 } },
        y: [ { k: 2, j: 1 } ],
      })
      expect(json).toBe('{"y":[{"j":1,"k":2}],"z":{"a":{"c":2,"d":1},"b":true}}')
    })

    test('arrays preserve order', function () {
      expect(canonicalJson(['b', 'a'])).toBe('["b","a"]')
      expect(canonicalJson(['a', 'b'])).toBe('["a","b"]')
    })

    test('original input is not mutated', function () {
      var input = { z: 1, a: [ { b: 2, a: 1 } ] }
      var snapshot = JSON.stringify(input)
      canonicalJson(input)
      expect(JSON.stringify(input)).toBe(snapshot)
      expect(Object.keys(input)).toEqual(['z', 'a'])
    })

    test('invalid values fail closed with packet_fingerprint_invalid', function () {
      function expectInvalid(value) {
        try {
          canonicalJson(value)
          throw new Error('expected throw')
        } catch (err) {
          expect(err.errorCode).toBe(ERROR_CODE)
        }
      }
      expectInvalid(undefined)
      expectInvalid(NaN)
      expectInvalid(Infinity)
      expectInvalid(-Infinity)
      expectInvalid(BigInt(1))
      expectInvalid(function () {})
      expectInvalid(Symbol('x'))
      var circular = {}
      circular.self = circular
      expectInvalid(circular)
      expectInvalid({ a: undefined })
      expectInvalid([undefined])
      expectInvalid(new Date())
      expectInvalid(Buffer.from('x'))
    })
  })

  describe('ordering authority', function () {
    test('[A, B] and [B, A] yield different input_fingerprint', function () {
      var a = entry({
        requirement: { id: 'req-a', document_role: 'product_approval', sort_order: 10 },
        artifact: { documentId: 'doc-a', bytes: Buffer.from('A') },
      })
      var b = entry({
        requirement: {
          id: 'req-b',
          document_role: 'site_plan',
          sort_order: 20,
          source_type: 'human_obtained',
        },
        artifact: {
          documentId: 'doc-b',
          documentType: 'site_plan',
          filePath: 'jobs/job-1/b.pdf',
          bytes: Buffer.from('B'),
        },
      })
      var ab = inputFingerprint([a, b])
      var ba = inputFingerprint([b, a])
      expect(ab).toMatch(/^[0-9a-f]{64}$/)
      expect(ba).toMatch(/^[0-9a-f]{64}$/)
      expect(ab).not.toBe(ba)
      expect(buildInputDocument([a, b]).requirements.map(function (r) {
        return r.requirement_id
      })).toEqual(['req-a', 'req-b'])
      expect(buildInputDocument([b, a]).requirements.map(function (r) {
        return r.requirement_id
      })).toEqual(['req-b', 'req-a'])
    })

    test('module source does not independently sort requirements/entries', function () {
      expect(MODULE_SRC).not.toMatch(/orderedEntries\s*\.sort\s*\(/)
      expect(MODULE_SRC).not.toMatch(/requirements\s*\.sort\s*\(/)
      expect(MODULE_SRC).not.toMatch(/entries\s*\.sort\s*\(/)
      expect(MODULE_SRC).toMatch(/Object\.keys\(value\)\.sort\(\)/)
    })

    test('sort_order changing changes hash but does not rearrange output array', function () {
      var first = entry({
        requirement: { id: 'req-a', sort_order: 10, document_role: 'product_approval' },
      })
      var second = entry({
        requirement: {
          id: 'req-b',
          sort_order: 20,
          document_role: 'site_plan',
          source_type: 'human_obtained',
        },
        artifact: {
          documentId: 'doc-b',
          documentType: 'site_plan',
          filePath: 'jobs/job-1/b.pdf',
          bytes: Buffer.from('pdf-b'),
        },
      })
      var baseline = inputFingerprint([first, second])
      var reorderedIdentity = entry({
        requirement: { id: 'req-a', sort_order: 99, document_role: 'product_approval' },
      })
      var doc = buildInputDocument([reorderedIdentity, second])
      expect(doc.requirements.map(function (r) {
        return r.requirement_id
      })).toEqual(['req-a', 'req-b'])
      expect(doc.requirements[0].sort_order).toBe(99)
      expect(inputFingerprint([reorderedIdentity, second])).not.toBe(baseline)
    })
  })

  describe('effective fields only', function () {
    test('irrelevant resolvedValues keys do not affect fingerprint', function () {
      var map = dartFieldMap()
      var base = entry({
        requirement: {
          id: 'req-gen',
          source_type: 'dart_generated',
          document_role: 'permit_application',
          template_storage_path: 'templates/app.pdf',
          field_map: map,
        },
        resolvedValues: {
          'job.owner_name': 'Ada',
          'job.property_city': 'Lakeland',
        },
        artifact: {
          documentId: 'doc-gen',
          documentType: 'permit_application',
          filePath: 'jobs/job-1/gen.pdf',
          bytes: Buffer.from('gen'),
        },
      })
      var extra = entry({
        requirement: base.requirement,
        resolvedValues: {
          'job.owner_name': 'Ada',
          'job.property_city': 'Lakeland',
          'job.valuation': '999999',
          'company.notes': 'ignore me',
        },
        artifact: base.artifact,
      })
      expect(inputFingerprint([base])).toBe(inputFingerprint([extra]))
      var doc = buildInputDocument([extra])
      expect(doc.requirements[0].resolved_values).toEqual({
        'job.owner_name': 'Ada',
        'job.property_city': 'Lakeland',
      })
      expect(doc.requirements[0].resolved_values['job.valuation']).toBeUndefined()
    })

    test('changing a referenced resolved value changes fingerprint', function () {
      var map = dartFieldMap()
      function withOwner(name) {
        return entry({
          requirement: {
            id: 'req-gen',
            source_type: 'dart_generated',
            document_role: 'permit_application',
            template_storage_path: 'templates/app.pdf',
            field_map: map,
          },
          resolvedValues: {
            'job.owner_name': name,
            'job.property_city': 'Lakeland',
          },
          artifact: {
            documentId: 'doc-gen',
            documentType: 'permit_application',
            filePath: 'jobs/job-1/gen.pdf',
            bytes: Buffer.from('gen'),
          },
        })
      }
      expect(inputFingerprint([withOwner('Ada')])).not.toBe(inputFingerprint([withOwner('Bob')]))
    })

    test('missing referenced value is represented as null, not omitted', function () {
      var map = dartFieldMap()
      var doc = buildInputDocument([
        entry({
          requirement: {
            id: 'req-gen',
            source_type: 'dart_generated',
            document_role: 'permit_application',
            template_storage_path: 'templates/app.pdf',
            field_map: map,
          },
          resolvedValues: { 'job.owner_name': 'Ada' },
          artifact: {
            documentId: 'doc-gen',
            documentType: 'permit_application',
            filePath: 'jobs/job-1/gen.pdf',
            bytes: Buffer.from('gen'),
          },
        }),
      ])
      expect(Object.prototype.hasOwnProperty.call(doc.requirements[0].resolved_values, 'job.property_city')).toBe(
        true
      )
      expect(doc.requirements[0].resolved_values['job.property_city']).toBeNull()
      expect(doc.requirements[0].resolved_values['job.owner_name']).toBe('Ada')
    })
  })

  describe('artifact content', function () {
    test('changing artifact bytes changes per-artifact hash and input fingerprint', function () {
      var a = entry({ artifact: { bytes: Buffer.from('pdf-one') } })
      var b = entry({ artifact: { bytes: Buffer.from('pdf-two') } })
      var docA = buildInputDocument([a])
      var docB = buildInputDocument([b])
      expect(docA.requirements[0].artifact.content_sha256).toBe(
        crypto.createHash('sha256').update(Buffer.from('pdf-one')).digest('hex')
      )
      expect(docA.requirements[0].artifact.content_sha256).not.toBe(
        docB.requirements[0].artifact.content_sha256
      )
      expect(inputFingerprint([a])).not.toBe(inputFingerprint([b]))
    })

    test('metadata not in the contract does not affect fingerprint', function () {
      var a = entry({
        artifact: { bytes: Buffer.from('same'), filePath: 'jobs/job-1/a.pdf' },
      })
      a.artifact.uploadedAt = '2026-01-01T00:00:00.000Z'
      a.artifact.fileSizeBytes = 99
      a.requirement.display_name = 'Changed label'
      a.requirement.notes = 'operator note'
      var b = entry({
        artifact: { bytes: Buffer.from('same'), filePath: 'jobs/job-1/a.pdf' },
      })
      expect(inputFingerprint([a])).toBe(inputFingerprint([b]))
    })
  })

  describe('packet content', function () {
    test('changing merged packet bytes changes content_fingerprint only', function () {
      var ordered = [entry()]
      var inputHash = inputFingerprint(ordered)
      var contentA = contentFingerprint(Buffer.from('%PDF-packet-a'))
      var contentB = contentFingerprint(Buffer.from('%PDF-packet-b'))
      expect(contentA).not.toBe(contentB)
      expect(inputFingerprint(ordered)).toBe(inputHash)
    })
  })

  describe('envelope', function () {
    test('stores version, normalized computed_at, ordered artifacts, and 64-char hashes', function () {
      var a = entry({
        requirement: { id: 'req-a', sort_order: 10 },
        artifact: { documentId: 'doc-a', bytes: Buffer.from('A') },
      })
      var b = entry({
        requirement: {
          id: 'req-b',
          sort_order: 20,
          document_role: 'site_plan',
          source_type: 'human_obtained',
        },
        artifact: {
          documentId: 'doc-b',
          documentType: 'site_plan',
          filePath: 'jobs/job-1/b.pdf',
          bytes: Buffer.from('B'),
        },
      })
      var envelope = buildStoredFingerprint({
        orderedEntries: [a, b],
        submissionPacketBytes: Buffer.from('%PDF-merged'),
        computedAt: new Date('2026-08-20T17:00:00.000Z'),
      })
      expect(envelope.version).toBe(1)
      expect(envelope.computed_at).toBe('2026-08-20T17:00:00.000Z')
      expect(envelope.input_fingerprint).toMatch(/^[0-9a-f]{64}$/)
      expect(envelope.content_fingerprint).toMatch(/^[0-9a-f]{64}$/)
      expect(envelope.input_fingerprint).toBe(inputFingerprint([a, b]))
      expect(envelope.content_fingerprint).toBe(contentFingerprint(Buffer.from('%PDF-merged')))
      expect(envelope.artifacts.map(function (row) {
        return row.requirement_id
      })).toEqual(['req-a', 'req-b'])
      expect(envelope.artifacts[0].document_id).toBe('doc-a')
      expect(envelope.artifacts[0].content_sha256).toBe(
        crypto.createHash('sha256').update(Buffer.from('A')).digest('hex')
      )
    })

    test('ISO string computedAt is normalized; invalid timestamps fail closed', function () {
      var ordered = [entry()]
      var bytes = Buffer.from('%PDF-x')
      expect(
        buildStoredFingerprint({
          orderedEntries: ordered,
          submissionPacketBytes: bytes,
          computedAt: '2026-08-20T13:00:00-04:00',
        }).computed_at
      ).toBe('2026-08-20T17:00:00.000Z')
      expect(function () {
        buildStoredFingerprint({
          orderedEntries: ordered,
          submissionPacketBytes: bytes,
          computedAt: 'not-a-date',
        })
      }).toThrow(/packet_fingerprint_invalid/)
      expect(function () {
        buildStoredFingerprint({
          orderedEntries: [],
          submissionPacketBytes: bytes,
          computedAt: new Date(),
        })
      }).toThrow(/non-empty array/)
    })
  })

  describe('equality', function () {
    test('same input/content hashes with different computed_at are equal', function () {
      var ordered = [entry()]
      var bytes = Buffer.from('%PDF-same')
      var a = buildStoredFingerprint({
        orderedEntries: ordered,
        submissionPacketBytes: bytes,
        computedAt: '2026-01-01T00:00:00.000Z',
      })
      var b = buildStoredFingerprint({
        orderedEntries: ordered,
        submissionPacketBytes: bytes,
        computedAt: '2026-12-31T23:59:59.000Z',
      })
      expect(a.computed_at).not.toBe(b.computed_at)
      expect(fingerprintsEqual(a, b)).toBe(true)
    })

    test('different input hash is not equal', function () {
      var bytes = Buffer.from('%PDF-same')
      var a = buildStoredFingerprint({
        orderedEntries: [entry({ artifact: { bytes: Buffer.from('one') } })],
        submissionPacketBytes: bytes,
        computedAt: new Date('2026-01-01T00:00:00.000Z'),
      })
      var b = buildStoredFingerprint({
        orderedEntries: [entry({ artifact: { bytes: Buffer.from('two') } })],
        submissionPacketBytes: bytes,
        computedAt: new Date('2026-01-01T00:00:00.000Z'),
      })
      expect(fingerprintsEqual(a, b)).toBe(false)
    })

    test('different content hash is not equal', function () {
      var ordered = [entry()]
      var a = buildStoredFingerprint({
        orderedEntries: ordered,
        submissionPacketBytes: Buffer.from('%PDF-a'),
        computedAt: new Date('2026-01-01T00:00:00.000Z'),
      })
      var b = buildStoredFingerprint({
        orderedEntries: ordered,
        submissionPacketBytes: Buffer.from('%PDF-b'),
        computedAt: new Date('2026-01-01T00:00:00.000Z'),
      })
      expect(a.input_fingerprint).toBe(b.input_fingerprint)
      expect(fingerprintsEqual(a, b)).toBe(false)
    })

    test('malformed inputs return false', function () {
      var good = buildStoredFingerprint({
        orderedEntries: [entry()],
        submissionPacketBytes: Buffer.from('%PDF-x'),
        computedAt: new Date('2026-01-01T00:00:00.000Z'),
      })
      expect(fingerprintsEqual(null, good)).toBe(false)
      expect(fingerprintsEqual(good, {})).toBe(false)
      expect(fingerprintsEqual({ version: 1 }, good)).toBe(false)
      expect(
        fingerprintsEqual(
          Object.assign({}, good, { input_fingerprint: 'abc' }),
          good
        )
      ).toBe(false)
    })
  })

  test('inconsistent ahj_id fails closed', function () {
    expect(function () {
      buildInputDocument([
        entry({ ahjId: 'ahj-1' }),
        entry({
          ahjId: 'ahj-2',
          requirement: { id: 'req-b', document_role: 'site_plan' },
          artifact: { documentId: 'doc-b', documentType: 'site_plan', filePath: 'b.pdf' },
        }),
      ])
    }).toThrow(/ahj_id must be consistent/)
  })
})
