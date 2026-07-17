'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'

function formatWhen(iso) {
  if (!iso) return null
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return null
  }
}

function StageIcon({ status }) {
  const size = 28
  if (status === 'complete') {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: '#0f766e',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: 14,
        flexShrink: 0,
      }}>
        ✓
      </div>
    )
  }
  if (status === 'current') {
    return (
      <div style={{
        width: size,
        height: size,
        borderRadius: '50%',
        backgroundColor: '#0369a1',
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 700,
        fontSize: 12,
        flexShrink: 0,
        boxShadow: '0 0 0 4px rgba(3, 105, 161, 0.18)',
      }}>
        ●
      </div>
    )
  }
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: '50%',
      border: '2px solid #cbd5e1',
      backgroundColor: '#fff',
      flexShrink: 0,
    }} />
  )
}

export default function PublicPermitTrackerPage() {
  const params = useParams()
  const jobId = params?.jobId
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async function () {
    if (!jobId) return
    try {
      const res = await fetch('/api/track/' + jobId, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error || 'Unable to load permit progress')
        setData(null)
      } else {
        setData(body)
        setError('')
      }
    } catch (err) {
      setError(err.message || 'Unable to load permit progress')
    }
    setLoading(false)
  }, [jobId])

  useEffect(function () {
    load()
    const timer = setInterval(load, 60000)
    return function () { clearInterval(timer) }
  }, [load])

  if (loading) {
    return (
      <div style={pageShell}>
        <p style={{ color: '#64748b', textAlign: 'center', marginTop: 80, fontFamily: fontUi }}>
          Loading permit progress…
        </p>
      </div>
    )
  }

  if (error || !data) {
    return (
      <div style={pageShell}>
        <div style={cardStyle}>
          <h1 style={{ margin: '0 0 8px', fontSize: 22, color: '#0f172a', fontFamily: fontDisplay }}>
            Permit Tracker
          </h1>
          <p style={{ margin: 0, color: '#64748b', fontFamily: fontUi }}>{error || 'Permit not found'}</p>
        </div>
        <Footer />
      </div>
    )
  }

  return (
    <div style={pageShell}>
      <div style={cardStyle}>
        <p style={{
          margin: '0 0 10px',
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '0.04em',
          color: '#0f766e',
          fontFamily: fontDisplay,
        }}>
          DART iQ
        </p>
        <h1 style={{
          margin: '0 0 8px',
          fontSize: 26,
          color: '#0f172a',
          lineHeight: 1.25,
          fontFamily: fontDisplay,
          fontWeight: 700,
        }}>
          Permit Tracker
        </h1>
        <p style={{ margin: '0 0 4px', fontSize: 16, color: '#334155', fontFamily: fontUi, fontWeight: 600 }}>
          {data.property_address}
        </p>
        <p style={{ margin: '0 0 4px', fontSize: 14, color: '#64748b', fontFamily: fontUi }}>
          {[data.property_city, data.property_state, data.property_zip].filter(Boolean).join(', ')}
        </p>
        <p style={{ margin: '0 0 24px', fontSize: 14, color: '#475569', fontFamily: fontUi }}>
          {data.company_name}
        </p>

        <div style={{
          padding: '12px 14px',
          borderRadius: 10,
          backgroundColor: 'rgba(3, 105, 161, 0.08)',
          border: '1px solid rgba(3, 105, 161, 0.22)',
          marginBottom: 28,
        }}>
          <p style={{ margin: 0, fontSize: 11, color: '#0369a1', fontWeight: 700, letterSpacing: '0.06em', fontFamily: fontUi }}>
            CURRENT STEP
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 16, color: '#0c4a6e', fontWeight: 700, fontFamily: fontUi }}>
            {data.current_label || 'In progress'}
          </p>
        </div>

        <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {(data.timeline || []).map(function (stage, idx) {
            const when = formatWhen(stage.timestamp)
            const isLast = idx === (data.timeline || []).length - 1
            return (
              <li key={stage.key} style={{ display: 'flex', gap: 14 }}>
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  <StageIcon status={stage.status} />
                  {!isLast ? (
                    <div style={{
                      width: 2,
                      flex: 1,
                      minHeight: 28,
                      backgroundColor: stage.status === 'complete' ? '#99f6e4' : '#e2e8f0',
                      marginTop: 4,
                      marginBottom: 4,
                    }} />
                  ) : null}
                </div>
                <div style={{ paddingBottom: isLast ? 0 : 20, minWidth: 0, fontFamily: fontUi }}>
                  <p style={{
                    margin: 0,
                    fontSize: 15,
                    fontWeight: stage.status === 'current' ? 700 : 600,
                    color: stage.status === 'pending' ? '#94a3b8' : '#0f172a',
                  }}>
                    {stage.label}
                  </p>
                  {when && stage.status === 'complete' ? (
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>{when}</p>
                  ) : null}
                  {stage.status === 'current' ? (
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: '#0369a1' }}>In progress</p>
                  ) : null}
                  {stage.status === 'pending' ? (
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: '#94a3b8' }}>Pending</p>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ol>

        <p style={{ margin: '24px 0 0', fontSize: 12, color: '#94a3b8', fontFamily: fontUi }}>
          Updates automatically every minute
          {data.updated_at ? ' · Last updated ' + formatWhen(data.updated_at) : ''}
        </p>
      </div>
      <Footer />
    </div>
  )
}

function Footer() {
  return (
    <p style={{
      margin: '28px 0 0',
      textAlign: 'center',
      fontSize: 13,
      color: '#64748b',
      fontFamily: fontUi,
    }}>
      Powered by{' '}
      <a href="https://www.dartiq.dev" style={{ color: '#0f766e', fontWeight: 700, textDecoration: 'none' }}>
        DART iQ
      </a>
    </p>
  )
}

const fontDisplay = '"DM Sans", "Avenir Next", "Segoe UI", sans-serif'
const fontUi = '"Source Sans 3", "Avenir Next", "Segoe UI", sans-serif'

const pageShell = {
  minHeight: '100vh',
  background: 'linear-gradient(165deg, #ecfeff 0%, #f8fafc 45%, #e2e8f0 100%)',
  padding: '32px 16px 48px',
  boxSizing: 'border-box',
}

const cardStyle = {
  maxWidth: 560,
  margin: '0 auto',
  backgroundColor: '#ffffff',
  borderRadius: 16,
  padding: '28px 24px',
  boxShadow: '0 12px 36px rgba(15, 23, 42, 0.08)',
  border: '1px solid #e2e8f0',
}
