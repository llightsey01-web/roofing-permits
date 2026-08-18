'use client'

import { useEffect, useId, useRef } from 'react'
import {
  configDisplay,
  display,
  formatTimestamp,
  jurisdictionLabel,
  workflowLabel,
} from '../lib/dashboard-view-model.js'
import AhjLifecycleBadge from './AhjLifecycleBadge.jsx'
import AhjHealthBadge from './AhjHealthBadge.jsx'
import AhjCredentialStatus from './AhjCredentialStatus.jsx'
import AhjPacketStatus from './AhjPacketStatus.jsx'
import AhjBlockerDisplay from './AhjBlockerDisplay.jsx'
import AhjPilotChecklist from './AhjPilotChecklist.jsx'
import { adminTheme, adminPanelStyle } from '../../../../lib/ui/admin-theme'

function Section({ title, children }) {
  return (
    <section style={{ marginBottom: '18px' }}>
      <h3
        style={{
          margin: '0 0 8px',
          fontSize: '12px',
          color: adminTheme.textDim,
          fontFamily: adminTheme.fontMono,
          letterSpacing: '0.04em',
          textTransform: 'uppercase',
        }}
      >
        {title}
      </h3>
      {children}
    </section>
  )
}

export default function AhjDetailDrawer({
  open,
  loading,
  error,
  row,
  onClose,
  returnFocusRef,
}) {
  const titleId = useId()
  const closeRef = useRef(null)

  useEffect(
    function () {
      if (!open) return undefined
      var previous = document.activeElement
      var returnNode = returnFocusRef && returnFocusRef.current
      if (closeRef.current) closeRef.current.focus()

      function onKeyDown(event) {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }
      window.addEventListener('keydown', onKeyDown)
      return function () {
        window.removeEventListener('keydown', onKeyDown)
        if (returnNode && returnNode.focus) {
          returnNode.focus()
        } else if (previous && previous.focus) {
          previous.focus()
        }
      }
    },
    [open, onClose, returnFocusRef]
  )

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        justifyContent: 'flex-end',
        background: 'rgba(2,6,23,0.55)',
      }}
      onClick={function (event) {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <aside
        style={{
          ...adminPanelStyle(),
          width: 'min(480px, 100%)',
          height: '100%',
          overflowY: 'auto',
          borderRadius: 0,
          borderLeft: '1px solid ' + adminTheme.border,
          padding: '18px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', marginBottom: '16px' }}>
          <div>
            <h2 id={titleId} style={{ margin: 0, fontSize: '18px', color: adminTheme.text }}>
              {display(row && row.name, 'AHJ detail')}
            </h2>
            <div style={{ color: adminTheme.textMuted, fontSize: '13px', marginTop: '4px' }}>
              {row ? jurisdictionLabel(row) : '—'}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close AHJ detail"
            style={{
              border: '1px solid ' + adminTheme.border,
              background: 'transparent',
              color: adminTheme.text,
              borderRadius: '8px',
              padding: '6px 10px',
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>

        {loading ? (
          <p style={{ color: adminTheme.textMuted, fontFamily: adminTheme.fontMono, fontSize: '12px' }}>
            Loading detail…
          </p>
        ) : null}
        {error ? (
          <p role="alert" style={{ color: adminTheme.danger, fontSize: '13px' }}>
            {error}
          </p>
        ) : null}

        {row ? (
          <>
            <Section title="Header">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '8px' }}>
                <AhjLifecycleBadge lifecycle={row.lifecycle_state} />
                <AhjHealthBadge health={row.operational_health} />
                <span style={{ fontFamily: adminTheme.fontMono, fontSize: '12px', color: adminTheme.textMuted }}>
                  Active: {row.is_active === true ? 'Yes' : 'No'}
                </span>
              </div>
              <div style={{ fontSize: '13px', color: adminTheme.textMuted }}>
                Workflow: {workflowLabel(row.workflow_type)} · Submission: {display(row.submission_method)}
              </div>
            </Section>

            <Section title="Readiness">
              <p style={{ margin: '0 0 8px', fontSize: '13px' }}>
                Contractor visible: <strong>{row.contractor_visible ? 'Yes' : 'No'}</strong>
              </p>
              <ul style={{ margin: '0 0 12px', paddingLeft: '18px', color: adminTheme.textMuted, fontSize: '12px' }}>
                {(row.contractor_visibility_reasons || []).map(function (reason, idx) {
                  return <li key={'c-' + idx}>{reason}</li>
                })}
              </ul>
              <p style={{ margin: '0 0 8px', fontSize: '13px' }}>
                Worker executable: <strong>{row.worker_executable ? 'Yes' : 'No'}</strong>
              </p>
              <ul style={{ margin: 0, paddingLeft: '18px', color: adminTheme.textMuted, fontSize: '12px' }}>
                {(row.worker_execution_reasons || []).map(function (reason, idx) {
                  return <li key={'w-' + idx}>{reason}</li>
                })}
              </ul>
            </Section>

            <Section title="Pilot checklist">
              <AhjPilotChecklist items={row.pilot_checklist} pilotReady={row.pilot_ready === true} />
            </Section>

            <Section title="Blockers">
              <AhjBlockerDisplay primaryBlocker={row.primary_blocker} allBlockers={row.all_blockers} />
            </Section>

            <Section title="Configuration">
              <div style={{ fontSize: '13px', marginBottom: '8px' }}>
                Config: <code>{configDisplay(row).label}</code>
              </div>
              {(configDisplay(row).reasons || []).length ? (
                <ul style={{ margin: '0 0 10px', paddingLeft: '18px', color: adminTheme.textMuted, fontSize: '12px' }}>
                  {configDisplay(row).reasons.map(function (reason, idx) {
                    return <li key={'cfg-' + idx}>{reason}</li>
                  })}
                </ul>
              ) : null}
              <div style={{ marginBottom: '10px' }}>
                Credentials: <AhjCredentialStatus row={row} />
                <div style={{ color: adminTheme.textDim, fontSize: '11px', marginTop: '4px' }}>
                  Scope: {display(row.credential_scope, 'platform')}
                </div>
              </div>
              {row.workflow_type === 'pdf_packet' ? <AhjPacketStatus row={row} /> : null}
            </Section>

            <Section title="Run information">
              <dl
                style={{
                  margin: 0,
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: '8px 12px',
                  fontSize: '12px',
                }}
              >
                <div>
                  <dt style={{ color: adminTheme.textDim }}>Last validation</dt>
                  <dd style={{ margin: 0 }}>{formatTimestamp(row.last_relevant_run_at)}</dd>
                </div>
                <div>
                  <dt style={{ color: adminTheme.textDim }}>Last success</dt>
                  <dd style={{ margin: 0 }}>{formatTimestamp(row.last_success_at)}</dd>
                </div>
                <div>
                  <dt style={{ color: adminTheme.textDim }}>Last failure</dt>
                  <dd style={{ margin: 0 }}>{formatTimestamp(row.last_failure_at)}</dd>
                </div>
                <div>
                  <dt style={{ color: adminTheme.textDim }}>Relevant run count</dt>
                  <dd style={{ margin: 0 }}>{display(row.relevant_run_count, '0')}</dd>
                </div>
                <div>
                  <dt style={{ color: adminTheme.textDim }}>Success count</dt>
                  <dd style={{ margin: 0 }}>{display(row.success_count, '0')}</dd>
                </div>
                <div>
                  <dt style={{ color: adminTheme.textDim }}>Failure count</dt>
                  <dd style={{ margin: 0 }}>{display(row.failure_count, '0')}</dd>
                </div>
                <div>
                  <dt style={{ color: adminTheme.textDim }}>Recent failure streak</dt>
                  <dd style={{ margin: 0 }}>{display(row.recent_failure_streak, '0')}</dd>
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <dt style={{ color: adminTheme.textDim }}>Last error</dt>
                  <dd style={{ margin: 0, color: adminTheme.textMuted }}>
                    {display(row.last_error_message, '—')}
                  </dd>
                </div>
              </dl>
              <p style={{ marginTop: '10px', color: adminTheme.textDim, fontSize: '11px' }}>
                Detail API does not return a per-run history array in PR A. Metrics above are the
                available run projection.
              </p>
            </Section>

            <details style={{ marginTop: '8px' }}>
              <summary
                style={{
                  cursor: 'pointer',
                  color: adminTheme.textMuted,
                  fontFamily: adminTheme.fontMono,
                  fontSize: '12px',
                }}
              >
                Raw readiness axes
              </summary>
              <dl style={{ marginTop: '10px', fontSize: '12px', color: adminTheme.textMuted }}>
                <div>lifecycle: {display(row.lifecycle_state)}</div>
                <div>health: {display(row.operational_health)}</div>
                <div>active: {String(row.is_active === true)}</div>
                <div>workflow: {display(row.workflow_type)}</div>
                <div>submission: {display(row.submission_method)}</div>
              </dl>
            </details>
          </>
        ) : null}
      </aside>
    </div>
  )
}
