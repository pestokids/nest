// PST-302: applications as their own status on an investor, and who made each
// stage move. Optional and additive: existing rows stay valid, nothing rewrites them.
import { v } from 'convex/values'
import { vApplication, vPipelineStage, vStage } from './validators'

/** Absent: not applied. Never moves the stage. */
export const investorApplicationField = { application: v.optional(vApplication) }

export const vStageVia = v.union(v.literal('agent'), v.literal('signal'))
/** On a stage activity: the stage before, who made it (absent: a person), and whether Dev marked it a correction (with maxStage before it). */
export const stageActivityFields = {
  fromStage: v.optional(vStage),
  via: v.optional(vStageVia),
  correction: v.optional(v.object({ maxBefore: vPipelineStage })),
}
