'use client'

import { lifecycleBadge } from '../lib/dashboard-view-model.js'
import { adminTheme } from '../../../../lib/ui/admin-theme'

const toneStyles = {
  success: { bg: 'rgba(52,211,153,0.12)', color: adminTheme.success },
  warning: { bg: 'rgba(251,191,36,0.12)', color: adminTheme.warning },
  danger: { bg: 'rgba(248,113,113,0.12)', color: adminTheme.danger },
  info: { bg: 'rgba(59,130,246,0.12)', color: adminTheme.accent },
  neutral: { bg: 'rgba(148,163,184,0.12)', color: adminTheme.textMuted },
  unknown: { bg: 'rgba(148,163,184,0.18)', color: adminTheme.textDim },
}

export default function AhjLifecycleBadge({ lifecycle }) {
  const badge = lifecycleBadge(lifecycle)
  const tone = toneStyles[badge.tone] || toneStyles.unknown
  return (
    <span
      title={'Lifecycle: ' + badge.label}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '2px 8px',
        borderRadius: '999px',
        fontSize: '11px',
        fontFamily: adminTheme.fontMono,
        background: tone.bg,
        color: tone.color,
        whiteSpace: 'nowrap',
      }}
    >
      <span aria-hidden="true">●</span>
      <span>{badge.label}</span>
    </span>
  )
}
