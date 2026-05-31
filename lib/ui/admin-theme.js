export const adminTheme = {
  pageBg: '#0b1120',
  surface: '#131c31',
  surfaceRaised: '#1a2744',
  border: '#2a3655',
  borderSubtle: '#1e293b',
  text: '#e2e8f0',
  textMuted: '#94a3b8',
  textDim: '#64748b',
  accent: '#818cf8',
  accentStrong: '#6366f1',
  warning: '#fbbf24',
  success: '#34d399',
  danger: '#f87171',
  headerBg: '#070d18',
  navActive: '#1e293b',
  badgeBg: 'rgba(251, 191, 36, 0.15)',
  badgeText: '#fcd34d',
  badgeBorder: 'rgba(251, 191, 36, 0.35)',
  fontMono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
}

export function adminStatCardStyle(accentColor) {
  return {
    backgroundColor: adminTheme.surfaceRaised,
    border: '1px solid ' + adminTheme.border,
    borderRadius: '8px',
    padding: '14px 16px',
    borderLeft: '3px solid ' + (accentColor || adminTheme.accent),
  }
}

export function adminPanelStyle() {
  return {
    backgroundColor: adminTheme.surface,
    border: '1px solid ' + adminTheme.border,
    borderRadius: '8px',
    overflow: 'hidden',
  }
}
