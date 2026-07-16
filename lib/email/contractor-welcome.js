const PORTAL_LOGIN_URL = process.env.NEXT_PUBLIC_PORTAL_URL || 'https://portal.dartiq.dev'

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function buildWelcomeEmailHtml({ contractorName, contractorEmail, companyName }) {
  const safeName = escapeHtml(contractorName)
  const safeEmail = escapeHtml(contractorEmail)
  const safeCompany = escapeHtml(companyName)

  return `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; background: #f8fafc; margin: 0; padding: 0; }
        .container { max-width: 600px; margin: 40px auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .header { background: #0f172a; padding: 32px; text-align: center; }
        .header h1 { color: white; margin: 0; font-size: 24px; }
        .header p { color: #94a3b8; margin: 8px 0 0; }
        .body { padding: 32px; }
        .body h2 { color: #0f172a; }
        .body p { color: #475569; line-height: 1.6; }
        .steps { background: #f8fafc; border-radius: 8px; padding: 20px; margin: 24px 0; }
        .step { display: flex; align-items: flex-start; margin-bottom: 16px; }
        .step-num { background: #f97316; color: white; width: 24px; height: 24px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: bold; margin-right: 12px; flex-shrink: 0; }
        .btn { display: inline-block; background: #f97316; color: white; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: bold; margin: 16px 0; }
        .footer { background: #f8fafc; padding: 24px; text-align: center; color: #94a3b8; font-size: 13px; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>DART iQ</h1>
          <p>Intelligent Permit Automation</p>
        </div>
        <div class="body">
          <h2>Welcome, ${safeName}!</h2>
          <p>Your DART iQ account for <strong>${safeCompany}</strong> has been set up and is ready to use.</p>
          <p>DART iQ automates your Florida roofing permit applications from start to finish — no more navigating county portals, generating NOCs, or chasing recordings.</p>
          
          <a href="${PORTAL_LOGIN_URL}" class="btn">Log In to Your Portal →</a>
          
          <div class="steps">
            <p><strong>Getting Started:</strong></p>
            <div class="step">
              <div class="step-num">1</div>
              <div><strong>Log in</strong> at portal.dartiq.dev using your email address</div>
            </div>
            <div class="step">
              <div class="step-num">2</div>
              <div><strong>Submit your first job</strong> — enter the property address and owner info</div>
            </div>
            <div class="step">
              <div class="step-num">3</div>
              <div><strong>We handle the rest</strong> — NOC generation, notarization, recording, and permit submission</div>
            </div>
          </div>
          <p><strong>Your login details:</strong></p>
          <p>Email: ${safeEmail}<br>
          Portal: <a href="${PORTAL_LOGIN_URL}">portal.dartiq.dev</a></p>
          <p>If you have any questions reach us at <a href="mailto:logan@dartiq.dev">logan@dartiq.dev</a></p>
        </div>
        <div class="footer">
          <p>© 2026 Zigamus Technologies, LLC — DART iQ</p>
          <p>Currently serving Florida roofing contractors</p>
        </div>
      </div>
    </body>
    </html>
  `
}

async function sendContractorWelcomeEmail({ contractorName, contractorEmail, companyName }) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[welcome-email] RESEND_API_KEY not set — skipping welcome email')
    return { sent: false, skipped: true }
  }

  if (!contractorEmail) {
    throw new Error('contractorEmail is required')
  }

  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)
  await resend.emails.send({
    from: 'DART iQ <logan@dartiq.dev>',
    to: contractorEmail,
    subject: 'Welcome to DART iQ — Your Account is Ready',
    html: buildWelcomeEmailHtml({
      contractorName: contractorName || 'there',
      contractorEmail,
      companyName: companyName || 'your company',
    }),
  })

  return { sent: true }
}

module.exports = {
  PORTAL_LOGIN_URL,
  buildWelcomeEmailHtml,
  sendContractorWelcomeEmail,
}
