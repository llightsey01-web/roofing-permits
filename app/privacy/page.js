import DartiqLegalLayout from '../components/DartiqLegalLayout'
import { policyBodyHtml } from './policy-content'

export const metadata = {
  title: 'Privacy Policy — DART iQ',
  description: 'Privacy Policy for DART iQ by Zigamus Technologies, LLC.',
}

export default function PrivacyPage() {
  return (
    <DartiqLegalLayout>
      <div
        className="dartiq-legal-content"
        dangerouslySetInnerHTML={{ __html: policyBodyHtml }}
      />
    </DartiqLegalLayout>
  )
}
