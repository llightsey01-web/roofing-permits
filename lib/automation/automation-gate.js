/**
 * Platform automation gate — workers skip claiming new runs when disabled.
 * Fail closed: missing row / query error => treated as paused.
 */
async function isAutomationEnabled(supabase) {
  try {
    var { data, error } = await supabase
      .from('platform_settings')
      .select('value')
      .eq('key', 'automation_enabled')
      .maybeSingle()

    if (error) {
      console.warn('[automation-gate] lookup failed — treating as paused:', error.message)
      return false
    }

    return data && data.value === 'true'
  } catch (err) {
    console.warn('[automation-gate] error — treating as paused:', err.message)
    return false
  }
}

module.exports = { isAutomationEnabled }
