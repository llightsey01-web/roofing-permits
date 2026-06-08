'use client'

import { useLayoutEffect, useEffect } from 'react'

const THEME_KEY = 'dartiq-theme'

function getPreferredTheme() {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch (_) {}
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme)
  document.querySelectorAll('#theme-toggle, #theme-toggle-mobile').forEach(function (btn) {
    btn.setAttribute(
      'aria-label',
      theme === 'light' ? 'Switch to dark mode' : 'Switch to light mode'
    )
  })
}

function toggleTheme() {
  const html = document.documentElement
  const current = html.getAttribute('data-theme') || 'dark'
  const next = current === 'light' ? 'dark' : 'light'
  applyTheme(next)
  try {
    localStorage.setItem(THEME_KEY, next)
  } catch (_) {}
}

async function handleFormSubmit(e) {
  e.preventDefault()
  const form = e.target
  const submitBtn = form.querySelector('button[type="submit"]')

  const data = {
    name: form.querySelector('[name="name"]').value,
    company: form.querySelector('[name="company"]').value,
    email: form.querySelector('[name="email"]').value,
    phone: form.querySelector('[name="phone"]').value,
    monthly_volume: form.querySelector('[name="monthly_volume"]').value,
  }

  submitBtn.disabled = true
  submitBtn.textContent = 'Submitting...'

  try {
    const response = await fetch('/api/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })

    if (response.ok) {
      form.innerHTML = '<div class="success-message"><h3>You\'re on the list!</h3><p>We\'ll be in touch soon.</p></div>'
    } else {
      throw new Error('Failed')
    }
  } catch (err) {
    submitBtn.disabled = false
    submitBtn.textContent = 'Request Access'
    alert('Something went wrong. Please try again.')
  }
}

if (typeof window !== 'undefined') {
  applyTheme(getPreferredTheme())
}

export default function DartiqMarketingScripts() {
  useLayoutEffect(function () {
    applyTheme(getPreferredTheme())
  }, [])

  useEffect(function () {
    function onThemeClick(e) {
      const btn = e.target.closest('#theme-toggle, #theme-toggle-mobile')
      if (!btn) return
      e.preventDefault()
      toggleTheme()
    }

    const form = document.getElementById('demo-form')
    function onSubmit(e) {
      handleFormSubmit(e)
    }

    document.addEventListener('click', onThemeClick)
    if (form) form.addEventListener('submit', onSubmit)

    return function () {
      document.removeEventListener('click', onThemeClick)
      if (form) form.removeEventListener('submit', onSubmit)
    }
  }, [])

  return null
}
