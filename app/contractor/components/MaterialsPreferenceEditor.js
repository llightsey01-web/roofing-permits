'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  contractorTheme,
  contractorInputStyle,
  contractorPrimaryButtonStyle,
} from '../../../lib/ui/contractor-theme'

const LAYERS = [
  { key: 'primary', label: 'Primary Shingles' },
  { key: 'underlayment', label: 'Underlayment' },
  { key: 'ventilation', label: 'Ventilation' },
]

const emptyAddForm = {
  manufacturer: '',
  productName: '',
  flNumber: '',
  layerType: 'primary',
}

/**
 * Shared materials preference editor (portal page + onboarding).
 */
export default function MaterialsPreferenceEditor({
  getToken,
  initialSelected,
  onChange,
  showSaveButton,
  onSave,
  saveLabel,
  secondaryAction,
  compact,
}) {
  const [catalog, setCatalog] = useState([])
  const [selected, setSelected] = useState(initialSelected || { primary: [], underlayment: [], ventilation: [] })
  const [queries, setQueries] = useState({ primary: '', underlayment: '', ventilation: '' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [modalLayer, setModalLayer] = useState(null)
  const [addForm, setAddForm] = useState({ ...emptyAddForm })
  const [verifying, setVerifying] = useState(false)
  const [verifyMsg, setVerifyMsg] = useState('')

  useEffect(function () {
    if (initialSelected) setSelected(initialSelected)
  }, [initialSelected])

  useEffect(function () {
    if (typeof onChange === 'function') onChange(selected)
  }, [selected])

  useEffect(function () {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch('/api/contractor/products')
        const data = await res.json()
        if (!cancelled) setCatalog(data.products || [])
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return function () { cancelled = true }
  }, [])

  const byLayer = useMemo(function () {
    const map = { primary: [], underlayment: [], ventilation: [] }
    for (const p of catalog) {
      if (map[p.layer_type]) map[p.layer_type].push(p)
    }
    return map
  }, [catalog])

  function filterProducts(layer, q) {
    const list = byLayer[layer] || []
    const needle = (q || '').trim().toLowerCase()
    if (!needle) return list.slice(0, 40)
    return list
      .filter(function (p) {
        return (
          (p.product_name || '').toLowerCase().includes(needle) ||
          (p.manufacturer || '').toLowerCase().includes(needle) ||
          (p.approval_number || '').toLowerCase().includes(needle) ||
          (p.fl_approval_number || '').toLowerCase().includes(needle)
        )
      })
      .slice(0, 40)
  }

  function isSelected(layer, productId) {
    return (selected[layer] || []).some(function (p) { return p.id === productId })
  }

  function addProduct(layer, product) {
    setSelected(function (prev) {
      const list = prev[layer] || []
      if (list.some(function (p) { return p.id === product.id })) return prev
      return { ...prev, [layer]: list.concat([product]) }
    })
    setQueries(function (prev) { return { ...prev, [layer]: '' } })
    setMessage('')
    setError('')
  }

  function removeProduct(layer, productId) {
    setSelected(function (prev) {
      return {
        ...prev,
        [layer]: (prev[layer] || []).filter(function (p) { return p.id !== productId }),
      }
    })
  }

  function openAddModal(layer) {
    setModalLayer(layer)
    setAddForm({ ...emptyAddForm, layerType: layer })
    setVerifyMsg('')
    setError('')
  }

  async function handleVerifyAndAdd() {
    setVerifying(true)
    setVerifyMsg('Verifying ' + (addForm.flNumber || 'FL#') + ' on Florida Building Commission…')
    setError('')
    try {
      const token = await getToken()
      if (!token) throw new Error('Not authenticated')
      const res = await fetch('/api/contractor/products/verify-and-add', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({
          manufacturer: addForm.manufacturer,
          productName: addForm.productName,
          flNumber: addForm.flNumber,
          layerType: addForm.layerType || modalLayer,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.valid) {
        setVerifyMsg('')
        setError(data.error || 'FL number not found. Please check floridabuilding.org')
        return
      }
      setCatalog(function (prev) {
        if (prev.some(function (p) { return p.id === data.product.id })) return prev
        return prev.concat([data.product])
      })
      addProduct(modalLayer || data.product.layer_type, data.product)
      setVerifyMsg('✓ ' + data.product.manufacturer + ' ' + data.product.product_name + ' verified and added')
      setTimeout(function () {
        setModalLayer(null)
        setVerifyMsg('')
      }, 900)
    } catch (err) {
      setVerifyMsg('')
      setError(err.message)
    } finally {
      setVerifying(false)
    }
  }

  async function handleSave() {
    if (typeof onSave !== 'function') return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await onSave(selected)
      setMessage('Preferences saved')
    } catch (err) {
      setError(err.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const sectionStyle = {
    border: '1px solid ' + contractorTheme.border,
    borderRadius: '10px',
    padding: compact ? '14px' : '18px',
    marginBottom: '16px',
    backgroundColor: contractorTheme.accentSoft || 'rgba(15, 23, 42, 0.35)',
  }

  if (loading) {
    return <p style={{ color: contractorTheme.textMuted }}>Loading products…</p>
  }

  return (
    <div>
      {error ? (
        <div style={{
          marginBottom: '12px',
          padding: '10px 12px',
          borderRadius: '8px',
          background: 'rgba(239,68,68,0.12)',
          color: '#fca5a5',
          fontSize: '14px',
        }}>
          {error}
        </div>
      ) : null}
      {message ? (
        <div style={{
          marginBottom: '12px',
          padding: '10px 12px',
          borderRadius: '8px',
          background: 'rgba(34,197,94,0.12)',
          color: '#86efac',
          fontSize: '14px',
        }}>
          {message}
        </div>
      ) : null}

      {LAYERS.map(function (layer) {
        const matches = filterProducts(layer.key, queries[layer.key])
        const chosen = selected[layer.key] || []
        return (
          <div key={layer.key} style={sectionStyle}>
            <h3 style={{
              margin: '0 0 12px',
              fontSize: '15px',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
              color: contractorTheme.text,
            }}>
              {layer.label}
            </h3>

            <label style={{ display: 'block', fontSize: '13px', color: contractorTheme.textMuted, marginBottom: '6px' }}>
              Search and select product
            </label>
            <input
              style={contractorInputStyle()}
              value={queries[layer.key]}
              onChange={function (e) {
                setQueries(function (prev) { return { ...prev, [layer.key]: e.target.value } })
              }}
              placeholder="Type manufacturer, product, or FL#"
            />

            {queries[layer.key].trim() ? (
              <div style={{
                marginTop: '8px',
                maxHeight: '180px',
                overflowY: 'auto',
                border: '1px solid ' + contractorTheme.border,
                borderRadius: '8px',
                background: contractorTheme.bg || '#0f172a',
              }}>
                {matches.length === 0 ? (
                  <div style={{ padding: '10px 12px', color: contractorTheme.textMuted, fontSize: '13px' }}>
                    No matches
                  </div>
                ) : matches.map(function (p) {
                  const disabled = isSelected(layer.key, p.id)
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={disabled}
                      onClick={function () { addProduct(layer.key, p) }}
                      style={{
                        display: 'block',
                        width: '100%',
                        textAlign: 'left',
                        padding: '10px 12px',
                        border: 'none',
                        borderBottom: '1px solid ' + contractorTheme.border,
                        background: 'transparent',
                        color: disabled ? contractorTheme.textMuted : contractorTheme.text,
                        cursor: disabled ? 'default' : 'pointer',
                        fontSize: '13px',
                      }}
                    >
                      <strong>{p.product_name}</strong>
                      <span style={{ color: contractorTheme.textMuted }}> — {p.manufacturer} — {p.approval_number || p.fl_approval_number}</span>
                      <span style={{
                        marginLeft: '8px',
                        fontSize: '11px',
                        padding: '2px 6px',
                        borderRadius: '999px',
                        background: 'rgba(249,115,22,0.15)',
                        color: '#fdba74',
                      }}>
                        {p.layer_type}
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : null}

            <div style={{ marginTop: '12px' }}>
              <div style={{ fontSize: '12px', color: contractorTheme.textMuted, marginBottom: '6px' }}>
                Currently selected:
              </div>
              {chosen.length === 0 ? (
                <div style={{ fontSize: '13px', color: contractorTheme.textMuted }}>None yet</div>
              ) : chosen.map(function (p) {
                return (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '10px',
                      padding: '8px 0',
                      borderBottom: '1px solid ' + contractorTheme.border,
                      color: contractorTheme.textBody || contractorTheme.text,
                      fontSize: '14px',
                    }}
                  >
                    <span>
                      ✓ {p.manufacturer} {p.product_name}
                      <span style={{ color: contractorTheme.textMuted, marginLeft: '8px' }}>
                        {p.approval_number || p.fl_approval_number}
                      </span>
                    </span>
                    <button
                      type="button"
                      onClick={function () { removeProduct(layer.key, p.id) }}
                      style={{
                        background: 'transparent',
                        border: '1px solid ' + contractorTheme.border,
                        color: '#fca5a5',
                        borderRadius: '6px',
                        padding: '4px 8px',
                        cursor: 'pointer',
                        fontSize: '12px',
                      }}
                    >
                      Remove
                    </button>
                  </div>
                )
              })}
            </div>

            <button
              type="button"
              onClick={function () { openAddModal(layer.key) }}
              style={{
                marginTop: '12px',
                background: 'transparent',
                border: '1px dashed ' + contractorTheme.border,
                color: contractorTheme.accent || '#f97316',
                borderRadius: '8px',
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              + Add product not in list
            </button>
          </div>
        )
      })}

      {(showSaveButton || secondaryAction) ? (
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '8px' }}>
          {secondaryAction}
          {showSaveButton ? (
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              style={contractorPrimaryButtonStyle()}
            >
              {saving ? 'Saving…' : (saveLabel || 'Save Preferences')}
            </button>
          ) : null}
        </div>
      ) : null}

      {modalLayer ? (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(2,6,23,0.72)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 80,
          padding: '16px',
        }}>
          <div style={{
            width: '100%',
            maxWidth: '440px',
            background: '#0f172a',
            border: '1px solid ' + contractorTheme.border,
            borderRadius: '12px',
            padding: '20px',
            boxShadow: '0 20px 50px rgba(0,0,0,0.45)',
          }}>
            <h3 style={{ margin: '0 0 14px', color: contractorTheme.text }}>Add New Product</h3>
            <div style={{ display: 'grid', gap: '12px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px', color: contractorTheme.textMuted }}>Manufacturer</label>
                <input
                  style={contractorInputStyle()}
                  value={addForm.manufacturer}
                  onChange={function (e) { setAddForm(function (p) { return { ...p, manufacturer: e.target.value } }) }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px', color: contractorTheme.textMuted }}>Product Name</label>
                <input
                  style={contractorInputStyle()}
                  value={addForm.productName}
                  onChange={function (e) { setAddForm(function (p) { return { ...p, productName: e.target.value } }) }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px', color: contractorTheme.textMuted }}>FL Approval #</label>
                <input
                  style={contractorInputStyle()}
                  value={addForm.flNumber}
                  placeholder="e.g. FL10124-R36"
                  onChange={function (e) { setAddForm(function (p) { return { ...p, flNumber: e.target.value } }) }}
                />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '13px', marginBottom: '4px', color: contractorTheme.textMuted }}>Layer Type</label>
                <select
                  style={contractorInputStyle()}
                  value={addForm.layerType}
                  onChange={function (e) { setAddForm(function (p) { return { ...p, layerType: e.target.value } }) }}
                >
                  <option value="primary">Primary</option>
                  <option value="underlayment">Underlayment</option>
                  <option value="ventilation">Ventilation</option>
                </select>
              </div>
            </div>

            {verifyMsg ? (
              <p style={{ margin: '12px 0 0', color: '#86efac', fontSize: '13px' }}>{verifyMsg}</p>
            ) : null}

            <div style={{ display: 'flex', gap: '10px', marginTop: '16px' }}>
              <button
                type="button"
                disabled={verifying}
                onClick={handleVerifyAndAdd}
                style={contractorPrimaryButtonStyle()}
              >
                {verifying ? 'Verifying…' : 'Verify & Add'}
              </button>
              <button
                type="button"
                disabled={verifying}
                onClick={function () { setModalLayer(null) }}
                style={{
                  background: 'transparent',
                  border: '1px solid ' + contractorTheme.border,
                  color: contractorTheme.textMuted,
                  borderRadius: '8px',
                  padding: '10px 14px',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function selectedToPayload(selected) {
  const out = []
  for (const layer of ['primary', 'underlayment', 'ventilation']) {
    for (const p of selected[layer] || []) {
      out.push({
        productApprovalId: p.id,
        layerType: layer,
        isDefault: true,
      })
    }
  }
  return out
}

export function materialsResponseToSelected(materials) {
  const selected = { primary: [], underlayment: [], ventilation: [] }
  for (const m of materials || []) {
    const layer = m.layer_type
    const product = m.product || m.product_approvals
    if (!selected[layer] || !product) continue
    selected[layer].push({
      id: product.id,
      manufacturer: product.manufacturer,
      product_name: product.product_name,
      approval_number: product.approval_number || product.fl_approval_number,
      fl_approval_number: product.fl_approval_number,
      layer_type: product.layer_type || layer,
      preference_id: m.id,
    })
  }
  return selected
}
