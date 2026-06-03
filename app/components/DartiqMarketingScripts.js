'use client'

import { useEffect } from 'react'

export default function DartiqMarketingScripts() {
  useEffect(() => {
    const form = document.getElementById('demo-form')
    if (!form) return

    function handleSubmit(e) {
      e.preventDefault()
      form.style.display = 'none'
      const success = document.getElementById('form-success')
      if (success) success.classList.add('visible')
    }

    form.addEventListener('submit', handleSubmit)
    return () => form.removeEventListener('submit', handleSubmit)
  }, [])

  return null
}
