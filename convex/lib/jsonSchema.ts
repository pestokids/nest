// PST-274: one Convex validator is both the JSON schema Claude is asked to follow
// (written into the prompt) and the check its answer has to pass.
import type { GenericValidator, Infer } from 'convex/values'

type Node = { kind: string; isOptional: string; fields?: Record<string, Node>; members?: Node[]; element?: Node; value?: unknown }

/** A strict JSON Schema for a validator: objects list every required key and allow nothing else. */
export function toJsonSchema(validator: GenericValidator): unknown {
  const n = validator as unknown as Node
  switch (n.kind) {
    case 'object': {
      const entries = Object.entries(n.fields ?? {})
      return {
        type: 'object',
        properties: Object.fromEntries(entries.map(([k, f]) => [k, toJsonSchema(f as unknown as GenericValidator)])),
        required: entries.filter(([, f]) => f.isOptional !== 'optional').map(([k]) => k),
        additionalProperties: false,
      }
    }
    case 'array':
      return { type: 'array', items: toJsonSchema(n.element as unknown as GenericValidator) }
    case 'union': {
      const ms = n.members ?? []
      if (ms.every((m) => m.kind === 'literal')) return { enum: ms.map((m) => m.value) }
      return { anyOf: ms.map((m) => toJsonSchema(m as unknown as GenericValidator)) }
    }
    case 'literal':
      return { const: n.value }
    case 'string':
      return { type: 'string' }
    case 'float64':
    case 'int64':
      return { type: 'number' }
    case 'boolean':
      return { type: 'boolean' }
    case 'null':
      return { type: 'null' }
    default:
      return {}
  }
}

export class SchemaError extends Error {
  constructor(public path: string, what: string) {
    super('Answer doesn’t match the schema at ' + (path || 'the top') + ': ' + what)
  }
}

/**
 * Check a parsed answer against a validator and return it with unknown keys
 * dropped. Throws SchemaError naming the first place it doesn't fit.
 */
export const conform = <V extends GenericValidator>(validator: V, value: unknown): Infer<V> => check(validator, value, '') as Infer<V>

function check(validator: GenericValidator, value: unknown, path: string): unknown {
  const n = validator as unknown as Node
  const fail = (what: string): never => {
    throw new SchemaError(path, what)
  }
  switch (n.kind) {
    case 'object': {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('expected an object')
      const out: Record<string, unknown> = {}
      for (const [k, f] of Object.entries(n.fields ?? {})) {
        const x = (value as Record<string, unknown>)[k]
        if (x === undefined) {
          if (f.isOptional !== 'optional') fail('missing ' + k)
          continue
        }
        out[k] = check(f as unknown as GenericValidator, x, path ? path + '.' + k : k)
      }
      return out
    }
    case 'array':
      if (!Array.isArray(value)) return fail('expected a list')
      return value.map((x, i) => check(n.element as unknown as GenericValidator, x, path + '[' + i + ']'))
    case 'union':
      for (const m of n.members ?? []) {
        try {
          return check(m as unknown as GenericValidator, value, path)
        } catch (e) {
          if (!(e instanceof SchemaError)) throw e
        }
      }
      return fail('no option fits')
    case 'literal':
      return value === n.value ? value : fail('expected ' + JSON.stringify(n.value))
    case 'string':
      return typeof value === 'string' ? value : fail('expected text')
    case 'float64':
    case 'int64':
      return typeof value === 'number' && Number.isFinite(value) ? value : fail('expected a number')
    case 'boolean':
      return typeof value === 'boolean' ? value : fail('expected true or false')
    case 'null':
      return value === null ? null : fail('expected null')
    default:
      return value
  }
}
