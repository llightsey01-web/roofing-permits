export default function EnvironmentBadge({ label, variant = 'admin' }) {
  const isAdmin = variant === 'admin'
  return (
    <span style={{
      fontSize: '10px',
      fontWeight: '700',
      letterSpacing: '0.12em',
      textTransform: 'uppercase',
      padding: '4px 10px',
      borderRadius: '999px',
      backgroundColor: isAdmin ? 'rgba(251, 191, 36, 0.15)' : '#ecfdf5',
      color: isAdmin ? '#fcd34d' : '#047857',
      border: '1px solid ' + (isAdmin ? 'rgba(251, 191, 36, 0.35)' : '#a7f3d0'),
    }}>
      {label}
    </span>
  )
}
