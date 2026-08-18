'use client'

import { deriveSummary } from '../lib/dashboard-view-model.js'
import { adminTheme, adminStatCardStyle } from '../../../../lib/ui/admin-theme'

export default function AhjSummaryCards({ rows }) {
  const summary = deriveSummary(rows)
  const cards = [
    { key: 'total', label: 'Total AHJs', value: summary.total },
    { key: 'production', label: 'Production', value: summary.production },
    { key: 'pilot', label: 'Pilot', value: summary.pilot },
    { key: 'validation_ready', label: 'Validation Ready', value: summary.validation_ready },
    { key: 'unavailable', label: 'Unavailable', value: summary.unavailable },
    { key: 'contractor_visible', label: 'Contractor Visible', value: summary.contractor_visible },
    { key: 'worker_executable', label: 'Worker Executable', value: summary.worker_executable },
  ]

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
        gap: '12px',
        marginBottom: '18px',
      }}
    >
      {cards.map(function (card) {
        return (
          <div key={card.key} style={adminStatCardStyle()}>
            <div
              style={{
                fontSize: '11px',
                color: adminTheme.textDim,
                fontFamily: adminTheme.fontMono,
                marginBottom: '8px',
              }}
            >
              {card.label}
            </div>
            <div style={{ fontSize: '22px', fontWeight: 700, color: adminTheme.text }}>
              {card.value}
            </div>
          </div>
        )
      })}
    </div>
  )
}
