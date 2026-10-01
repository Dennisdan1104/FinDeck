/**
 * Catalog vocabulary for the asset hub: the manifest's `kind` and `origin`
 * values mapped onto dictionary keys. Both value sets are open strings on the
 * wire, so an unknown value falls back to the raw token rather than a label.
 */

import type { AssetsLocaleKey } from '../locales.ts'

/** The dictionary key naming one manifest kind, or null for an unknown kind. */
export function kindLocaleKey(kind: string): AssetsLocaleKey | null {
  switch (kind) {
    case 'model': return 'kindModel'
    case 'code': return 'kindCode'
    case 'weights': return 'kindWeights'
    case 'dataset': return 'kindDataset'
    case 'chart': return 'kindChart'
    case 'report': return 'kindReport'
    default: return null
  }
}

/** The dictionary key naming one manifest origin, or null for an unknown origin. */
export function originLocaleKey(origin: string): AssetsLocaleKey | null {
  switch (origin) {
    case 'agent': return 'originAgent'
    case 'user': return 'originUser'
    case 'imported': return 'originImported'
    default: return null
  }
}

/** The dictionary key naming one declared verb, or null for an unknown verb. */
export function verbLocaleKey(verb: string): AssetsLocaleKey | null {
  switch (verb) {
    case 'preview': return 'verbPreview'
    case 'update': return 'verbUpdate'
    case 'predict': return 'verbPredict'
    case 'retrain': return 'verbRetrain'
    case 'run': return 'verbRun'
    case 'summary': return 'verbSummary'
    default: return null
  }
}
