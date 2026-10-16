import type { ScopeView } from '../scope/view'
import { event } from './token'

export const scopeStatus = event<(scope: ScopeView) => void>('drydock.status')

export const scopeError = event<(scope: ScopeView, error: unknown) => void>('drydock.error')
