const PORTAL_LOGIN_URL = process.env.NEXT_PUBLIC_PORTAL_URL || 'https://portal.dartiq.dev'

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function emailShell({ title, bodyHtml }) {
  return `
    <!DOCTYPE html>
    <html>
    <body style="font-family: Arial, sans-serif; background: #f8fafc; margin: 0; padding: 24px;">
      <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        <div style="background: #0f172a; padding: 28px; text-align: center;">
          <h1 style="color: white; margin: 0; font-size: 22px;">DART iQ</h1>
        </div>
        <div style="padding: 28px;">
          <h2 style="color: #0f172a; margin-top: 0;">${title}</h2>
          ${bodyHtml}
          <p style="color: #475569;">— The DART iQ Team</p>
        </div>
        <div style="background: #f8fafc; padding: 18px; text-align: center; color: #94a3b8; font-size: 13px; border-top: 1px solid #e2e8f0;">
          © 2026 Zigamus Technologies, LLC
        </div>
      </div>
    </body>
    </html>
  `
}

async function sendWithResend({ to, subject, html }) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.warn('[approval-email] RESEND_API_KEY not set — skipping email')
    return { sent: false, skipped: true }
  }
  if (!to) throw new Error('recipient email is required')

  const { Resend } = await import('resend')
  const resend = new Resend(apiKey)
  await resend.emails.send({
    from: 'DART iQ <logan@dartiq.dev>',
    to,
    subject,
    html,
  })
  return { sent: true }
}

async function sendContractorApprovalEmail({ contractorName, contractorEmail, companyName }) {
  const name = escapeHtml(contractorName || 'there')
  const company = escapeHtml(companyName || 'your company')
  return sendWithResend({
    to: contractorEmail,
    subject: 'Your DART iQ Account is Approved!',
    html: emailShell({
      title: 'Account approved',
      bodyHtml: `
        <p style="color: #475569; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #475569; line-height: 1.6;">
          Your DART iQ account for <strong>${company}</strong> has been reviewed and approved.
          You can now log in and start submitting permits.
        </p>
        <p style="margin: 24px 0;">
          <a href="${PORTAL_LOGIN_URL}" style="display: inline-block; background: #f97316; color: white; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: bold;">
            Log In to Portal →
          </a>
        </p>
        <p style="color: #475569;">If you have any questions contact us at <a href="mailto:logan@dartiq.dev">logan@dartiq.dev</a></p>
      `,
    }),
  })
}

async function sendContractorRequestChangesEmail({ contractorName, contractorEmail, companyName, notes }) {
  const name = escapeHtml(contractorName || 'there')
  const company = escapeHtml(companyName || 'your company')
  const safeNotes = escapeHtml(notes || '').replace(/\n/g, '<br>')
  return sendWithResend({
    to: contractorEmail,
    subject: 'Action Required — DART iQ Account Review',
    html: emailShell({
      title: 'Action required',
      bodyHtml: `
        <p style="color: #475569; line-height: 1.6;">Hi ${name},</p>
        <p style="color: #475569; line-height: 1.6;">
          We reviewed your DART iQ account for <strong>${company}</strong> and need a few updates before we can approve it.
        </p>
        <p style="color: #0f172a; font-weight: 700;">What needs to be updated:</p>
        <div style="background: #fff7ed; border: 1px solid #fdba74; border-radius: 8px; padding: 14px; color: #0f172a; line-height: 1.6;">
          ${safeNotes}
        </div>
        <p style="color: #475569; line-height: 1.6; margin-top: 18px;">Please log in and update your information:</p>
        <p style="margin: 24px 0;">
          <a href="${PORTAL_LOGIN_URL}" style="display: inline-block; background: #f97316; color: white; padding: 14px 28px; border-radius: 6px; text-decoration: none; font-weight: bold;">
            Log In to Portal →
          </a>
        </p>
        <p style="color: #475569;">If you have questions contact <a href="mailto:logan@dartiq.dev">logan@dartiq.dev</a></p>
      `,
    }),
  })
}

module.exports = {
  sendContractorApprovalEmail,
  sendContractorRequestChangesEmail,
}
