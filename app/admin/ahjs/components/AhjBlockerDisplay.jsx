'use client'

import { adminTheme } from '../../../../lib/ui/admin-theme'

export default function AhjBlockerDisplay({ primaryBlocker, allBlockers }) {
  const list = Array.isArray(allBlockers) ? allBlockers : []
  if (!primaryBlocker && !list.length) {
    return (
      <span style={{ color: adminTheme.success, fontFamily: adminTheme.fontMono, fontSize: '12px' }}>
        None
      </span>
    )
  }
  return (
    <div>
      <div
        style={{
          color: adminTheme.danger,
          fontFamily: adminTheme.fontMono,
          fontSize: '12px',
          fontWeight: 600,
        }}
      >
        {primaryBlocker || list[0]}
      </div>
      {list.length > 1 ? (
        <ul
          style={{
            margin: '6px 0 0',
            paddingLeft: '16px',
            color: adminTheme.textMuted,
            fontSize: '11px',
          }}
        >
          {list.map(function (item) {
            return <li key={item}>{item}</li>
          })}
        </ul>
      ) : null}
    </div>
  )
}
