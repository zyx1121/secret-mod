import { describe, expect, test } from 'claude-code/testing'

import { envFor, envPrefix, keychainAttr, mask, toHex } from '../hooks/secrets'

describe('secrets', () => {
  test('names map to env vars', async () => {
    expect(envPrefix('nycu-portal')).toBe('NYCU_PORTAL')
    expect(envFor('demo', 's3cret', 'me@x.tw')).toEqual({ DEMO: 's3cret', DEMO_ACCOUNT: 'me@x.tw' })
  })

  test('a multi-field value adds one var per field', async () => {
    const env = envFor('smtp', JSON.stringify({ user: 'u1', password: 'pw-123' }), 'token')
    expect(env.SMTP_USER).toBe('u1')
    expect(env.SMTP_PASSWORD).toBe('pw-123')
  })

  test('values in output are masked at any length', async () => {
    const out = mask('token=s3cret-value id=abc s3cret-value', [{ name: 'demo', values: ['s3cret-value', 'abc'] }])
    expect(out).toBe('token=[kilo/demo] id=[kilo/demo] [kilo/demo]')
  })

  test('the keychain value is hex of its UTF-8 bytes', async () => {
    expect(toHex('é"')).toBe('c3a922')
  })

  test('keychain attributes read as text or hex', async () => {
    expect(keychainAttr('    "acct"<blob>="token"', 'acct')).toBe('token')
    expect(keychainAttr('    "icmt"<blob>=0x4F4BEFBC9B  "OK\\357\\274\\233"', 'icmt')).toBe('OK；')
    expect(keychainAttr('    "icmt"<blob>=<NULL>', 'icmt')).toBe('')
  })
})
