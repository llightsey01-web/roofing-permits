/**
 * Lightweight Trigger client marker — real auth uses TRIGGER_SECRET_KEY env.
 */

export function getTriggerEnv() {
  return {
    configured: Boolean((process.env.TRIGGER_SECRET_KEY || '').trim()),
    projectRef: process.env.TRIGGER_PROJECT_REF || null,
    appUrl: process.env.NEXT_PUBLIC_APP_URL || null,
  }
}
