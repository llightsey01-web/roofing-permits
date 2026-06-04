// lib/monitoring/alert-service.js
// Centralized alerting for automation failures and system events

const { createClient } = require('@supabase/supabase-js')

const VALID_SEVERITIES = ['critical', 'warning', 'info']
const VALID_TYPES = [
  'automation_failed',
  'login_failed',
  'integration_failed',
  'worker_crashed',
  'stuck_job',
  'worker_stale',
]

function getSupabase() {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return null
  }
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

async function logAlertToSupabase(payload) {
  var supabase = getSupabase()
  if (!supabase) {
    console.warn('[alert] Supabase not configured — alert not persisted')
    return { persisted: false }
  }

  var row = {
    type: payload.type,
    severity: payload.severity,
    job_id: payload.jobId || null,
    company_id: payload.companyId || null,
    message: payload.message,
    details: payload.details || {},
    created_at: new Date().toISOString(),
  }

  var { error } = await supabase.from('system_alerts').insert(row)
  if (error) {
    console.warn('[alert] Failed to persist alert (run migrations for system_alerts):', error.message)
    return { persisted: false, error: error.message }
  }
  return { persisted: true }
}

async function sendEmailAlert(payload) {
  if (!process.env.RESEND_API_KEY && !process.env.SENDGRID_API_KEY && !process.env.ALERT_EMAIL_TO) {
    console.log('[alert] Email not configured — skipping (set RESEND_API_KEY or SENDGRID_API_KEY)')
    return { sent: false, channel: 'email' }
  }
  console.log('[alert] Email channel not wired yet — would send to', process.env.ALERT_EMAIL_TO || '(unset)')
  return { sent: false, channel: 'email', reason: 'not_implemented' }
}

async function sendSmsAlert(payload) {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.log('[alert] SMS not configured — skipping (Twilio A2P pending)')
    return { sent: false, channel: 'sms' }
  }
  console.log('[alert] SMS channel not wired yet')
  return { sent: false, channel: 'sms', reason: 'not_implemented' }
}

/**
 * @param {object} params
 * @param {string} params.type — automation_failed | login_failed | integration_failed | worker_crashed | stuck_job | worker_stale
 * @param {string} params.severity — critical | warning | info
 * @param {string} [params.jobId]
 * @param {string} [params.companyId]
 * @param {string} params.message
 * @param {object} [params.details]
 */
async function sendAlert(params) {
  var type = params.type || 'automation_failed'
  var severity = params.severity || 'warning'
  var message = params.message || 'Unknown alert'
  var details = params.details || {}

  if (VALID_SEVERITIES.indexOf(severity) < 0) {
    severity = 'warning'
  }
  if (VALID_TYPES.indexOf(type) < 0) {
    type = 'automation_failed'
  }

  console.error('[alert] ' + severity.toUpperCase() + ' — ' + type + ': ' + message)
  if (Object.keys(details).length > 0) {
    console.error('[alert] details:', JSON.stringify(details))
  }

  var persistResult = await logAlertToSupabase({
    type: type,
    severity: severity,
    jobId: params.jobId,
    companyId: params.companyId,
    message: message,
    details: details,
  })

  var channels = { email: null, sms: null }
  if (severity === 'critical' || severity === 'warning') {
    channels.email = await sendEmailAlert(params)
    if (severity === 'critical') {
      channels.sms = await sendSmsAlert(params)
    }
  }

  return {
    type: type,
    severity: severity,
    message: message,
    persisted: persistResult.persisted,
    channels: channels,
  }
}

module.exports = {
  sendAlert,
  VALID_SEVERITIES,
  VALID_TYPES,
}
