'use client'

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
import { adminTheme } from '../../../../lib/ui/admin-theme'

const thStyle = {
  textAlign: 'left',
  fontSize: '11px',
  color: adminTheme.textDim,
  fontFamily: adminTheme.fontMono,
  padding: '10px 12px',
  borderBottom: '1px solid ' + adminTheme.border,
  whiteSpace: 'nowrap',
}

const tdStyle = {
  padding: '10px 12px',
  borderBottom: '1px solid ' + adminTheme.border,
  fontSize: '13px',
  color: adminTheme.text,
  verticalAlign: 'top',
}

export default function AhjTable({ rows, onOpenDetail, selectedId }) {
  return (
    <div style={{ overflowX: 'auto', border: '1px solid ' + adminTheme.border, borderRadius: '10px' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '1100px' }}>
        <caption style={{ position: 'absolute', left: '-10000px' }}>
          AHJ validation and pilot readiness table
        </caption>
        <thead>
          <tr style={{ background: adminTheme.headerBg }}>
            <th style={thStyle}>AHJ Name</th>
            <th style={thStyle}>Jurisdiction</th>
            <th style={thStyle}>Workflow</th>
            <th style={thStyle} className="ahj-hide-sm">
              Submission
            </th>
            <th style={thStyle}>Lifecycle</th>
            <th style={thStyle}>Health</th>
            <th style={thStyle}>Active</th>
            <th style={thStyle}>Config</th>
            <th style={thStyle}>Credentials</th>
            <th style={thStyle}>Last Validation</th>
            <th style={thStyle} className="ahj-hide-md">
              Last Success
            </th>
            <th style={thStyle}>Blocker</th>
            <th style={thStyle}>Pilot Ready</th>
          </tr>
        </thead>
        <tbody>
          {(rows || []).length === 0 ? (
            <tr>
              <td colSpan={13} style={{ ...tdStyle, color: adminTheme.textMuted }}>
                No AHJs match the current search/filters.
              </td>
            </tr>
          ) : (
            (rows || []).map(function (row) {
              const cfg = configDisplay(row)
              const selected = selectedId && selectedId === row.id
              return (
                <tr
                  key={row.id || row.name}
                  tabIndex={0}
                  role="button"
                  aria-label={'Open details for ' + (row.name || 'AHJ')}
                  onClick={function () {
                    onOpenDetail(row)
                  }}
                  onKeyDown={function (event) {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      onOpenDetail(row)
                    }
                  }}
                  style={{
                    cursor: 'pointer',
                    background: selected ? 'rgba(59,130,246,0.08)' : 'transparent',
                    outlineOffset: '-2px',
                  }}
                >
                  <td style={tdStyle}>
                    <div style={{ fontWeight: 600 }}>{display(row.name)}</div>
                  </td>
                  <td style={tdStyle}>{jurisdictionLabel(row)}</td>
                  <td style={tdStyle}>{workflowLabel(row.workflow_type)}</td>
                  <td style={tdStyle} className="ahj-hide-sm">
                    {display(row.submission_method)}
                  </td>
                  <td style={tdStyle}>
                    <AhjLifecycleBadge lifecycle={row.lifecycle_state} />
                  </td>
                  <td style={tdStyle}>
                    <AhjHealthBadge health={row.operational_health} />
                  </td>
                  <td style={tdStyle}>{row.is_active === true ? 'Yes' : 'No'}</td>
                  <td style={tdStyle}>
                    <span style={{ fontFamily: adminTheme.fontMono, fontSize: '12px' }}>
                      {cfg.label}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <AhjCredentialStatus row={row} compact />
                  </td>
                  <td style={tdStyle}>{formatTimestamp(row.last_relevant_run_at)}</td>
                  <td style={tdStyle} className="ahj-hide-md">
                    {formatTimestamp(row.last_success_at)}
                  </td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        fontFamily: adminTheme.fontMono,
                        fontSize: '11px',
                        color: row.primary_blocker ? adminTheme.danger : adminTheme.success,
                      }}
                    >
                      {row.primary_blocker || 'None'}
                    </span>
                  </td>
                  <td style={tdStyle}>
                    <span
                      style={{
                        color: row.pilot_ready ? adminTheme.success : adminTheme.warning,
                        fontFamily: adminTheme.fontMono,
                        fontSize: '12px',
                      }}
                    >
                      {row.pilot_ready ? 'Yes' : 'No'}
                    </span>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>
      <style>{`
        @media (max-width: 1100px) {
          .ahj-hide-md { display: none !important; }
        }
        @media (max-width: 900px) {
          .ahj-hide-sm { display: none !important; }
        }
      `}</style>
    </div>
  )
}
