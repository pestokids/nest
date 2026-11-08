// PST-303: what Name, Firm and Email mean for each investor type (the drawer's edit form and
// Add investor), and the rule that Save only writes the fields Dev changed.
import type { InvestorFields } from './pipeline'
import type { InvestorType } from './stages'

type Copy = { label: string; help?: string; placeholder?: string }
export type FieldCopy = Record<'name' | 'firm' | 'email' | 'path' | 'emails' | 'domains', Copy>

/** Angels and large angels are people; accelerators run programmes; every other type is a fund. */
export const fieldKind = (type: InvestorType): 'vc' | 'accelerator' | 'angel' =>
  type === 'Angel' || type === 'Large angel' ? 'angel' : type === 'Accelerator' ? 'accelerator' : 'vc'

const PATH: Copy = { label: 'Warm path', help: 'Who can introduce you, and how you know them. Leave it empty if it’s cold.', placeholder: 'Who can introduce you?' }
const EMAILS_HELP = 'One per line. They match Gmail and Calendar too.'
const DOMAINS_HELP = 'One per line. Anyone at these domains counts. Personal mail never does.'

const COPY: Record<ReturnType<typeof fieldKind>, FieldCopy> = {
  vc: {
    name: { label: 'Partner', help: 'The partner you’re talking to. One card per fund.', placeholder: 'e.g. Asha Linden' },
    firm: { label: 'Fund', placeholder: 'e.g. Northstar Ventures' },
    email: { label: 'Partner’s email', help: 'Matches their Gmail and Calendar. Add other partners’ emails or the fund’s domain under More details.', placeholder: 'e.g. asha@northstar.vc' },
    path: PATH,
    emails: { label: 'Other emails', help: EMAILS_HELP, placeholder: 'leo@northstar.vc\nmaya@northstar.vc' },
    domains: { label: 'Fund domains', help: DOMAINS_HELP, placeholder: 'northstar.vc' },
  },
  accelerator: {
    name: { label: 'Programme', help: 'The programme and batch, e.g. Northwind S27.', placeholder: 'e.g. Northwind S27' },
    firm: { label: 'Accelerator', placeholder: 'e.g. Northwind' },
    email: { label: 'Contact email (optional)', help: 'The partner or programme address you write to. The accelerator’s domain matches the rest.', placeholder: 'e.g. team@northwind.vc' },
    path: PATH,
    emails: { label: 'Other emails', help: EMAILS_HELP, placeholder: 'partners@northwind.vc' },
    domains: { label: 'Accelerator domains', help: DOMAINS_HELP, placeholder: 'northwind.vc' },
  },
  angel: {
    name: { label: 'Name', help: 'The person.', placeholder: 'e.g. Asha Linden' },
    firm: { label: 'Title or company', placeholder: 'e.g. ex-founder, angel' },
    email: { label: 'Their email', placeholder: 'e.g. asha@linden.co' },
    path: PATH,
    emails: { label: 'Other emails', help: EMAILS_HELP, placeholder: 'asha.l@linden.co' },
    domains: { label: 'Company domains', help: DOMAINS_HELP, placeholder: 'linden.co' },
  },
}

/** Labels, help and placeholders for the form's fields, for this type. */
export const fieldCopy = (type: InvestorType): FieldCopy => COPY[fieldKind(type)]

/**
 * What Save writes: the investor as it is now, with only the fields Dev touched taken from the
 * form. A field Dev didn't touch keeps its stored value, even if it changed elsewhere (enrichment,
 * a suggestion, Jev) while the form was open. Park until follows the stage.
 */
export function keepUntouched(now: InvestorFields, form: InvestorFields, touched: Iterable<string>): InvestorFields {
  const keys = new Set(touched)
  if (keys.has('stage')) keys.add('parkedUntil')
  const out: Record<string, unknown> = { ...now }
  for (const k of keys) if (k in form) out[k] = form[k as keyof InvestorFields]
  return out as InvestorFields
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

/** The fields that differ between two versions of an investor. */
export const changedFields = (a: InvestorFields, b: InvestorFields) =>
  (Object.keys({ ...a, ...b }) as (keyof InvestorFields)[]).filter((k) => !same(a[k], b[k]))
