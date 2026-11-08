// PST-295: the Pipeline views, Board, Race and Maybes (PST-293's ./Maybes.tsx),
// switched with V (KEYS.views in src/lib/shortcuts.ts).
export const PIPELINE_VIEWS = ['board', 'race', 'maybes'] as const
export type PipelineView = (typeof PIPELINE_VIEWS)[number]
export const VIEW_LABEL: Record<PipelineView, string> = { board: 'Board', race: 'Race', maybes: 'Maybes' }
export const isView = (v: unknown): v is PipelineView => (PIPELINE_VIEWS as readonly unknown[]).includes(v)

/** V: the next view, round to the first after the last. */
export const nextView = (v: PipelineView): PipelineView => PIPELINE_VIEWS[(PIPELINE_VIEWS.indexOf(v) + 1) % PIPELINE_VIEWS.length]
