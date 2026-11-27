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
  const out = new Set([v, encodeURIComponent(v), toHex(v), toHex(v).toUpperCase(), JSON.stringify(v).slice(1, -1)])
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

// Field names that hold no secret (a host, a region). `url` and `endpoint` are
// left out on purpose: a DSN, webhook or presigned link carries a credential.
// These fields are masked inside `run` output but kept out of the global set
// that covers other tools.
export const NON_SECRET_FIELDS = ['host', 'hostname', 'domain', 'port', 'region', 'user', 'username', 'email', 'account']

export const isNonSecretField = (field: string) => NON_SECRET_FIELDS.includes(field.toLowerCase())

// Values of one item that are masked in every tool result.
export function globalValues(name: string, value: string): string[] {
  const p = envPrefix(name)
  return Object.entries(envFor(name, value, ''))
    .filter(([k, v]) => v.length >= MIN_GLOBAL && !(k.startsWith(`${p}_`) && isNonSecretField(k.slice(p.length + 1))))
    .map(([, v]) => v)
}

// HTTP Basic style pairs `<account>:<secret>` and `<fieldA>:<fieldB>` (ordered,
// secret fields only) whose encodings a command may print. Only secrets of at
// least `minLen` chars take part. Hashes and lengths are not covered.
export function pairValues(name: string, value: string, account: string, minLen = 0): string[] {
  const p = envPrefix(name)
  const env = envFor(name, value, '')
  const secret = Object.entries(env).filter(([k, v]) => v.length >= minLen && !(k.startsWith(`${p}_`) && isNonSecretField(k.slice(p.length + 1))))
  const out = new Set<string>()
  if (account) for (const [, v] of secret) out.add(`${account}:${v}`)
  const fields = secret.filter(([k]) => k !== p)
  for (const [a, x] of fields) for (const [b, y] of fields) if (a !== b) out.add(`${x}:${y}`)
  return [...out]
}

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
// The command is split into words with shell quoting, so quoted text such as a
// commit message is one word and never a command.
type Cmd = string[]

function parse(src: string): { cmds: Cmd[]; subs: string[]; bodies: { cmd: Cmd; body: string }[] } {
  const cmds: Cmd[] = []
  const subs: string[] = []
  const bodies: { cmd: Cmd; body: string }[] = []
  let cmd: Cmd = []
  let word = ''
  let inWord = false
  const endWord = () => {
    if (inWord) cmd.push(word)
    word = ''
    inWord = false
  }
  const endCmd = () => {
    endWord()
    if (cmd.length) cmds.push(cmd)
    cmd = []
  }
  const heredocs: { tag: string; cmd: Cmd }[] = []
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!
    // A heredoc body is data, not commands: skip it up to its delimiter line.
    if (c === '<' && src[i + 1] === '<' && src[i + 2] !== '<') {
      const m = src.slice(i + 2).match(/^-?\s*(['"]?)([A-Za-z0-9_]+)\1/)
      if (m) {
        heredocs.push({ tag: m[2]!, cmd })
        i += 1 + m[0].length
        continue
      }
    }
    if (c === '\n' && heredocs.length) {
      endCmd()
      let at = i + 1
      for (const { tag, cmd: owner } of heredocs.splice(0)) {
        const lines = src.slice(at).split('\n')
        const k = lines.findIndex(l => l.trim() === tag)
        bodies.push({ cmd: owner, body: (k < 0 ? lines : lines.slice(0, k)).join('\n') })
        at += k < 0 ? src.length : lines.slice(0, k + 1).join('\n').length + 1
      }
      i = Math.min(at, src.length) - 1
      continue
    }
    if (c === '$' && src[i + 1] === "'") continue
    if (c === '\\') {
      word += src[i + 1] ?? ''
      inWord = true
      i++
    } else if (c === "'") {
      const j = src.indexOf("'", i + 1)
      const end = j < 0 ? src.length : j
      word += src.slice(i + 1, end)
      inWord = true
      i = end
    } else if (c === '"') {
      let j = i + 1
      let raw = ''
      while (j < src.length && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < src.length) {
          raw += src[j + 1]
          j += 2
        } else raw += src[j++]
      }
      // Command substitutions run even inside double quotes.
      for (const m of raw.matchAll(/\$\(([^]*?)\)|`([^`]*)`/g)) subs.push(m[1] ?? m[2] ?? '')
      word += raw
      inWord = true
      i = j
    } else if (c === '$' && src[i + 1] === '(') {
      endCmd()
      i++
    } else if (';&|\n()`'.includes(c)) {
      endCmd()
    } else if (c === ' ' || c === '\t') {
      endWord()
    } else {
      word += c
      inWord = true
    }
  }
  endCmd()
  return { cmds, subs, bodies }
}

const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish'])
const base = (w: string) => w.slice(w.lastIndexOf('/') + 1)

// Judged by the words, not by the program name, so a wrapper with options
// (`env -i`, `sudo -u x`) or a program held in a variable is still caught.
function cmdReads(words: Cmd, depth: number): boolean {
  const flags = words.filter(a => /^-[a-zA-Z]+$/.test(a))
  if (words.some(w => /^find-(generic|internet)-password$/.test(w)) && flags.some(f => /[wg]/.test(f))) return true
  if (words.includes('dump-keychain') && flags.some(f => f.includes('d'))) return true
  const at = words.findIndex(w => base(w) === 'security')
  if (at >= 0) {
    const args = words.slice(at + 1)
    const sub = args.findIndex(a => !a.startsWith('-'))
    const pre = sub < 0 ? args : args.slice(0, sub)
    if (pre.some(a => /^-[a-z]*i/.test(a))) return true
    if (sub >= 0 && ['export', 'interactive'].includes(args[sub]!)) return true
  }
  for (let i = 0; i < words.length; i++) {
    if (SHELLS.has(base(words[i]!)) || base(words[i]!) === 'eval') {
      const rest = words.slice(i + 1)
      const c = rest.findIndex(a => /^-[a-z]*c[a-z]*$/.test(a))
      const script = base(words[i]!) === 'eval' ? rest.join(' ') : c >= 0 ? rest[c + 1] : undefined
      if (script !== undefined && readsKeychain(script, depth + 1)) return true
    }
  }
  return false
}

export function readsKeychain(command: string, depth = 0): boolean {
  if (depth > 4) return true
  const { cmds, subs, bodies } = parse(command)
  return (
    cmds.some(c => cmdReads(c, depth)) ||
    subs.some(s => readsKeychain(s, depth + 1)) ||
    // A heredoc is data unless its consumer is a shell, which runs it.
    bodies.some(b => b.cmd.some(w => SHELLS.has(base(w))) && readsKeychain(b.body, depth + 1))
  )
}
