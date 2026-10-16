import type { TraceRecord } from '../events/bus'
import type { Kind, Status } from '../scope/view'
import { service } from '../services/token'

export interface ScopeNode {
  id: number
  name: string
  kind: Kind
  status: Status
  error?: string
  description?: string
  provided: string[]
  injected: string[]
  watched: string[]
  handled: string[]
  emitted: string[]
  missing: string[]
  children: ScopeNode[]
}

export interface ServiceInfo {
  layer: number
  id: string
  provider: string
  active: boolean
}

export interface HookInfo {
  id: string
  handlers: { plugin: string; priority: number }[]
}

export interface Inspector {
  tree(): ScopeNode
  services(): ServiceInfo[]
  hooks(): HookInfo[]
  trace(): TraceRecord[]
}

export const inspector = service<Inspector>('drydock.inspector')
