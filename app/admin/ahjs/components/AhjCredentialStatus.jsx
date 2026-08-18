'use client'

import { credentialDisplay } from '../lib/dashboard-view-model.js'
import { adminTheme } from '../../../../lib/ui/admin-theme'

const toneColor = {
  success: adminTheme.success,
  danger: adminTheme.danger,
  neutral: adminTheme.textMuted,
  unknown: adminTheme.textDim,
}

export default function AhjCredentialStatus({ row, compact }) {
  const view = credentialDisplay(row)
  return (
    <span
      title={view.detail || view.label}
      aria-label={view.detail ? view.label + '. ' + view.detail : view.label}
      style={{
        color: toneColor[view.tone] || adminTheme.text,
        fontSize: compact ? '12px' : '13px',
        fontFamily: adminTheme.fontMono,
      }}
    >
      {view.label}
    </span>
  )
}
