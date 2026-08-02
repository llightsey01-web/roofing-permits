/**
 * Portal-exact intake enums for Accela re-roof permits (global / Option A).
 *
 * Assumes Lee County's Accela roofType dropdown matches Polk's five values —
 * same ASI block (AppSpecC11AD441Edit_* / ddl_3_2) observed in config, not yet
 * independently confirmed. Verify when Lee credentials are available before
 * running Lee Phase 2 automation against these stored values.
 */

const ROOF_TYPE_OPTIONS = [
  {
    value: 'Built-up',
    label: 'Built-up',
    hint: 'Low-slope built-up roofing (BUR)',
  },
  {
    value: 'Composition or Wood Shingles',
    label: 'Composition or Wood Shingles',
    hint: 'Asphalt shingle or wood shake',
  },
  {
    value: 'Metal',
    label: 'Metal',
    hint: 'Standing seam, metal panels, etc.',
  },
  {
    value: 'Tile',
    label: 'Tile',
    hint: 'Concrete or clay tile',
  },
  {
    value: 'TPO',
    label: 'TPO',
    hint: 'Single-ply membrane (flat/low-slope)',
  },
]

const WORK_TYPE_OPTIONS = [
  { value: 'New', label: 'New — full replacement' },
  { value: 'Repair', label: 'Repair' },
  { value: 'Addition', label: 'Addition' },
  { value: 'Alteration', label: 'Alteration' },
]

const ROOF_TYPE_VALUES = new Set(ROOF_TYPE_OPTIONS.map(function (o) { return o.value }))
const WORK_TYPE_VALUES = new Set(WORK_TYPE_OPTIONS.map(function (o) { return o.value }))

function isValidRoofType(value) {
  return ROOF_TYPE_VALUES.has(String(value || '').trim())
}

function isValidWorkType(value) {
  return WORK_TYPE_VALUES.has(String(value || '').trim())
}

function roofTypeLabel(value) {
  const match = ROOF_TYPE_OPTIONS.find(function (o) { return o.value === value })
  return match ? match.label : value
}

function workTypeLabel(value) {
  const match = WORK_TYPE_OPTIONS.find(function (o) { return o.value === value })
  return match ? match.label : value
}

module.exports = {
  ROOF_TYPE_OPTIONS,
  WORK_TYPE_OPTIONS,
  isValidRoofType,
  isValidWorkType,
  roofTypeLabel,
  workTypeLabel,
}
