import DartiqLegalLayout from '../components/DartiqLegalLayout'
import { termsBodyHtml } from './terms-content'

export const metadata = {
  title: 'Terms of Service — DART iQ',
  description: 'Terms of Service for DART iQ by Zigamus Technologies, LLC.',
}

export default function TermsPage() {
  return (
    <DartiqLegalLayout>
      <div
        className="dartiq-legal-content"
        dangerouslySetInnerHTML={{ __html: termsBodyHtml }}
      />
    </DartiqLegalLayout>
  )
}
