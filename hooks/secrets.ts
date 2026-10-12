// Pure helpers: env var names, masking, keychain encoding.

export const PREFIX = 'kilo/'
export const FIELD = /^[a-z][a-z0-9_]{0,31}$/

export const envPrefix = (name: string) => name.toUpperCase().replace(/-/g, '_')
export const metaKey = (name: string) => `meta:${name}`
export const toHex = (s: string) =>
  Array.from(new TextEncoder().encode(s), b => b.toString(16).padStart(2, '0')).join('')

// Single-field items keep the raw value; multi-field items keep a JSON object.
export function envFor(name: string, value: string, account: string): Record<string, string> {
  const p = envPrefix(name)
  const env: Record<string, string> = { [p]: value }
  if (account) env[`${p}_ACCOUNT`] = account
  try {
    const parsed = JSON.parse(value)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && FIELD.test(k.toLowerCase())) env[`${p}_${k.toUpperCase()}`] = v
      }
    }
  } catch {}
  return env
}

export function mask(out: string, secrets: { name: string; values: string[] }[]): string {
  let masked = out
  for (const s of secrets) {
    for (const v of [...s.values].sort((a, b) => b.length - a.length)) {
      if (v.length > 0) masked = masked.split(v).join(`[${PREFIX}${s.name}]`)
    }
  }
  return masked
}


// `security` prints an attribute as "text", or as 0xHEX when it holds non-ASCII bytes.
export function keychainAttr(block: string, key: string): string {
  const m = block.match(new RegExp(`"${key}"<blob>=(?:0x([0-9A-Fa-f]+)|"([^"]*)")`))
  if (!m) return ''
  if (m[2] !== undefined) return m[2]
  const bytes = new Uint8Array((m[1] ?? '').match(/../g)!.map(h => parseInt(h, 16)))
  return new TextDecoder().decode(bytes)
}
