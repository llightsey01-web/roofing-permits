import { spawn } from 'child_process'
import path from 'path'
import { authenticateRequest, requireSuperAdmin } from '../../../../lib/auth/session.js'

export const dynamic = 'force-dynamic'

/** GET /api/admin/scrape-ahj-forms — last scrape status */
export async function GET(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const { data, error } = await context.supabase
      .from('platform_metrics')
      .select('created_at, metric_value, metadata, metric_date')
      .eq('metric_name', 'ahj_forms_scrape')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      return Response.json({ error: error.message }, { status: 500 })
    }

    if (!data) {
      return Response.json({
        lastScrapedAt: null,
        lastScrapedLabel: 'never',
        summary: null,
      })
    }

    const finishedAt =
      data.metadata?.finishedAt || data.created_at || (data.metric_date ? data.metric_date + 'T00:00:00.000Z' : null)

    return Response.json({
      lastScrapedAt: finishedAt,
      lastScrapedLabel: finishedAt ? new Date(finishedAt).toLocaleString() : 'never',
      summary: data.metadata || null,
      formsFound: data.metric_value,
    })
  } catch (err) {
    console.error('[admin/scrape-ahj-forms] GET error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

/** POST /api/admin/scrape-ahj-forms — start background scrape */
export async function POST(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const scriptPath = path.join(process.cwd(), 'scripts', 'scrape-ahj-forms.js')
    const outDir = path.join(process.cwd(), 'tmp', 'ahj-forms-scrape')
    const logPath = path.join(outDir, 'scrape-log.txt')

    const child = spawn(
      process.execPath,
      [scriptPath],
      {
        cwd: process.cwd(),
        detached: true,
        stdio: ['ignore', 'ignore', 'ignore'],
        env: process.env,
      }
    )
    child.unref()

    console.log('[admin/scrape-ahj-forms] Started scrape pid=', child.pid, 'log=', logPath)

    return Response.json({
      success: true,
      message: 'Scrape started',
      pid: child.pid,
    })
  } catch (err) {
    console.error('[admin/scrape-ahj-forms] POST error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
