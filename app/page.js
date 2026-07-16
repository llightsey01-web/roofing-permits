'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Portal root. Must be client-side so we can catch Supabase auth hashes
 * (#access_token / type=recovery) before sending users to the marketing site.
 * Server redirects strip the URL hash and break password recovery links.
 */
export default function Home() {
  const router = useRouter()
  const [message, setMessage] = useState('Loading...')

  useEffect(function () {
    const hash = window.location.hash || ''
    const search = window.location.search || ''
    const hashParams = new URLSearchParams(hash.replace(/^#/, ''))
    const type = hashParams.get('type')
    const hasAccessToken = Boolean(hashParams.get('access_token'))
    const hasCode = search.includes('code=')
    const isRecovery = type === 'recovery' || hasAccessToken || hasCode

    if (isRecovery) {
      setMessage('Opening password reset...')
      router.replace('/reset-password' + search + hash)
      return
    }

    setMessage('Redirecting...')
    window.location.replace('https://www.dartiq.dev')
  }, [router])

  return (
    <div style={{
      minHeight: '100dvh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#0f172a',
      color: '#94a3b8',
      fontFamily: 'system-ui, sans-serif',
      fontSize: '14px',
    }}>
      {message}
    </div>
  )
}
