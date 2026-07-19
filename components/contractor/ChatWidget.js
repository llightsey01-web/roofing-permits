'use client'

import { useState, useRef, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { createClient } from '../../lib/supabase'
import { safeGetSession } from '../../lib/auth/safe-auth'
import { getPortalTheme } from '../../lib/ui/contractor-theme'

const JOB_ID_RE = /^\/contractor\/jobs\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})/i

const SUGGESTIONS = [
  'What docs do I need?',
  'How long does Polk take?',
  'GAF Timberline FL number?',
  'When to schedule dry-in?',
]

function resolveJobIdFromPath(pathname) {
  if (!pathname) return null
  const match = pathname.match(JOB_ID_RE)
  return match ? match[1] : null
}

export default function ChatWidget({ jobId }) {
  const pathname = usePathname()
  const resolvedJobId = jobId || resolveJobIdFromPath(pathname)

  const [isOpen, setIsOpen] = useState(false)
  const [isLight, setIsLight] = useState(false)
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: 'Hi! I\'m your DART iQ permit assistant. Ask me anything about your permits, county requirements, or roofing documents.',
    },
  ])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const messagesEndRef = useRef(null)

  useEffect(function () {
    function syncTheme() {
      try {
        setIsLight(getPortalTheme() === 'light')
      } catch (_) {
        setIsLight(false)
      }
    }
    syncTheme()
    const observer = new MutationObserver(syncTheme)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class'],
    })
    return function () { observer.disconnect() }
  }, [])

  useEffect(function () {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isOpen])

  async function getAccessToken() {
    const supabase = createClient()
    const { session } = await safeGetSession(supabase)
    return session?.access_token || null
  }

  async function sendMessage(overrideText) {
    const text = (overrideText != null ? overrideText : input).trim()
    if (!text || loading) return

    const userMessage = { role: 'user', content: text }
    const newMessages = messages.concat([userMessage])
    setMessages(newMessages)
    setInput('')
    setLoading(true)

    try {
      const token = await getAccessToken()
      if (!token) {
        setMessages(function (prev) {
          return prev.concat([{
            role: 'assistant',
            content: 'Please sign in again to use the assistant.',
          }])
        })
        return
      }

      const res = await fetch('/api/contractor/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({
          messages: newMessages.filter(function (m) {
            return m.role === 'user' || m.role === 'assistant'
          }),
          jobId: resolvedJobId || null,
        }),
      })

      const data = await res.json()

      if (data.reply) {
        setMessages(function (prev) {
          return prev.concat([{ role: 'assistant', content: data.reply }])
        })
      } else {
        setMessages(function (prev) {
          return prev.concat([{
            role: 'assistant',
            content: data.error || 'Sorry, I could not process that request.',
          }])
        })
      }
    } catch (err) {
      setMessages(function (prev) {
        return prev.concat([{
          role: 'assistant',
          content: 'Sorry, I\'m having trouble connecting. Please try again.',
        }])
      })
    } finally {
      setLoading(false)
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const panelBg = isLight ? 'rgba(255, 255, 255, 0.97)' : 'rgba(15, 15, 20, 0.97)'
  const panelBorder = isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'
  const headerText = isLight ? 'rgba(15,23,42,0.95)' : 'white'
  const mutedText = isLight ? 'rgba(0,0,0,0.45)' : 'rgba(255,255,255,0.4)'
  const assistantBg = isLight ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.07)'
  const assistantBorder = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'
  const assistantText = isLight ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)'
  const inputBg = isLight ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)'
  const inputBorder = isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'
  const inputColor = isLight ? 'rgba(15,23,42,0.95)' : 'white'
  const chipBorder = isLight ? 'rgba(99,102,241,0.35)' : 'rgba(99,102,241,0.4)'
  const chipBg = isLight ? 'rgba(99,102,241,0.08)' : 'rgba(99,102,241,0.1)'
  const chipColor = isLight ? 'rgba(15,23,42,0.7)' : 'rgba(255,255,255,0.7)'

  return (
    <>
      <button
        type="button"
        className="dartiq-chat-toggle"
        onClick={function () { setIsOpen(!isOpen) }}
        style={{
          position: 'fixed',
          bottom: '24px',
          right: '24px',
          width: '52px',
          height: '52px',
          borderRadius: '50%',
          background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 4px 24px rgba(99,102,241,0.4)',
          zIndex: 9999,
          transition: 'transform 0.2s',
        }}
        title="DART iQ Assistant"
        aria-label={isOpen ? 'Close assistant' : 'Open assistant'}
      >
        {isOpen ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        ) : (
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
        )}
      </button>

      {isOpen ? (
        <div
          className="dartiq-chat-panel"
          style={{
            position: 'fixed',
            bottom: '88px',
            right: '24px',
            width: '380px',
            height: '520px',
            maxWidth: 'calc(100vw - 32px)',
            maxHeight: 'calc(100dvh - 120px)',
            background: panelBg,
            border: '1px solid ' + panelBorder,
            borderRadius: '16px',
            display: 'flex',
            flexDirection: 'column',
            zIndex: 9998,
            boxShadow: isLight
              ? '0 24px 64px rgba(0,0,0,0.18)'
              : '0 24px 64px rgba(0,0,0,0.5)',
            overflow: 'hidden',
            backdropFilter: 'blur(12px)',
          }}
        >
          <div style={{
            padding: '16px 20px',
            borderBottom: '1px solid ' + assistantBorder,
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            background: 'rgba(99,102,241,0.1)',
          }}>
            <div style={{
              width: '32px',
              height: '32px',
              borderRadius: '50%',
              background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '14px',
              fontWeight: '700',
              color: 'white',
              flexShrink: 0,
            }}>
              D
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '13px', fontWeight: '600', color: headerText }}>
                DART iQ Assistant
              </div>
              <div style={{ fontSize: '11px', color: mutedText }}>
                {resolvedJobId ? 'Job context active' : 'Permit & compliance help'}
              </div>
            </div>
            <div style={{
              marginLeft: 'auto',
              width: '8px',
              height: '8px',
              borderRadius: '50%',
              background: '#22c55e',
              boxShadow: '0 0 6px #22c55e',
              flexShrink: 0,
            }} />
          </div>

          <div style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px',
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
          }}>
            {messages.map(function (msg, i) {
              const isUser = msg.role === 'user'
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: isUser ? 'flex-end' : 'flex-start',
                  }}
                >
                  <div style={{
                    maxWidth: '85%',
                    padding: '10px 14px',
                    borderRadius: isUser ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                    background: isUser
                      ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                      : assistantBg,
                    border: isUser ? 'none' : '1px solid ' + assistantBorder,
                    fontSize: '13px',
                    lineHeight: '1.5',
                    color: isUser ? 'white' : assistantText,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}>
                    {msg.content}
                  </div>
                </div>
              )
            })}

            {loading ? (
              <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                <div style={{
                  padding: '10px 14px',
                  borderRadius: '16px 16px 16px 4px',
                  background: assistantBg,
                  border: '1px solid ' + assistantBorder,
                  display: 'flex',
                  gap: '4px',
                  alignItems: 'center',
                }}>
                  {[0, 1, 2].map(function (i) {
                    return (
                      <div
                        key={i}
                        style={{
                          width: '6px',
                          height: '6px',
                          borderRadius: '50%',
                          background: mutedText,
                          animation: 'dartiq-chat-pulse 1.2s ease-in-out ' + (i * 0.2) + 's infinite',
                        }}
                      />
                    )
                  })}
                </div>
              </div>
            ) : null}

            <div ref={messagesEndRef} />
          </div>

          {messages.length === 1 ? (
            <div style={{
              padding: '0 16px 12px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px',
            }}>
              {SUGGESTIONS.map(function (q) {
                return (
                  <button
                    key={q}
                    type="button"
                    onClick={function () { sendMessage(q) }}
                    style={{
                      padding: '5px 10px',
                      borderRadius: '20px',
                      border: '1px solid ' + chipBorder,
                      background: chipBg,
                      color: chipColor,
                      fontSize: '11px',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {q}
                  </button>
                )
              })}
            </div>
          ) : null}

          <div style={{
            padding: '12px 16px',
            borderTop: '1px solid ' + assistantBorder,
            display: 'flex',
            gap: '8px',
            alignItems: 'flex-end',
          }}>
            <textarea
              value={input}
              onChange={function (e) { setInput(e.target.value) }}
              onKeyDown={handleKeyDown}
              placeholder="Ask about permits, documents, counties..."
              rows={1}
              style={{
                flex: 1,
                background: inputBg,
                border: '1px solid ' + inputBorder,
                borderRadius: '10px',
                padding: '8px 12px',
                color: inputColor,
                fontSize: '13px',
                resize: 'none',
                outline: 'none',
                fontFamily: 'inherit',
                lineHeight: '1.4',
                maxHeight: '80px',
                overflowY: 'auto',
              }}
            />
            <button
              type="button"
              onClick={function () { sendMessage() }}
              disabled={loading || !input.trim()}
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: input.trim() && !loading
                  ? 'linear-gradient(135deg, #6366f1, #8b5cf6)'
                  : (isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.1)'),
                border: 'none',
                cursor: input.trim() && !loading ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                transition: 'background 0.2s',
              }}
              aria-label="Send message"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        </div>
      ) : null}

      <style>{`
        @keyframes dartiq-chat-pulse {
          0%, 100% { opacity: 0.4; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
        @media (max-width: 768px) {
          .dartiq-chat-toggle {
            bottom: calc(80px + env(safe-area-inset-bottom, 0px)) !important;
            right: 16px !important;
          }
          .dartiq-chat-panel {
            right: 8px !important;
            left: 8px !important;
            width: auto !important;
            bottom: calc(140px + env(safe-area-inset-bottom, 0px)) !important;
            height: min(520px, calc(100dvh - 160px)) !important;
          }
        }
      `}</style>
    </>
  )
}
