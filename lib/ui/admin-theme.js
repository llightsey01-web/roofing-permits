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
  navAccent: '#3b82f6',
  badgeBg: 'rgba(251, 191, 36, 0.15)',
  badgeText: '#fcd34d',
  badgeBorder: 'rgba(251, 191, 36, 0.35)',
  fontMono: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
  sidebarWidth: '220px',
}

/** Shared shell tokens for admin + contractor sidebars (keep in sync). */
export const portalShellTheme = adminTheme

export function portalShellRootStyle() {
  return {
    minHeight: '100vh',
    backgroundColor: portalShellTheme.pageBg,
    color: portalShellTheme.text,
    display: 'flex',
  }
}

export function portalAsideStyle() {
  return {
    width: portalShellTheme.sidebarWidth,
    flexShrink: 0,
    backgroundColor: portalShellTheme.headerBg,
    borderRight: '1px solid ' + portalShellTheme.border,
    display: 'flex',
    flexDirection: 'column',
    minHeight: '100vh',
    position: 'sticky',
    top: 0,
    alignSelf: 'flex-start',
  }
}

export function portalNavItemStyle(active) {
  return {
    textAlign: 'left',
    fontSize: '13px',
    padding: '10px 12px',
    borderRadius: '6px',
    border: 'none',
    cursor: 'pointer',
    fontFamily: portalShellTheme.fontMono,
    backgroundColor: active ? portalShellTheme.navActive : 'transparent',
    color: active ? portalShellTheme.text : portalShellTheme.textMuted,
    fontWeight: active ? '600' : '400',
    borderLeft: active
      ? '3px solid ' + portalShellTheme.navAccent
      : '3px solid transparent',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    width: '100%',
  }
}

export function portalSectionLabelStyle() {
  return {
    fontSize: '10px',
    fontWeight: '600',
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: portalShellTheme.textDim,
    fontFamily: portalShellTheme.fontMono,
    padding: '12px 12px 6px',
    margin: 0,
  }
}

export function portalSignOutButtonStyle() {
  return {
    width: '100%',
    fontSize: '11px',
    padding: '8px 12px',
    border: '1px solid ' + portalShellTheme.border,
    borderRadius: '6px',
    backgroundColor: portalShellTheme.surface,
    color: portalShellTheme.textMuted,
    cursor: 'pointer',
    fontFamily: portalShellTheme.fontMono,
  }
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
