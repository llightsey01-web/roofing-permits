import { readFileSync } from 'fs'
import { join } from 'path'
import Script from 'next/script'
import DartiqMarketingScripts from './components/DartiqMarketingScripts'

export const metadata = {
  title: 'Dart iQ — The Intelligent Permit Platform',
  description:
    'Dart iQ automates Florida roofing permits end-to-end, from parcel lookup to recorded NOC to permit submission.',
}

function getMarketingContent() {
  const html = readFileSync(join(process.cwd(), 'app/dartiq-website/page.html'), 'utf8')
  const styles = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || ''
  let body = html.match(/<body>([\s\S]*?)<\/body>/)?.[1] || ''
  const scripts = []
  body = body.replace(/<script[\s\S]*?>([\s\S]*?)<\/script>/gi, (_, content) => {
    scripts.push(content.trim())
    return ''
  }).trim()
  return { styles, body, scripts }
}

export default function Home() {
  const { styles, body, scripts } = getMarketingContent()

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
      {scripts.map(function (content, index) {
        return (
          <Script key={index} id={'marketing-inline-' + index} strategy="afterInteractive">
            {content}
          </Script>
        )
      })}
      <DartiqMarketingScripts />
    </>
  )
}
