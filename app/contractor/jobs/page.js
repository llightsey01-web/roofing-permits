'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/** Jobs list lives on the contractor dashboard for now. */
export default function ContractorJobsIndexPage() {
  const router = useRouter()

  useEffect(function () {
    router.replace('/contractor/dashboard')
  }, [router])

  return (
    <div style={{ padding: '48px', color: '#94a3b8', fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace', fontSize: '13px' }}>
      Loading jobs…
    </div>
  )
}
