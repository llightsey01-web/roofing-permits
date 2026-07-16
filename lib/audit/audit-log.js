'use strict'

async function writeAuditLog(supabase, entry) {
  try {
    const { error } = await supabase.from('audit_log').insert({
      actor_user_id: entry.actorUserId || null,
      actor_email: entry.actorEmail || null,
      action: entry.action,
      entity_type: entry.entityType || null,
      entity_id: entry.entityId || null,
      company_id: entry.companyId || null,
      metadata: entry.metadata || {},
      created_at: new Date().toISOString(),
    })
    if (error) {
      console.warn('[audit_log] insert failed:', error.message)
      return { ok: false, error: error.message }
    }
    return { ok: true }
  } catch (err) {
    console.warn('[audit_log] error:', err.message)
    return { ok: false, error: err.message }
  }
}

module.exports = { writeAuditLog }
