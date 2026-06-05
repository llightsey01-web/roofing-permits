// tests/unit/credential-loader.test.js
'use strict'

jest.mock('@supabase/supabase-js', function () {
  const mockMaybeSingle = jest.fn()
  const mockUpdateEq = jest.fn().mockResolvedValue({ error: null })

  function mockBuildSupabaseClient() {
    const chain = {
      select: jest.fn(function () { return chain }),
      eq: jest.fn(function () { return chain }),
      is: jest.fn(function () { return chain }),
      maybeSingle: mockMaybeSingle,
      update: jest.fn(function () {
        return { eq: mockUpdateEq }
      }),
    }
    return { from: jest.fn(function () { return chain }) }
  }

  return {
    createClient: jest.fn(mockBuildSupabaseClient),
    __mockMaybeSingle: mockMaybeSingle,
  }
})

const supabaseJs = require('@supabase/supabase-js')

describe('credential-loader', function () {
  let getCredential

  beforeEach(function () {
    jest.resetModules()
    supabaseJs.__mockMaybeSingle.mockReset()
    supabaseJs.__mockMaybeSingle.mockResolvedValue({ data: null, error: null })
    process.env.CREDENTIAL_VAULT_ENABLED = 'false'
    process.env.NODE_ENV = 'test'
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    delete process.env.EPN_EMAIL
    delete process.env.EPN_PASSWORD
    delete process.env.PROOF_EMAIL
    delete process.env.PROOF_PASSWORD
    delete process.env.TWOCAPTCHA_API_KEY
    delete process.env.POLK_COUNTY_USERNAME
    delete process.env.POLK_COUNTY_PASSWORD
    getCredential = require('../../lib/credentials/credential-loader.js').getCredential
  })

  test('getCredential returns supabase shape', async function () {
    const creds = await getCredential({ provider: 'supabase' })
    expect(creds).toEqual({
      url: 'https://example.supabase.co',
      anonKey: 'anon-key',
      serviceRoleKey: 'service-role-key',
    })
  })

  test('getCredential returns epn shape from env when vault is empty', async function () {
    process.env.EPN_EMAIL = 'epn@test.com'
    process.env.EPN_PASSWORD = 'epn-secret'
    const creds = await getCredential({ provider: 'epn' })
    expect(creds).toEqual({ email: 'epn@test.com', password: 'epn-secret' })
  })

  test('getCredential returns proof shape from env when vault is empty', async function () {
    process.env.PROOF_EMAIL = 'proof@test.com'
    process.env.PROOF_PASSWORD = 'proof-secret'
    const creds = await getCredential({ provider: 'proof' })
    expect(creds).toEqual({ email: 'proof@test.com', password: 'proof-secret' })
  })

  test('getCredential returns twocaptcha apiKey from env', async function () {
    process.env.TWOCAPTCHA_API_KEY = 'captcha-key-123'
    const creds = await getCredential({ provider: 'twocaptcha' })
    expect(creds).toEqual({ apiKey: 'captcha-key-123' })
  })

  test('getCredential returns polk county username/password from env', async function () {
    process.env.POLK_COUNTY_USERNAME = 'polk-user'
    process.env.POLK_COUNTY_PASSWORD = 'polk-pass'
    const creds = await getCredential({ provider: 'polk_county' })
    expect(creds).toEqual({ username: 'polk-user', password: 'polk-pass' })
  })

  test('missing provider credentials throw correct error', async function () {
    await expect(getCredential({ provider: 'epn' })).rejects.toThrow(
      'Missing company credential for provider epn'
    )
  })

  test('provider is required', async function () {
    await expect(getCredential({})).rejects.toThrow('provider is required')
  })
})
