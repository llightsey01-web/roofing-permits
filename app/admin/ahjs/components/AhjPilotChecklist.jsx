'use client'

import { adminTheme } from '../../../../lib/ui/admin-theme'

export default function AhjPilotChecklist({ items, pilotReady }) {
  const list = Array.isArray(items) ? items : []
  return (
    <div>
      <div
        style={{
          marginBottom: '10px',
          fontFamily: adminTheme.fontMono,
          fontSize: '12px',
          color: pilotReady ? adminTheme.success : adminTheme.warning,
        }}
        role="status"
      >
        Pilot ready: {pilotReady ? 'Yes' : 'No'}
        {pilotReady ? (
          <span style={{ display: 'block', color: adminTheme.textDim, marginTop: '4px', fontWeight: 400 }}>
            Hard checklist items pass. Informational validation-history items may still fail.
          </span>
        ) : null}
      </div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {list.map(function (item, index) {
          const blocking = item && item.blocking === true
          const passed = item && item.passed === true
          return (
            <li
              key={(item && item.label) || index}
              style={{
                border: '1px solid ' + adminTheme.border,
                borderRadius: '8px',
                padding: '8px 10px',
                background: adminTheme.surfaceRaised,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                <span style={{ color: adminTheme.text, fontSize: '13px' }}>{item.label}</span>
                <span
                  style={{
                    fontFamily: adminTheme.fontMono,
                    fontSize: '11px',
                    color: passed ? adminTheme.success : adminTheme.danger,
                  }}
                >
                  {passed ? 'PASS' : 'FAIL'}
                </span>
              </div>
              <div style={{ marginTop: '4px', color: adminTheme.textDim, fontSize: '11px' }}>
                {blocking ? 'Hard (affects pilot_ready)' : 'Informational (does not alone set pilot_ready)'}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
