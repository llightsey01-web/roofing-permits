'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  contractorTheme,
  contractorCardStyle,
} from '../../../lib/ui/contractor-theme'

function isDartIqAuto(notes) {
  return typeof notes === 'string' && notes.toLowerCase().includes('dart iq')
}

function portalHost(url) {
  if (!url) return null
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function submissionLabel(method) {
  if (!method) return '—'
  if (method === 'portal') return 'Online Portal'
  if (method === 'in_person') return 'In Person'
  if (method === 'email') return 'Email'
  return method
}

function AhjAccordion({ ahj, expanded, onToggle }) {
  const countyLabel = (ahj.county_or_city || ahj.name || '').toUpperCase()
  const docs = ahj.documents || ahj.requirements || ahj.ahj_requirements || []
  const inspections = ahj.inspections || ahj.ahj_inspections || []
  const host = portalHost(ahj.portal_url)

  function handlePrint(e) {
    e.stopPropagation()
    const prev = document.title
    document.title = 'AHJ Permit Guide — ' + (ahj.county_or_city || ahj.name)
    window.print()
    document.title = prev
  }

  return (
    <div
      className="ahj-guide-card"
      data-ahj-id={ahj.id}
      data-expanded={expanded ? 'true' : 'false'}
      style={{
        ...contractorCardStyle(),
        marginBottom: '12px',
        overflow: 'hidden',
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '16px 18px',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          textAlign: 'left',
          color: contractorTheme.text,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: '15px',
            fontWeight: 700,
            letterSpacing: '0.04em',
            color: contractorTheme.text,
          }}>
            {countyLabel} {expanded ? '▼' : '▶'}
          </div>
          <div style={{
            marginTop: '4px',
            fontSize: '13px',
            color: contractorTheme.textMuted,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}>
            {ahj.name}
          </div>
        </div>
        <span
          role="button"
          tabIndex={0}
          onClick={handlePrint}
          onKeyDown={function (ev) {
            if (ev.key === 'Enter' || ev.key === ' ') {
              ev.preventDefault()
              handlePrint(ev)
            }
          }}
          style={{
            flexShrink: 0,
            padding: '6px 12px',
            borderRadius: '8px',
            border: '1px solid ' + contractorTheme.border,
            backgroundColor: contractorTheme.inputBg,
            color: contractorTheme.textMuted,
            fontSize: '12px',
            cursor: 'pointer',
          }}
        >
          Print
        </span>
      </button>

      {expanded && (
        <div style={{
          padding: '0 18px 20px',
          borderTop: '1px solid ' + contractorTheme.border,
        }}>
          <div style={{
            display: 'grid',
            gap: '6px',
            padding: '14px 0 18px',
            fontSize: '13px',
            color: contractorTheme.textBody,
            lineHeight: 1.5,
          }}>
            {ahj.office_address && <div>{ahj.office_address}</div>}
            {ahj.phone && <div>{ahj.phone}</div>}
            {host && (
              <div>
                <a
                  href={ahj.portal_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: contractorTheme.accent }}
                >
                  {host}
                </a>
              </div>
            )}
            <div>
              Avg approval:{' '}
              {ahj.avg_approval_days != null
                ? ahj.avg_approval_days + ' business days'
                : '—'}
            </div>
            <div>Submit: {submissionLabel(ahj.submission_method)}</div>
            {ahj.portal_tips && (
              <div style={{
                marginTop: '8px',
                padding: '10px 12px',
                borderRadius: '8px',
                backgroundColor: contractorTheme.accentSoft,
                color: contractorTheme.textMuted,
                fontSize: '12px',
              }}>
                {ahj.portal_tips}
              </div>
            )}
          </div>

          <h3 style={{
            margin: '0 0 10px',
            fontSize: '12px',
            letterSpacing: '0.08em',
            color: contractorTheme.textMuted,
            fontWeight: 700,
          }}>
            REQUIRED DOCUMENTS
          </h3>
          <div style={{
            height: '1px',
            backgroundColor: contractorTheme.border,
            marginBottom: '12px',
          }} />

          <div style={{ display: 'grid', gap: '12px', marginBottom: '22px' }}>
            {docs.length === 0 && (
              <div style={{ color: contractorTheme.textMuted, fontSize: '13px' }}>
                No documents listed yet.
              </div>
            )}
            {docs.map(function (doc) {
              const auto = isDartIqAuto(doc.notes)
              // Admin edits `notes`; prefer that over stale `description`
              const guidance = (doc.notes && String(doc.notes).trim())
                || (doc.description && String(doc.description).trim())
                || ''
              return (
                <div
                  key={doc.id}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                    <div style={{
                      fontSize: '14px',
                      fontWeight: 600,
                      color: contractorTheme.text,
                    }}>
                      <span style={{
                        display: 'inline-block',
                        width: '8px',
                        height: '8px',
                        borderRadius: '50%',
                        marginRight: '8px',
                        backgroundColor: doc.is_required
                          ? contractorTheme.success
                          : contractorTheme.warning,
                        verticalAlign: 'middle',
                      }} />
                      {doc.name}
                      {!doc.is_required && (
                        <span style={{
                          marginLeft: '6px',
                          fontWeight: 400,
                          color: contractorTheme.warning,
                          fontSize: '12px',
                        }}>
                          (optional)
                        </span>
                      )}
                    </div>
                    {guidance && (
                      <div style={{
                        marginTop: '4px',
                        fontSize: '13px',
                        color: contractorTheme.textBody,
                        lineHeight: 1.45,
                      }}>
                        {guidance}
                      </div>
                    )}
                  </div>
                  <div style={{ flexShrink: 0 }}>
                    {auto ? (
                      <span style={{
                        display: 'inline-block',
                        padding: '5px 10px',
                        borderRadius: '8px',
                        backgroundColor: 'rgba(59, 130, 246, 0.18)',
                        color: '#93c5fd',
                        border: '1px solid rgba(59, 130, 246, 0.35)',
                        fontSize: '12px',
                        fontWeight: 600,
                      }}>
                        Auto
                      </span>
                    ) : doc.download_url ? (
                      <a
                        href={doc.download_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'inline-block',
                          padding: '5px 10px',
                          borderRadius: '8px',
                          backgroundColor: contractorTheme.warningSoft,
                          color: contractorTheme.warning,
                          border: '1px solid ' + contractorTheme.warning,
                          fontSize: '12px',
                          fontWeight: 600,
                          textDecoration: 'none',
                        }}
                      >
                        Download
                      </a>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>

          <h3 style={{
            margin: '0 0 10px',
            fontSize: '12px',
            letterSpacing: '0.08em',
            color: contractorTheme.textMuted,
            fontWeight: 700,
          }}>
            INSPECTION SCHEDULE
          </h3>
          <div style={{
            height: '1px',
            backgroundColor: contractorTheme.border,
            marginBottom: '12px',
          }} />

          <div style={{ display: 'grid', gap: '14px' }}>
            {inspections.length === 0 && (
              <div style={{ color: contractorTheme.textMuted, fontSize: '13px' }}>
                No inspections listed yet.
              </div>
            )}
            {inspections.map(function (insp, idx) {
              return (
                <div key={insp.id}>
                  <div style={{
                    fontSize: '14px',
                    fontWeight: 700,
                    color: contractorTheme.text,
                    letterSpacing: '0.03em',
                  }}>
                    {idx + 1}. {(insp.inspection_name || '').toUpperCase()}
                  </div>
                  {insp.when_to_schedule && (
                    <div style={{ marginTop: '4px', fontSize: '13px', color: contractorTheme.textMuted }}>
                      When: {insp.when_to_schedule}
                    </div>
                  )}
                  {insp.typical_wait_days != null && (
                    <div style={{ fontSize: '13px', color: contractorTheme.textMuted }}>
                      Wait: ~{insp.typical_wait_days} business days
                    </div>
                  )}
                  {(insp.notes || insp.description) && (
                    <div style={{ fontSize: '13px', color: contractorTheme.textBody, marginTop: '2px' }}>
                      {insp.notes || insp.description}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

export default function AhjGuidePage() {
  const [ahjs, setAhjs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [expandedIds, setExpandedIds] = useState({})

  useEffect(function () {
    let cancelled = false

    async function load() {
      try {
        const res = await fetch('/api/contractor/ahj-guide', {
          cache: 'no-store',
          headers: { Pragma: 'no-cache', 'Cache-Control': 'no-cache' },
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load AHJ guide')
        if (!cancelled) {
          setAhjs(data.ahjs || [])
          setError('')
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      }
      if (!cancelled) setLoading(false)
    }

    load()

    function onVisible() {
      if (document.visibilityState === 'visible') load()
    }
    function onFocus() {
      load()
    }

    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)

    return function () {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  const filtered = useMemo(function () {
    const q = query.trim().toLowerCase()
    if (!q) return ahjs
    return ahjs.filter(function (a) {
      return (
        (a.county_or_city || '').toLowerCase().includes(q) ||
        (a.name || '').toLowerCase().includes(q) ||
        (a.office_address || '').toLowerCase().includes(q)
      )
    })
  }, [ahjs, query])

  useEffect(function () {
    const q = query.trim()
    if (!q) return
    const next = {}
    filtered.forEach(function (a) {
      next[a.id] = true
    })
    setExpandedIds(next)
  }, [query, filtered])

  function toggle(id) {
    setExpandedIds(function (prev) {
      return { ...prev, [id]: !prev[id] }
    })
  }

  return (
    <div className="contractor-page">
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .ahj-guide-card[data-expanded="true"],
          .ahj-guide-card[data-expanded="true"] * {
            visibility: visible !important;
          }
          .ahj-guide-card[data-expanded="true"] {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            box-shadow: none !important;
            border: none !important;
          }
        }
      `}</style>

      <div style={{ ...contractorCardStyle(), padding: '28px', marginBottom: '16px' }}>
        <h1 style={{
          margin: '0 0 8px',
          fontSize: '24px',
          letterSpacing: '0.06em',
          color: contractorTheme.text,
        }}>
          AHJ PERMIT GUIDE
        </h1>
        <div style={{
          height: '1px',
          backgroundColor: contractorTheme.border,
          margin: '12px 0',
        }} />
        <p style={{ margin: '0 0 16px', color: contractorTheme.textMuted, fontSize: '14px' }}>
          Your Florida county permit requirements cheat sheet.
          Click any county to see what you need.
        </p>
        <div style={{ position: 'relative' }}>
          <input
            type="search"
            value={query}
            onChange={function (e) { setQuery(e.target.value) }}
            placeholder="Search county..."
            style={{
              width: '100%',
              padding: '12px 40px 12px 14px',
              borderRadius: '10px',
              border: '1px solid ' + contractorTheme.border,
              backgroundColor: contractorTheme.inputBg,
              color: contractorTheme.text,
              fontSize: '14px',
              outline: 'none',
            }}
          />
          <span style={{
            position: 'absolute',
            right: '14px',
            top: '50%',
            transform: 'translateY(-50%)',
            color: contractorTheme.textMuted,
            pointerEvents: 'none',
            fontSize: '12px',
            fontWeight: 600,
            letterSpacing: '0.04em',
          }}>
            Search
          </span>
        </div>
      </div>

      {loading && (
        <div style={{ color: contractorTheme.textMuted, padding: '12px' }}>Loading counties…</div>
      )}
      {error && (
        <div style={{
          padding: '12px 14px',
          borderRadius: '8px',
          backgroundColor: contractorTheme.errorSoft,
          color: contractorTheme.error,
          marginBottom: '12px',
        }}>
          {error}
        </div>
      )}
      {!loading && !error && filtered.length === 0 && (
        <div style={{ color: contractorTheme.textMuted, padding: '12px' }}>
          No counties match your search.
        </div>
      )}

      {filtered.map(function (ahj) {
        const expanded = Boolean(expandedIds[ahj.id])
        return (
          <AhjAccordion
            key={ahj.id}
            ahj={ahj}
            expanded={expanded}
            onToggle={function () { toggle(ahj.id) }}
          />
        )
      })}
    </div>
  )
}
