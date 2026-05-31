export const contractorTheme = {
  pageBg: '#f0f9ff',
  pageBgGradient: 'linear-gradient(180deg, #f0f9ff 0%, #f8fafc 48%)',
  surface: '#ffffff',
  border: '#e0f2fe',
  borderStrong: '#bae6fd',
  text: '#0c4a6e',
  textBody: '#334155',
  textMuted: '#64748b',
  accent: '#0284c7',
  accentSoft: '#e0f2fe',
  success: '#059669',
  successSoft: '#d1fae5',
  headerBg: '#ffffff',
  headerBorder: '#bae6fd',
  navActive: '#0284c7',
  navActiveBg: '#e0f2fe',
  badgeBg: '#ecfdf5',
  badgeText: '#047857',
  badgeBorder: '#a7f3d0',
  shadow: '0 1px 3px rgba(2, 132, 199, 0.08)',
  shadowCard: '0 4px 14px rgba(2, 132, 199, 0.06)',
}

export function contractorCardStyle() {
  return {
    backgroundColor: contractorTheme.surface,
    border: '1px solid ' + contractorTheme.border,
    borderRadius: '16px',
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
