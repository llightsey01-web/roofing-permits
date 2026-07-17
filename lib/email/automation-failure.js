'use strict'

/**
 * Email alert when automation fails after max attempts.
 */
async function sendAutomationFailureEmail(opts) {
  var options = opts || {}
  var apiKey = process.env.RESEND_API_KEY
  if (!apiKey) {
    console.log('[automation-failure-email] RESEND_API_KEY not set — skipping')
    return { sent: false, reason: 'no_api_key' }
  }

  var to = process.env.ALERT_EMAIL_TO || 'logan@dartiq.dev'
  var adminBase = process.env.NEXT_PUBLIC_ADMIN_URL
    || process.env.NEXT_PUBLIC_APP_URL
    || 'https://portal.dartiq.dev'
  var jobUrl = String(adminBase).replace(/\/$/, '') + '/admin/jobs/' + (options.jobId || '')

  var subject = 'DART iQ Automation Failed — ' + (options.propertyAddress || options.jobId || 'Job')
  var html = [
    '<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">',
    '<h2 style="margin:0 0 12px">Automation run failed</h2>',
    '<p><strong>Address:</strong> ' + escapeHtml(options.propertyAddress || '—') + '</p>',
    '<p><strong>Company:</strong> ' + escapeHtml(options.companyName || '—') + '</p>',
    '<p><strong>Failed step:</strong> ' + escapeHtml(options.stepName || options.runType || '—') + '</p>',
    '<p><strong>Error:</strong> ' + escapeHtml(options.errorMessage || '—') + '</p>',
    '<p><a href="' + jobUrl + '" style="display:inline-block;margin-top:12px;padding:10px 16px;background:#2563eb;color:#fff;text-decoration:none;border-radius:8px">Open job in admin</a></p>',
    options.screenshotPath
      ? '<p style="color:#64748b;font-size:13px">Screenshot saved: ' + escapeHtml(options.screenshotPath) + '</p>'
      : '',
    '<p style="color:#94a3b8;font-size:12px;margin-top:24px">— DART iQ Operations</p>',
    '</div>',
  ].join('')

  try {
    var { Resend } = await import('resend')
    var resend = new Resend(apiKey)
    var payload = {
      from: 'DART iQ <logan@dartiq.dev>',
      to: [to],
      subject: subject,
      html: html,
    }
    await resend.emails.send(payload)
    return { sent: true, to: to }
  } catch (err) {
    console.error('[automation-failure-email] failed:', err.message)
    return { sent: false, error: err.message }
  }
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

module.exports = { sendAutomationFailureEmail }
