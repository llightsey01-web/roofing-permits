export const contractorTheme = {
  pageBg: '#ffffff',
  pageBgGradient: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 40%)',
  surface: '#ffffff',
  border: '#e2e8f0',
  borderStrong: '#cbd5e1',
  text: '#0f172a',
  textBody: '#334155',
  textMuted: '#64748b',
  accent: '#3b82f6',
  accentHover: '#2563eb',
  accentSoft: '#eff6ff',
  success: '#16a34a',
  successSoft: '#dcfce7',
  warning: '#d97706',
  warningSoft: '#fef3c7',
  error: '#ef4444',
  errorSoft: '#fee2e2',
  headerBg: '#ffffff',
  headerBorder: '#e2e8f0',
  navActive: '#3b82f6',
  navActiveBg: '#eff6ff',
  badgeBg: '#eff6ff',
  badgeText: '#1d4ed8',
  badgeBorder: '#bfdbfe',
  shadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
  shadowCard: '0 4px 12px rgba(15, 23, 42, 0.06)',
  fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif',
  brandName: 'Dart iQ',
  companyLegal: 'Lightsey Technologies, LLC',
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
    backgroundColor: disabled ? '#94a3b8' : contractorTheme.accent,
    color: '#ffffff',
    border: 'none',
    borderRadius: '10px',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: '600',
    boxShadow: disabled ? 'none' : contractorTheme.shadow,
  }
}

export function pageTitle(title) {
  return 'Dart iQ — ' + title
}
