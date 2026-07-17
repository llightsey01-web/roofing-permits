'use client'

import { useEffect, useState } from 'react'
import { createClient } from '../../../lib/supabase'
import { safeGetSession } from '../../../lib/auth/safe-auth'
import {
  contractorTheme,
  contractorCardStyle,
} from '../../../lib/ui/contractor-theme'
import MaterialsPreferenceEditor, {
  materialsResponseToSelected,
  selectedToPayload,
} from '../components/MaterialsPreferenceEditor'

export default function ContractorMaterialsPage() {
  const [initialSelected, setInitialSelected] = useState(null)
  const [loadError, setLoadError] = useState('')

  async function getToken() {
    const supabase = createClient()
    const { data } = await safeGetSession(supabase)
    return data?.session?.access_token || null
  }

  useEffect(function () {
    async function loadPrefs() {
      try {
        const token = await getToken()
        if (!token) {
          setLoadError('Not authenticated')
          setInitialSelected({ primary: [], underlayment: [], ventilation: [] })
          return
        }
        const res = await fetch('/api/contractor/materials', {
          headers: { Authorization: 'Bearer ' + token },
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load preferences')
        setInitialSelected(materialsResponseToSelected(data.grouped || data.materials))
      } catch (err) {
        setLoadError(err.message)
        setInitialSelected({ primary: [], underlayment: [], ventilation: [] })
      }
    }
    loadPrefs()
  }, [])

  async function handleSave(selected) {
    const token = await getToken()
    if (!token) throw new Error('Not authenticated')
    const res = await fetch('/api/contractor/materials', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify({
        replace: true,
        materials: selectedToPayload(selected),
      }),
    })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to save')
  }

  return (
    <div className="contractor-page contractor-page-narrow">
      <div style={{ ...contractorCardStyle(), padding: '28px' }}>
        <h1 style={{
          margin: '0 0 8px',
          fontSize: '24px',
          letterSpacing: '0.04em',
          color: contractorTheme.text,
        }}>
          My Preferred Materials
        </h1>
        <p style={{ margin: '0 0 20px', color: contractorTheme.textMuted, fontSize: '14px' }}>
          Set your default roofing materials. These will be pre-selected when you submit new permits.
        </p>

        {loadError ? (
          <p style={{ color: '#fca5a5', fontSize: '13px' }}>{loadError}</p>
        ) : null}

        {initialSelected ? (
          <MaterialsPreferenceEditor
            getToken={getToken}
            initialSelected={initialSelected}
            showSaveButton
            saveLabel="Save Preferences"
            onSave={handleSave}
          />
        ) : (
          <p style={{ color: contractorTheme.textMuted }}>Loading preferences…</p>
        )}
      </div>
    </div>
  )
}
