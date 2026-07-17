import { createRequire } from 'module'
import { authenticateRequest, requireSuperAdmin } from '../../../../lib/auth/session.js'
import {
  generateTemporaryPassword,
  sendContractorWelcomeEmail,
  sendContractorOnboardedNotification,
  PORTAL_LOGIN_URL,
} from '../../../../lib/email/contractor-welcome.js'

const require = createRequire(import.meta.url)
const {
  inferCountyIdFromPortal,
  providerForPortal,
  providerForCountyId,
} = require('../../../../lib/ahj/county-options.js')

function slugFromPortal(portal) {
  const raw = String(portal?.name || portal?.county_or_city || portal?.id || 'county')
  return raw.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'county'
}

export async function POST(request) {
  try {
    let context = await authenticateRequest(request)
    context = await requireSuperAdmin(context)
    if (context.error) {
      return Response.json({ error: context.error }, { status: context.status })
    }

    const body = await request.json()
    const company = body.company || {}
    const owner = body.owner || {}
    const ahjs = Array.isArray(body.ahjs) ? body.ahjs : []

    const ownerEmail = typeof owner.email === 'string' ? owner.email.trim().toLowerCase() : ''
    const firstName = typeof owner.first_name === 'string' ? owner.first_name.trim() : ''
    const lastName = typeof owner.last_name === 'string' ? owner.last_name.trim() : ''
    const fullName = (firstName + ' ' + lastName).trim()
    const ownerPhone = owner.phone ? String(owner.phone).trim() : null

    if (!ownerEmail || !firstName || !lastName) {
      return Response.json({ error: 'Owner first name, last name, and email are required' }, { status: 400 })
    }

    const trialDays = Number(company.trial_days) || 30
    const trialEndsAt = new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000).toISOString()
    const placeholderName = fullName + ' (Pending Setup)'

    // Resolve portals for selected AHJs
    const { data: portals } = await context.supabase
      .from('ahj_portals')
      .select('id, name, county_or_city, credential_key')
      .eq('is_active', true)

    const portalById = {}
    ;(portals || []).forEach(function (p) { portalById[p.id] = p })

    const coveredCounties = []
    const resolvedAhjs = []
    for (let i = 0; i < ahjs.length; i++) {
      const raw = ahjs[i] || {}
      const portal = portalById[raw.portal_id || raw.id]
        || (portals || []).find(function (p) {
          const hay = ((p.name || '') + ' ' + (p.county_or_city || '')).toLowerCase()
          const needle = String(raw.label || raw.name || raw.id || '').toLowerCase()
          return needle && hay.includes(needle.split(' ')[0])
        })
        || null

      const countyId = portal
        ? (inferCountyIdFromPortal(portal) || slugFromPortal(portal))
        : String(raw.id || '').toLowerCase()

      if (countyId && coveredCounties.indexOf(countyId) === -1) {
        coveredCounties.push(countyId)
      }

      resolvedAhjs.push({
        countyId: countyId,
        portal: portal,
        provider: portal
          ? (providerForPortal(portal) || providerForCountyId(countyId) || (slugFromPortal(portal) + '_portal'))
          : (raw.provider || providerForCountyId(countyId) || 'ahj_portal'),
      })
    }

    const { data: createdCompany, error: companyError } = await context.supabase
      .from('companies')
      .insert({
        name: placeholderName,
        primary_email: ownerEmail,
        phone: ownerPhone,
        is_active: true,
        onboarding_status: 'pending',
        onboarding_step: 1,
        onboarding_completed_at: null,
        subscription_plan: company.subscription_plan || 'starter',
        subscription_status: 'trial',
        trial_ends_at: trialEndsAt,
        notes: company.notes || null,
        covered_counties: coveredCounties,
        review_gates: {
          auto_approve_all: true,
          noc_before_send: false,
          permit_before_submit: false,
        },
      })
      .select('*')
      .single()

    if (companyError || !createdCompany) {
      return Response.json({
        error: 'Failed to create company: ' + (companyError?.message || 'unknown'),
      }, { status: 500 })
    }

    const tempPassword = generateTemporaryPassword()
    let authUser = null

    const { data: createdAuth, error: createUserError } = await context.supabase.auth.admin.createUser({
      email: ownerEmail,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        company_id: createdCompany.id,
        full_name: fullName,
        role: 'company_admin',
        must_change_password: true,
      },
    })

    if (createUserError) {
      if (/already registered|already been registered|already exists/i.test(createUserError.message)) {
        console.log('[onboard] Auth user already exists for', ownerEmail, '— finding and reusing')

        let existing = null
        let page = 1
        const perPage = 200
        while (page <= 20 && !existing) {
          const { data: listData, error: listError } = await context.supabase.auth.admin.listUsers({
            page: page,
            perPage: perPage,
          })
          if (listError) {
            console.error('[onboard] listUsers failed:', listError.message)
            await context.supabase.from('companies').delete().eq('id', createdCompany.id)
            return Response.json({ error: 'Failed to look up existing auth user' }, { status: 500 })
          }
          const users = listData?.users || []
          existing = users.find(function (u) {
            return String(u.email || '').trim().toLowerCase() === ownerEmail
          }) || null
          if (users.length < perPage) break
          page += 1
        }

        if (existing) {
          const { error: updateError } = await context.supabase.auth.admin.updateUserById(existing.id, {
            password: tempPassword,
            email_confirm: true,
            user_metadata: {
              company_id: createdCompany.id,
              full_name: fullName,
              role: 'company_admin',
              must_change_password: true,
            },
          })

          if (updateError) {
            console.error('[onboard] Failed to update existing auth user:', updateError.message)
            await context.supabase.from('companies').delete().eq('id', createdCompany.id)
            return Response.json({
              error: 'Failed to reset user password: ' + updateError.message,
            }, { status: 500 })
          }

          authUser = existing
          console.log('[onboard] Reusing and reset auth user:', existing.id)
        } else {
          await context.supabase.from('companies').delete().eq('id', createdCompany.id)
          return Response.json({
            error: 'This email is already in use. Please delete the existing auth user from Supabase or use a different email.',
          }, { status: 400 })
        }
      } else {
        console.error('[onboard] Create user failed:', createUserError.message)
        await context.supabase.from('companies').delete().eq('id', createdCompany.id)
        return Response.json({ error: createUserError.message }, { status: 400 })
      }
    } else {
      authUser = createdAuth?.user || null
    }

    if (!authUser?.id) {
      await context.supabase.from('companies').delete().eq('id', createdCompany.id)
      return Response.json({ error: 'Failed to create or resolve auth user' }, { status: 500 })
    }

    // Upsert user record in users table (handles both new and existing)
    const { error: userRecordError } = await context.supabase
      .from('users')
      .upsert({
        id: authUser.id,
        company_id: createdCompany.id,
        email: ownerEmail,
        full_name: fullName,
        role: 'company_admin',
      }, { onConflict: 'id' })

    if (userRecordError) {
      console.error('[onboard] User record upsert failed:', userRecordError.message)
      return Response.json({ error: 'Failed to create user record: ' + userRecordError.message }, { status: 500 })
    }

    await context.supabase
      .from('companies')
      .update({ owner_user_id: authUser.id })
      .eq('id', createdCompany.id)

    const credentialRows = []
    for (let i = 0; i < resolvedAhjs.length; i++) {
      const item = resolvedAhjs[i]
      credentialRows.push({
        company_id: createdCompany.id,
        provider: item.provider,
        ahj_id: item.portal?.id || null,
        credential_type: 'ahj_portal',
        is_active: true,
      })
    }

    if (credentialRows.length > 0) {
      const { error: credError } = await context.supabase
        .from('company_credentials')
        .upsert(credentialRows, { onConflict: 'company_id,provider,ahj_id', ignoreDuplicates: true })
      if (credError) {
        console.warn('[admin/onboard] credential placeholders failed:', credError.message)
      }
    }

    let emailResult = { sent: false }
    let notificationResult = { sent: false }
    try {
      emailResult = await sendContractorWelcomeEmail({
        contractorName: firstName,
        contractorEmail: ownerEmail,
        companyName: placeholderName,
        tempPassword,
      })
      notificationResult = await sendContractorOnboardedNotification({
        contractorName: fullName,
        contractorEmail: ownerEmail,
        companyName: placeholderName,
      })
    } catch (emailErr) {
      console.error('[admin/onboard] onboarding email flow failed:', emailErr.message)
    }

    return Response.json({
      success: true,
      company_id: createdCompany.id,
      user_id: authUser.id,
      login_url: PORTAL_LOGIN_URL,
      welcome_email_sent: !!emailResult.sent,
      notification_email_sent: !!notificationResult.sent,
      covered_counties: coveredCounties,
      reused_existing_auth_user: !!(createUserError),
    })
  } catch (err) {
    console.error('[admin/onboard] Error:', err.message)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
