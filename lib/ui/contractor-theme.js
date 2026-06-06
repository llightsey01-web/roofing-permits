export const contractorTheme = {
  pageBg: '#0f172a',
  pageBgGradient: 'linear-gradient(180deg, #0f172a 0%, #0b1220 100%)',
  surface: '#1e293b',
  border: '#334155',
  borderStrong: '#475569',
  text: '#ffffff',
  textBody: '#e2e8f0',
  textMuted: '#94a3b8',
  accent: '#3b82f6',
  accentHover: '#2563eb',
  accentSoft: 'rgba(59, 130, 246, 0.12)',
  accentGlow: '0 0 20px rgba(59, 130, 246, 0.35)',
  success: '#16a34a',
  successSoft: 'rgba(22, 163, 74, 0.15)',
  warning: '#f59e0b',
  warningSoft: 'rgba(245, 158, 11, 0.15)',
  error: '#ef4444',
  errorSoft: 'rgba(239, 68, 68, 0.15)',
  headerBg: '#1e293b',
  headerBorder: '#334155',
  navBarBg: '#1e293b',
  navActive: '#3b82f6',
  navActiveBg: 'rgba(59, 130, 246, 0.2)',
  inputBg: '#0f172a',
  badgeBg: 'rgba(59, 130, 246, 0.15)',
  badgeText: '#93c5fd',
  badgeBorder: '#334155',
  shadow: '0 1px 2px rgba(0, 0, 0, 0.3)',
  shadowCard: '0 4px 24px rgba(0, 0, 0, 0.35)',
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif',
  brandName: 'Dart iQ',
  companyLegal: 'Zigamus Technologies, LLC',
  footerYear: '2026',
}

export function contractorCardStyle() {
  return {
    backgroundColor: contractorTheme.surface,
    border: '1px solid ' + contractorTheme.border,
    borderRadius: '12px',
    boxShadow: contractorTheme.shadowCard,
  }
}

export function contractorStatCardStyle(accentColor) {
  return {
    ...contractorCardStyle(),
    padding: '20px 22px',
    borderTop: '3px solid ' + (accentColor || contractorTheme.accent),
  }
}

export function contractorPrimaryButtonStyle(disabled) {
  return {
    fontSize: '15px',
    padding: '12px 22px',
    minHeight: '44px',
    backgroundColor: disabled ? '#475569' : contractorTheme.accent,
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: '600',
    boxShadow: disabled ? 'none' : contractorTheme.accentGlow,
  }
}

export function contractorInputStyle() {
  return {
    width: '100%',
    padding: '11px 14px',
    minHeight: '44px',
    border: '1px solid ' + contractorTheme.border,
    borderRadius: '10px',
    fontSize: '16px',
    boxSizing: 'border-box',
    backgroundColor: contractorTheme.inputBg,
    color: contractorTheme.textBody,
  }
}

export function pageTitle(title) {
  return 'Dart iQ — ' + title
}
