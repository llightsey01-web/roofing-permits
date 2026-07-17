const PORTAL_LOGIN_URL = process.env.NEXT_PUBLIC_PORTAL_URL || 'https://portal.dartiq.dev'
const TEMP_PASSWORD_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789'

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function generateTemporaryPassword() {
  var chars = ''
  for (var i = 0; i < 8; i++) {
    chars += TEMP_PASSWORD_CHARS.charAt(Math.floor(Math.random() * TEMP_PASSWORD_CHARS.length))
  }
  return 'DART-' + chars
}

function buildWelcomeEmailHtml({ contractorName, contractorEmail, companyName, tempPassword }) {
  const safeName = escapeHtml(contractorName)
  const safeEmail = escapeHtml(contractorEmail)
  const safePassword = escapeHtml(tempPassword)
  // companyName kept for API compatibility / future personalization
  void companyName

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
        .credentials { background: #fff7ed; border: 1px solid #fdba74; border-radius: 8px; padding: 16px; margin: 20px 0; }
        .credentials p { margin: 6px 0; color: #0f172a; }
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
          <p>Your DART iQ account has been created. Please log in to complete your company setup.</p>
          <p>DART iQ automates your Florida roofing permit applications from start to finish — no more navigating county portals, generating NOCs, or chasing recordings.</p>
          
          <a href="${PORTAL_LOGIN_URL}" class="btn">Log In to Complete Setup →</a>

          <div class="credentials">
            <p><strong>Your login details:</strong></p>
            <p>Email: ${safeEmail}</p>
            <p>Temporary Password: <strong>${safePassword}</strong></p>
            <p><em>You will be prompted to set a new password during setup.</em></p>
          </div>
          
          <div class="steps">
            <p><strong>Next steps:</strong></p>
            <div class="step">
              <div class="step-num">1</div>
              <div><strong>Log in</strong> at portal.dartiq.dev with the email and temporary password above</div>
            </div>
            <div class="step">
              <div class="step-num">2</div>
              <div><strong>Complete company setup</strong> — enter your company, license, and review preferences</div>
            </div>
            <div class="step">
              <div class="step-num">3</div>
              <div><strong>Add portal credentials</strong> in Settings, then submit your first permit</div>
            </div>
          </div>
          <p>Portal: <a href="${PORTAL_LOGIN_URL}">portal.dartiq.dev</a></p>
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

async function sendContractorWelcomeEmail({ contractorName, contractorEmail, companyName, tempPassword }) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[welcome-email] RESEND_API_KEY not set — skipping welcome email')
    return { sent: false, skipped: true }
  }

  if (!contractorEmail) {
    throw new Error('contractorEmail is required')
  }
  if (!tempPassword) {
    throw new Error('tempPassword is required')
  }

  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)
  await resend.emails.send({
    from: 'DART iQ <logan@dartiq.dev>',
    to: contractorEmail,
    subject: 'Welcome to DART iQ — Please complete your company setup',
    html: buildWelcomeEmailHtml({
      contractorName: contractorName || 'there',
      contractorEmail,
      companyName: companyName || 'your company',
      tempPassword,
    }),
  })

  return { sent: true }
}

async function sendContractorOnboardedNotification({ contractorName, contractorEmail, companyName }) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[welcome-email] RESEND_API_KEY not set — skipping onboarding notification')
    return { sent: false, skipped: true }
  }

  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)
  await resend.emails.send({
    from: 'DART iQ <logan@dartiq.dev>',
    to: 'logan@dartiq.dev',
    subject: 'New contractor onboarded: ' + (companyName || 'Unknown company'),
    html: `
      <h2>New contractor onboarded</h2>
      <p><strong>Company:</strong> ${escapeHtml(companyName || 'Unknown company')}</p>
      <p><strong>Contact:</strong> ${escapeHtml(contractorName || 'Unknown')}</p>
      <p><strong>Email:</strong> ${escapeHtml(contractorEmail || 'Unknown')}</p>
      <p><strong>Portal:</strong> <a href="${PORTAL_LOGIN_URL}">portal.dartiq.dev</a></p>
    `,
  })

  return { sent: true }
}

module.exports = {
  PORTAL_LOGIN_URL,
  generateTemporaryPassword,
  buildWelcomeEmailHtml,
  sendContractorWelcomeEmail,
  sendContractorOnboardedNotification,
}
