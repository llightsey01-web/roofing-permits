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
    function handleSubmit(e) {
      e.preventDefault()
      if (form) form.style.display = 'none'
      const success = document.getElementById('form-success')
      if (success) success.classList.add('visible')
    }

    document.addEventListener('click', onThemeClick)
    if (form) form.addEventListener('submit', handleSubmit)

    return function () {
      document.removeEventListener('click', onThemeClick)
      if (form) form.removeEventListener('submit', handleSubmit)
    }
  }, [])

  return null
}
