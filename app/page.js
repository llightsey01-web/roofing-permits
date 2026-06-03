import { readFileSync } from 'fs'
import { join } from 'path'
import DartiqMarketingScripts from './components/DartiqMarketingScripts'

export const metadata = {
  title: 'DartiQ — The Intelligent Permit Platform',
  description:
    'DartiQ automates Florida roofing permits end-to-end, from parcel lookup to recorded NOC to permit submission.',
}

function getMarketingContent() {
  const html = readFileSync(join(process.cwd(), 'app/dartiq-website/page.html'), 'utf8')
  const styles = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || ''
  let body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1] || ''
  body = body.replace(/<script[\s\S]*?<\/script>/gi, '').trim()
  return { styles, body }
}

export default function Home() {
  const { styles, body } = getMarketingContent()

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap"
        rel="stylesheet"
      />
      <style dangerouslySetInnerHTML={{ __html: styles }} />
      <div dangerouslySetInnerHTML={{ __html: body }} />
      <DartiqMarketingScripts />
    </>
  )
}
