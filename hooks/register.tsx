import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { SecretMeta, SecretRequest } from '../types'
import { envFor, envPrefix, FIELD, keychainAttr, mask, metaKey, PREFIX, toHex } from './secrets'

// Values never leave this module: the model gets names, env var names and
// masked output only.

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/
const MAX_OUTPUT = 30_000

const pending = atom({ plugin: 'secret-mod', key: 'pending' } as const, [] as SecretRequest[])

// Typed values of the open form, keyed by request id then field.
const drafts: Record<string, Record<string, string>> = {}

const text = (s: string) => ({ result: s })
const fail = (s: string) => ({ result: s, isError: true as const })
const quote = (s: string) => `"${s.replace(/["\\\n]/g, ' ')}"`

type Item = { name: string; account: string; comment: string }

// `security dump-keychain` without -d prints attributes only, never values.
async function listItems($: any): Promise<Item[]> {
  const { stdout } = await $.process.run(['security', 'dump-keychain'], { timeoutMs: 20_000 })
  const items: Item[] = []
  for (const block of stdout.split(/^keychain: /m)) {
    if (!/^class: "genp"/m.test(block)) continue
    const attr = (k: string) => keychainAttr(block, k)
    const service = attr('svce')
    if (!service.startsWith(PREFIX)) continue
    items.push({ name: service.slice(PREFIX.length), account: attr('acct'), comment: attr('icmt') })
  }
  return items.sort((a, b) => a.name.localeCompare(b.name))
}

async function readValue($: any, name: string): Promise<string | undefined> {
  const r = await $.process.run(['security', 'find-generic-password', '-s', PREFIX + name, '-w'])
  return r.exitCode === 0 ? r.stdout.replace(/\n$/, '') : undefined
}

async function readAccount($: any, name: string): Promise<string> {
  const r = await $.process.run(['security', 'find-generic-password', '-s', PREFIX + name])
  return keychainAttr(r.stdout, 'acct')
}

async function save($: any, req: SecretRequest): Promise<string | undefined> {
  const draft = drafts[req.id] ?? {}
  const account = req.account ? (draft.account ?? '').trim() : 'token'
  if (req.account && !account) return 'Fill in the account.'
  const missing = req.fields.filter(f => !draft[f])
  if (missing.length) return `Fill in ${missing.join(', ')}.`

  const [only] = req.fields
  const value =
    req.fields.length === 1 && only
      ? draft[only] ?? ''
      : JSON.stringify(Object.fromEntries(req.fields.map(f => [f, draft[f]])))
  // The value goes through stdin as hex, never through argv.
  const line = [
    'add-generic-password -U',
    `-s ${quote(PREFIX + req.name)}`,
    `-a ${quote(account)}`,
    `-l ${quote(`${PREFIX}${req.name}`)}`,
    `-j ${quote(req.purpose)}`,
    `-X ${toHex(value)}`,
  ].join(' ')
  const r = await $.process.run(['security', '-i'], { stdin: line + '\n' })
  if (r.exitCode !== 0 || /error/i.test(r.stdout + r.stderr)) return 'The keychain refused the item.'

  const meta: SecretMeta = {
    account,
    fields: req.fields,
    purpose: req.purpose,
    updatedAt: new Date().toISOString(),
  }
  await $.store.set(metaKey(req.name), meta)
  return undefined
}

async function finish($: any, req: SecretRequest, message: string) {
  delete drafts[req.id]
  await update($, pending, list => list.filter(r => r.id !== req.id))
  await $.prompt.submit({ text: message })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.tool.register({
      name: 'ask',
      description:
        'Ask Loki to type a credential into a form. The value is saved to the macOS login keychain as kilo/<name>; you never see it. Returns at once: a message arrives when Loki saves or cancels, so end your turn after calling. Then use the run tool with the name.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'System name, lowercase with hyphens, e.g. "gitlab-winfra"' },
          purpose: { type: 'string', description: 'What it is for, how to reissue it, when it expires' },
          account: { type: 'boolean', description: 'Also ask for the login identity (email, username). Default true' },
          fields: {
            type: 'array',
            items: { type: 'string' },
            description: 'Secret field names, lowercase, e.g. ["password"] or ["token"]. Default ["password"]',
          },
        },
        required: ['name', 'purpose'],
      },
    })
    await $.tool.register({
      name: 'run',
      description:
        'Run a shell command (zsh -c) with keychain secrets as env vars. For secret "nycu-portal": NYCU_PORTAL is the stored value, NYCU_PORTAL_ACCOUNT the account, and NYCU_PORTAL_<FIELD> each field of a multi-field secret. Secret values in the output are replaced by [kilo/<name>]. Never print a value on purpose.',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string' },
          secrets: { type: 'array', items: { type: 'string' }, description: 'Names without the kilo/ prefix' },
          cwd: { type: 'string' },
          timeout_ms: { type: 'number', description: 'Default 120000, at most 600000' },
        },
        required: ['command', 'secrets'],
      },
    })
    await $.tool.register({
      name: 'list',
      description: 'List the kilo/ secrets in the keychain: name, account, purpose, and the env var names run sets. Never values.',
      inputSchema: { type: 'object', properties: {} },
    })
    await $.tool.register({
      name: 'delete',
      description: 'Delete kilo/<name> from the keychain. Loki confirms in a dialog first. To change a value, call ask with the same name instead.',
      inputSchema: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Name without the kilo/ prefix' } },
        required: ['name'],
      },
    })
    return next(e)
  })

  on('tool.call', { tool: 'mcp__secret-mod__ask' }, async ($, e: any) => {
    const name = String(e.name ?? '').replace(/^kilo\//, '')
    if (!NAME.test(name)) return fail('name must be lowercase letters, digits and hyphens.')
    const fields: string[] = Array.isArray(e.fields) && e.fields.length ? e.fields.map(String) : ['password']
    if (!fields.every(f => FIELD.test(f)) || new Set(fields).size !== fields.length)
      return fail('fields must be unique lowercase names like "password" or "api_key".')
    const req: SecretRequest = {
      id: `${name}-${Date.now().toString(36)}`,
      name,
      purpose: String(e.purpose ?? ''),
      account: e.account !== false,
      fields,
      exists: (await readValue($, name)) !== undefined,
    }
    // An update keeps the stored account unless Loki edits it.
    drafts[req.id] = req.exists && req.account ? { account: await readAccount($, name) } : {}
    await update($, pending, list => [...list, req])
    $.ui.toast(`Secret form for ${PREFIX}${name} is above the prompt: click it or press ctrl+x tab.`)
    return text(
      `Form opened for ${PREFIX}${name}. End your turn now: a message arrives when Loki saves or cancels.`,
    )
  }).catch(() => fail('secret-mod: the form did not open.'))

  on('tool.call', { tool: 'mcp__secret-mod__delete' }, async ($: any, e: any) => {
    const name = String(e.name ?? '').replace(/^kilo\//, '')
    if (!NAME.test(name)) return fail('name must be lowercase letters, digits and hyphens.')
    if ((await readValue($, name)) === undefined) return fail(`No keychain item ${PREFIX}${name}.`)
    let answer = 'Keep'
    try {
      answer = await $.ui.ask(`Delete ${PREFIX}${name} from the keychain?`, { options: ['Keep', 'Delete'], header: 'Secret' })
    } catch {}
    if (answer !== 'Delete') return text(`Loki kept ${PREFIX}${name}.`)
    const r = await $.process.run(['security', 'delete-generic-password', '-s', PREFIX + name])
    if (r.exitCode !== 0) return fail(`The keychain refused to delete ${PREFIX}${name}.`)
    await $.store.delete(metaKey(name))
    return text(`Deleted ${PREFIX}${name}.`)
  }).catch(() => fail('secret-mod: the delete failed.'))

  on('tool.call', { tool: 'mcp__secret-mod__list' }, async ($: any) => {
    const items = await listItems($)
    if (items.length === 0) return text('No kilo/ secrets yet.')
    const lines: string[] = []
    for (const it of items) {
      const meta = (await $.store.get(metaKey(it.name))) as SecretMeta | undefined
      const p = envPrefix(it.name)
      const env = [p, ...(it.account ? [`${p}_ACCOUNT`] : [])]
      if (meta && meta.fields.length > 1) env.push(...meta.fields.map(f => `${p}_${f.toUpperCase()}`))
      lines.push(`- ${it.name} (account: ${it.account || '-'}) ${it.comment}\n  env: ${env.join(' ')}`)
    }
    return text(lines.join('\n'))
  }).catch(() => fail('secret-mod: listing the keychain failed.'))

  on('tool.call', { tool: 'mcp__secret-mod__run' }, async ($: any, e: any) => {
    const names: string[] = Array.isArray(e.secrets) ? e.secrets.map((s: unknown) => String(s).replace(/^kilo\//, '')) : []
    const env: Record<string, string> = {}
    const masks: { name: string; values: string[] }[] = []
    for (const name of names) {
      if (!NAME.test(name)) return fail(`Bad secret name: ${name}`)
      const value = await readValue($, name)
      if (value === undefined) return fail(`No keychain item ${PREFIX}${name}. Use the ask tool first.`)
      const vars = envFor(name, value, await readAccount($, name))
      Object.assign(env, vars)
      masks.push({ name, values: Object.entries(vars).filter(([k]) => !k.endsWith('_ACCOUNT')).map(([, v]) => v) })
    }
    const timeoutMs = Math.min(Math.max(Number(e.timeout_ms) || 120_000, 1_000), 600_000)
    let r
    try {
      r = await $.process.run(['/bin/zsh', '-c', String(e.command)], { env, cwd: e.cwd, timeoutMs })
    } catch (err) {
      return fail(mask(`The command did not finish: ${String(err)}`, masks))
    }
    const clip = (s: string) => (s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}\n[cut ${s.length - MAX_OUTPUT} chars]` : s)
    // Mask the streams alone, so a short value cannot eat the exit line.
    const stdout = mask(r.stdout, masks)
    const stderr = mask(r.stderr, masks)
    const out = [`exit ${r.exitCode}`, stdout && `stdout:\n${clip(stdout)}`, stderr && `stderr:\n${clip(stderr)}`]
      .filter(Boolean)
      .join('\n')
    return r.exitCode === 0 ? text(out) : fail(out)
  }).catch(() => fail('secret-mod: the run failed before the command started.'))

  // The form is drawn inline in the band above the prompt, over other mods' bands.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const list = await read($, pending)
    const req = list[0]
    if (!req) return next(e)
    const { Box, Text, Input, Button } = $.ui.resolve(e) as any
    const band = e.requestId
    const draft = (drafts[req.id] ??= {})
    const keys = [...(req.account ? ['account'] : []), ...req.fields]

    const submit = async () => {
      const problem = await save($, req)
      if (problem) return $.ui.toast(problem)
      const p = envPrefix(req.name)
      await finish(
        $,
        req,
        `secret-mod: Loki saved ${PREFIX}${req.name}. Use the run tool with secrets ["${req.name}"]; env ${p}${req.account ? `, ${p}_ACCOUNT` : ''}${req.fields.length > 1 ? ', ' + req.fields.map(f => `${p}_${f.toUpperCase()}`).join(', ') : ''}. Continue the task.`,
      )
    }
    const cancel = () => finish($, req, `secret-mod: Loki cancelled the form for ${PREFIX}${req.name}.`)
    const nextField = (k: string) => {
      const i = keys.indexOf(k)
      const after = keys[i + 1]
      if (after) void $.ui.focus({ requestId: band, key: after })
      else void submit()
    }

    return (
      <Box flexDirection="column">
        <Text bold>
          {PREFIX}
          {req.name}
          {req.exists ? '  (update)' : ''}
          {list.length > 1 ? `  (+${list.length - 1} waiting)` : ''}
        </Text>
        {req.purpose ? <Text dimColor>{req.purpose}</Text> : null}
        {keys.map((k, i) => (
          <Input
            key={k}
            label={`${k}: `}
            value={draft[k] ?? ''}
            autoFocus={i === 0 ? true : undefined}
            submitLabel={i < keys.length - 1 ? 'next' : 'save'}
            onInput={(v: string) => {
              draft[k] = v
            }}
            onSubmit={(v: string) => {
              draft[k] = v
              nextField(k)
            }}
          />
        ))}
        <Box flexDirection="row" gap={1}>
          <Button key="save" label="Save" variant="primary" onPress={() => void submit()} />
          <Button key="cancel" label="Cancel" onPress={() => void cancel()} />
        </Box>
        {await next(e)}
      </Box>
    )
  })
}
