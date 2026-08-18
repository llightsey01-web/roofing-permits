'use client'

import { useMemo, useRef, useState } from 'react'
import { createClient } from '../../../lib/supabase'
import { filterRows } from './lib/dashboard-view-model.js'
import AhjSummaryCards from './components/AhjSummaryCards.jsx'
import AhjTable from './components/AhjTable.jsx'
import AhjDetailDrawer from './components/AhjDetailDrawer.jsx'
import { adminTheme, adminPanelStyle } from '../../../lib/ui/admin-theme'

const EMPTY_FILTERS = {
  lifecycle: '',
  health: '',
  workflow_type: '',
  active: '',
  contractor_visible: '',
  worker_executable: '',
  pilot_ready: '',
  has_blocker: '',
}

function selectStyle() {
  return {
    background: adminTheme.surfaceRaised,
    color: adminTheme.text,
    border: '1px solid ' + adminTheme.border,
    borderRadius: '8px',
    padding: '8px 10px',
    fontSize: '12px',
    fontFamily: adminTheme.fontMono,
  }
}

export default function AhjDashboardClient({ initialRows, credentialScopeNote }) {
  const [query, setQuery] = useState('')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [selectedId, setSelectedId] = useState(null)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [detailRow, setDetailRow] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')
  const lastTriggerRef = useRef(null)

  const filtered = useMemo(
    function () {
      return filterRows(initialRows || [], query, filters)
    },
    [initialRows, query, filters]
  )

  function updateFilter(key, value) {
    setFilters(function (prev) {
      return Object.assign({}, prev, { [key]: value })
    })
  }

  async function openDetail(row, eventTarget) {
    lastTriggerRef.current = eventTarget || null
    setSelectedId(row && row.id)
    setDrawerOpen(true)
    setDetailRow(row || null)
    setDetailError('')
    setDetailLoading(true)
    try {
      const supabase = createClient()
      const {
        data: { session },
      } = await supabase.auth.getSession()
      if (!session) {
        setDetailError('Session expired. Sign in again.')
        setDetailLoading(false)
        return
      }
      const res = await fetch('/api/admin/ahjs/' + encodeURIComponent(row.id), {
        headers: { Authorization: 'Bearer ' + session.access_token },
      })
      const payload = await res.json().catch(function () {
        return {}
      })
      if (!res.ok) {
        setDetailError(payload.error || 'Failed to load AHJ detail')
      } else if (payload.ahj) {
        setDetailRow(payload.ahj)
      }
    } catch (err) {
      setDetailError((err && err.message) || 'Failed to load AHJ detail')
    }
    setDetailLoading(false)
  }

  function closeDrawer() {
    setDrawerOpen(false)
    setSelectedId(null)
    setDetailError('')
  }

  return (
    <div style={{ padding: '20px 22px 40px' }}>
      <header style={{ marginBottom: '18px' }}>
        <h1 style={{ margin: 0, fontSize: '22px', color: adminTheme.text }}>AHJ Validation & Pilot Readiness</h1>
        <p style={{ margin: '8px 0 0', color: adminTheme.textMuted, fontSize: '13px', maxWidth: '720px' }}>
          Read-only dashboard derived from ZIG-6 readiness and PR A aggregation. Filtering is in-memory.
        </p>
        {credentialScopeNote ? (
          <p
            style={{
              margin: '10px 0 0',
              color: adminTheme.textDim,
              fontSize: '12px',
              fontFamily: adminTheme.fontMono,
            }}
          >
            {credentialScopeNote}
          </p>
        ) : null}
      </header>

      <AhjSummaryCards rows={initialRows || []} />

      <div style={{ ...adminPanelStyle(), marginBottom: '14px', padding: '14px' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(180px, 1.4fr) repeat(auto-fit, minmax(140px, 1fr))',
            gap: '10px',
          }}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', color: adminTheme.textDim }}>
            Search name / jurisdiction
            <input
              type="search"
              value={query}
              onChange={function (event) {
                setQuery(event.target.value)
              }}
              placeholder="Search AHJs"
              style={selectStyle()}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', color: adminTheme.textDim }}>
            Lifecycle
            <select
              value={filters.lifecycle}
              onChange={function (e) {
                updateFilter('lifecycle', e.target.value)
              }}
              style={selectStyle()}
            >
              <option value="">All</option>
              <option value="planned">planned</option>
              <option value="development">development</option>
              <option value="validation_ready">validation_ready</option>
              <option value="dry_run">dry_run</option>
              <option value="pilot">pilot</option>
              <option value="production">production</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', color: adminTheme.textDim }}>
            Health
            <select
              value={filters.health}
              onChange={function (e) {
                updateFilter('health', e.target.value)
              }}
              style={selectStyle()}
            >
              <option value="">All</option>
              <option value="healthy">healthy</option>
              <option value="degraded">degraded</option>
              <option value="unavailable">unavailable</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', color: adminTheme.textDim }}>
            Workflow
            <select
              value={filters.workflow_type}
              onChange={function (e) {
                updateFilter('workflow_type', e.target.value)
              }}
              style={selectStyle()}
            >
              <option value="">All</option>
              <option value="portal">portal</option>
              <option value="pdf_packet">pdf_packet</option>
              <option value="hybrid">hybrid</option>
              <option value="email">email</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', color: adminTheme.textDim }}>
            Active
            <select
              value={filters.active}
              onChange={function (e) {
                updateFilter('active', e.target.value)
              }}
              style={selectStyle()}
            >
              <option value="">All</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', color: adminTheme.textDim }}>
            Contractor visible
            <select
              value={filters.contractor_visible}
              onChange={function (e) {
                updateFilter('contractor_visible', e.target.value)
              }}
              style={selectStyle()}
            >
              <option value="">All</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', color: adminTheme.textDim }}>
            Worker executable
            <select
              value={filters.worker_executable}
              onChange={function (e) {
                updateFilter('worker_executable', e.target.value)
              }}
              style={selectStyle()}
            >
              <option value="">All</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', color: adminTheme.textDim }}>
            Pilot ready
            <select
              value={filters.pilot_ready}
              onChange={function (e) {
                updateFilter('pilot_ready', e.target.value)
              }}
              style={selectStyle()}
            >
              <option value="">All</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '11px', color: adminTheme.textDim }}>
            Has blocker
            <select
              value={filters.has_blocker}
              onChange={function (e) {
                updateFilter('has_blocker', e.target.value)
              }}
              style={selectStyle()}
            >
              <option value="">All</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
        </div>
        <div style={{ marginTop: '10px', color: adminTheme.textDim, fontSize: '11px', fontFamily: adminTheme.fontMono }}>
          Showing {filtered.length} of {(initialRows || []).length} AHJs
        </div>
      </div>

      <AhjTable
        rows={filtered}
        selectedId={selectedId}
        onOpenDetail={function (row) {
          openDetail(row, document.activeElement)
        }}
      />

      <AhjDetailDrawer
        open={drawerOpen}
        loading={detailLoading}
        error={detailError}
        row={detailRow}
        onClose={closeDrawer}
        returnFocusRef={lastTriggerRef}
      />
    </div>
  )
}
