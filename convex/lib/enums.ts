// Re-export the shared enums as plain arrays for validators.
import { METRICS } from '../../src/lib/round'
import { GEOS as G, PIPELINE_KEYS, STAGE_KEYS, TIERS as TI, TYPES as TY, WARMTHS as W } from '../../src/lib/stages'

export const ALL = STAGE_KEYS
export const PIPELINE_LIST = PIPELINE_KEYS
export const TYPES = TY
export const GEOS = G
export const WARMTHS = W
export const TIERS = TI
export const METRICS_LIST = METRICS
