import { readFileSync } from 'fs'
import { join } from 'path'
import DartiqLegalLayout from '../components/DartiqLegalLayout'

export const metadata = {
  title: 'Privacy Policy — DART iQ',
  description: 'Privacy Policy for DART iQ by Zigamus Technologies, LLC.',
}

function getPolicyBody() {
  return readFileSync(join(process.cwd(), 'app/privacy/policy-body.html'), 'utf8')
}

export default function PrivacyPage() {
  const policyHtml = getPolicyBody()

  return (
    <DartiqLegalLayout>
      <div
        className="dartiq-legal-content"
        dangerouslySetInnerHTML={{ __html: policyHtml }}
      />
    </DartiqLegalLayout>
  )
}
