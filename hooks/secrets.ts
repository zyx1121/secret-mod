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

// Encodings a command can print a value in: raw, base64 (with and without the
// newline `echo` adds), URL encoding and hex.
export function variants(v: string): string[] {
  const b64 = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/=+$/, '')
  const out = new Set([v, encodeURIComponent(v), toHex(v), toHex(v).toUpperCase()])
  for (const s of [v, v + '\n']) {
    const b = b64(s)
    out.add(b)
    out.add(b.replace(/\+/g, '-').replace(/\//g, '_'))
  }
  out.delete('')
  return [...out]
}

// Values shorter than this are left alone outside `run`: masking `admin` in
// every tool result would wreck ordinary output.
export const MIN_GLOBAL = 8

// Masks every string inside a tool result; returns undefined when nothing matched.
export function maskDeep(value: unknown, secrets: { name: string; values: string[] }[]): unknown {
  let hit = false
  const walk = (x: unknown): unknown => {
    if (typeof x === 'string') {
      const m = mask(x, secrets)
      if (m !== x) hit = true
      return m
    }
    if (Array.isArray(x)) return x.map(walk)
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, walk(v)]))
    return x
  }
  const out = walk(value)
  return hit ? out : undefined
}

// A shell command that prints a keychain value: `security find-*-password` with
// -w or -g, `dump-keychain -d`, `export`, or the interactive `security -i`.
const READ_FLAG = /(^|\s)-[a-zA-Z]*[wg][a-zA-Z]*(\s|$)/
export function readsKeychain(command: string): boolean {
  for (const part of command.split(/[;&|\n()`]+|\$\(/)) {
    const m = part.match(/(?:^|[\s/"'])security\s+(.*)$/)
    if (!m) continue
    const args = m[1] ?? ''
    if (/^\s*-i\b/.test(args) || /\bexport\b/.test(args)) return true
    if (/\bfind-(generic|internet)-password\b/.test(args) && READ_FLAG.test(args)) return true
    if (/\bdump-keychain\b/.test(args) && /(^|\s)-[a-zA-Z]*d/.test(args)) return true
  }
  return false
}
