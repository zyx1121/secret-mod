import { describe, expect, test } from 'claude-code/testing'

import { envFor, envPrefix, globalValues, keychainAttr, mask, maskDeep, readsKeychain, toHex, variants } from '../hooks/secrets'

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

  test('non-secret fields stay out of the global set', async () => {
    const v = globalValues('db', JSON.stringify({ host: 'db.internal.example', password: 'pw-1234567' }))
    expect(v).toContain('pw-1234567')
    expect(v).not.toContain('db.internal.example')
    expect(envFor('db', JSON.stringify({ host: 'db.internal.example' }), '').DB_HOST).toBe('db.internal.example')
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

  test('variants cover base64, URL and hex', async () => {
    const v = variants('p@ss/word+1')
    expect(v).toContain('p@ss/word+1')
    expect(v).toContain(btoa('p@ss/word+1').replace(/=+$/, ''))
    expect(v).toContain(btoa('p@ss/word+1\n').replace(/=+$/, ''))
    expect(v).toContain(encodeURIComponent('p@ss/word+1'))
    expect(v).toContain(toHex('p@ss/word+1'))
  })

  test('maskDeep masks nested strings and reports no match', async () => {
    const s = [{ name: 'demo', values: ['s3cret-value'] }]
    expect(maskDeep({ stdout: 'x s3cret-value', n: 1, a: ['s3cret-value'] }, s)).toEqual({ stdout: 'x [kilo/demo]', n: 1, a: ['[kilo/demo]'] })
    expect(maskDeep({ stdout: 'clean' }, s)).toBe(undefined)
  })

  test('commands that print keychain values are caught', async () => {
    for (const c of [
      'security find-generic-password -s kilo/x -w',
      'TOKEN=$(security find-generic-password -s kilo/x -w) curl -H "a: $TOKEN" x',
      'cd /tmp && /usr/bin/security find-internet-password -gs host',
      'security dump-keychain -d login.keychain',
      'echo "find-generic-password -s kilo/x -w" | security -i',
      'security export -k login.keychain',
      '/usr/bin/"security" find-generic-password -s kilo/x -w',
      "security find-generic-password -s kilo/x '-w'",
      'bash -c "security find-generic-password -s kilo/x -w"',
      'security -v -i',
      'X="$(security find-generic-password -s kilo/x -w)"; echo $X',
      'sudo security find-generic-password -s kilo/x -gw',
      'env -i /usr/bin/security find-generic-password -s x -w',
      "$'security' find-generic-password -s x -w",
      'S=security; $S find-generic-password -s x -w',
      'sudo -u me security find-generic-password -s x -w',
      'eval "security find-generic-password -s x -w"',
    ]) expect(readsKeychain(c)).toBe(true)
    for (const c of [
      'security find-generic-password -s kilo/x',
      'security dump-keychain | grep svce',
      'security add-generic-password -U -s kilo/x -a me -w',
      'git log --grep security',
      'git commit -m "Fix security export bug"',
      'gh pr edit 3 --body "agents ran security find-generic-password -w in Bash"',
      'security find-generic-password -s kilo/export-key',
      'git commit -F- <<EOF\nmention find-generic-password and -w in a message\nEOF',
    ]) expect(readsKeychain(c)).toBe(false)
  })
})
