import DartiqLegalLayout from '../components/DartiqLegalLayout'

export const metadata = {
  title: 'Terms of Service — DART iQ',
  description: 'Terms of Service for DART iQ by Zigamus Technologies, LLC.',
}

export default function TermsPage() {
  return (
    <DartiqLegalLayout title="Terms of Service">
      <p className="dartiq-legal-placeholder">
        Terms of Service coming soon. For questions contact{' '}
        <a href="mailto:logan@dartiq.dev">logan@dartiq.dev</a>.
      </p>
    </DartiqLegalLayout>
  )
}
