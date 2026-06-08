import { readFileSync } from 'fs'
import { join } from 'path'
import DartiqLegalLayout from '../components/DartiqLegalLayout'

export const metadata = {
  title: 'Terms of Service — DART iQ',
  description: 'Terms of Service for DART iQ by Zigamus Technologies, LLC.',
}

function getTermsBody() {
  return readFileSync(join(process.cwd(), 'app/terms/terms-body.html'), 'utf8')
}

export default function TermsPage() {
  const termsHtml = getTermsBody()

  return (
    <DartiqLegalLayout>
      <div
        className="dartiq-legal-content"
        dangerouslySetInnerHTML={{ __html: termsHtml }}
      />
    </DartiqLegalLayout>
  )
}
