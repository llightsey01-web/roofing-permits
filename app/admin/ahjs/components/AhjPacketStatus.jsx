'use client'

import { packetDisplay } from '../lib/dashboard-view-model.js'
import { adminTheme } from '../../../../lib/ui/admin-theme'

export default function AhjPacketStatus({ row }) {
  const view = packetDisplay(row)
  if (!view.applicable) {
    return (
      <span style={{ color: adminTheme.textDim, fontSize: '12px', fontFamily: adminTheme.fontMono }}>
        Not applicable
      </span>
    )
  }
  return (
    <div>
      <div
        style={{
          color:
            view.tone === 'success'
              ? adminTheme.success
              : view.tone === 'danger'
                ? adminTheme.danger
                : adminTheme.textMuted,
          fontFamily: adminTheme.fontMono,
          fontSize: '12px',
        }}
      >
        Packet: {view.label}
      </div>
      {view.reason ? (
        <div style={{ color: adminTheme.textDim, fontSize: '11px', marginTop: '4px' }}>
          {view.reason}
        </div>
      ) : null}
    </div>
  )
}
