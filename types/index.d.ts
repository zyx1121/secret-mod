export type SecretRequest = {
  id: string
  name: string
  purpose: string
  account: boolean
  fields: string[]
  exists: boolean
}

export type SecretMeta = {
  account: string
  fields: string[]
  purpose: string
  updatedAt: string
}

declare module 'claude-code' {
  interface PluginState {
    'secret-mod': { pending: SecretRequest[] }
  }
}
