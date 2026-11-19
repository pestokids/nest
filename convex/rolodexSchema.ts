// Rolodex: everyone from the fundraising research (BITS alumni who are or were
// founders, execs or investors), the investor firms they work at, the companies our
// founders started and the investors (funds and angels) who backed them. Read-only in
// the app; written only by the `rolodex:import*` mutations from internal/rolodex.json
// (scripts/rolodex-import.mjs). Spread into schema.ts in a marked block.
import { defineTable } from 'convex/server'
import { v } from 'convex/values'

export const vTiming = v.union(v.literal('current'), v.literal('past'))
export const vRolodexRole = v.union(v.literal('vc'), v.literal('angel'), v.literal('founder'), v.literal('exec'), v.literal('none'))
export const vCurrentRole = v.union(v.literal('vc'), v.literal('angel'), v.literal('founder'), v.literal('exec'), v.literal('employee'), v.literal('none'))
/** Why someone is on the shortlist or not (fundraising/data/company-funding-2026-11-17/README.md). */
export const vFundingCheck = v.union(v.literal('investor'), v.literal('funded_company'), v.literal('unfunded'), v.literal('unverifiable'), v.literal('not_qualified'))

/** One person, as the import writes them. */
export const rolodexPersonFields = {
  /** Crustdata's person ID: the upsert key. */
  crustdataId: v.number(),
  name: v.string(),
  linkedinUrl: v.optional(v.string()),
  headline: v.optional(v.string()),
  university: v.string(),
  /** Main qualifying role (current beats past; then vc, angel, founder, exec). */
  role: vRolodexRole,
  roleStatus: v.optional(vTiming),
  /** What they do today ("employee": a current job that isn't one of the roles). */
  currentRole: vCurrentRole,
  vc: v.optional(vTiming),
  angel: v.optional(vTiming),
  founder: v.optional(vTiming),
  exec: v.optional(vTiming),
  countryCode: v.optional(v.string()),
  country: v.optional(v.string()),
  city: v.optional(v.string()),
  continent: v.optional(v.string()),
  location: v.optional(v.string()),
  gradYear: v.optional(v.number()),
  campus: v.optional(v.string()),
  degree: v.optional(v.string()),
  currentTitle: v.optional(v.string()),
  currentCompany: v.optional(v.string()),
  currentIndustries: v.optional(v.string()),
  /** Every current title @ company, "|"-separated. */
  currentRoles: v.optional(v.string()),
  founderCompanies: v.optional(v.string()),
  shortlist: v.boolean(),
  fundingCheck: vFundingCheck,
  /** "Name (funded); Name (acquired)…" */
  fundedCompanies: v.optional(v.string()),
  unfundedCompanies: v.optional(v.string()),
  unverifiableCompanies: v.optional(v.string()),
  /** "Accel [VC fund · Tier 1 · US firm, India office]; …" */
  investorFirms: v.optional(v.string()),
  /** The firm keys behind investorFirms (rolodexFirms.key). */
  firmKeys: v.optional(v.array(v.string())),
  /** Investors in the companies they founded (rolodexInvestors.key): the Investor filter. */
  investorKeys: v.optional(v.array(v.string())),
  /** The companies they founded that were researched (rolodexCompanies.key). */
  companyKeys: v.optional(v.array(v.string())),
  bestFirmTier: v.optional(v.string()),
  whyIncluded: v.optional(v.string()),
  otherSchools: v.optional(v.string()),
  hasBusinessEmail: v.optional(v.boolean()),
  twitter: v.optional(v.string()),
  githubUrl: v.optional(v.string()),
}

/** One investor organisation. */
export const rolodexFirmFields = {
  /** companies.csv company_key ("id:123" or "name:foo"): the upsert key. */
  key: v.string(),
  crustdataId: v.optional(v.number()),
  name: v.string(),
  /** "VC fund", "Micro VC", … "Operating company (not an investor)", "Unknown". */
  type: v.string(),
  tier: v.optional(v.string()),
  confidence: v.optional(v.string()),
  note: v.optional(v.string()),
  /** "India", "US", "US firm, India office", "<Country>", "Unknown". */
  geo: v.string(),
  hq: v.optional(v.string()),
  hqCountryCode: v.optional(v.string()),
  officeCountries: v.optional(v.array(v.string())),
  indiaPresence: v.union(v.literal('yes'), v.literal('no'), v.literal('unknown')),
  geoSource: v.optional(v.string()),
  people: v.number(),
  vcPeople: v.number(),
  angelPeople: v.number(),
  peopleThereNow: v.number(),
  headcount: v.optional(v.number()),
  linkedinUrl: v.optional(v.string()),
  website: v.optional(v.string()),
  /** Crustdata person IDs of the people from the list there. */
  personIds: v.array(v.number()),
}

/** What kind of investor (from the research agents; "unknown" for names only Crustdata listed). */
export const vInvestorKind = v.union(
  v.literal('vc'), v.literal('micro_vc'), v.literal('angel_network'), v.literal('angel'), v.literal('accelerator'), v.literal('corporate'),
  v.literal('pe_growth'), v.literal('family_office'), v.literal('government'), v.literal('debt'), v.literal('other'), v.literal('unknown'),
)
/** Where the link between an investor and a company comes from: checked on the web, or only Crustdata's list. */
export const vBackingSource = v.union(v.literal('web'), v.literal('crustdata'))
/** When the investor came in, against our founder's years at the company. */
export const vBackingTiming = v.union(v.literal('during'), v.literal('after'), v.literal('before'), v.literal('unknown'))

/** One investor (a fund, a network, an angel…) and the companies of ours they backed. */
export const rolodexInvestorFields = {
  /** Normalised name ("accel", "kunal shah"): the upsert key. */
  key: v.string(),
  name: v.string(),
  kind: vInvestorKind,
  /** Other spellings merged into this one. */
  aliases: v.optional(v.array(v.string())),
  /** Tier 1–3: by hand for firms our people work at, from a knowledge pass for the rest (angels only when well known). */
  tier: v.optional(v.string()),
  /** high, med or low. */
  tierConfidence: v.optional(v.string()),
  firmType: v.optional(v.string()),
  /** "India", "US", "US firm, India office", "<Country> firm, India office", "<Country>", "Unknown". */
  geo: v.optional(v.string()),
  /** HQ, or where an angel is based. */
  hqCountryCode: v.optional(v.string()),
  indiaPresence: v.optional(v.union(v.literal('yes'), v.literal('no'))),
  website: v.optional(v.string()),
  companyCount: v.number(),
  founderCount: v.number(),
  /** Companies where the link was checked on the web. */
  webCount: v.number(),
  companies: v.array(
    v.object({
      key: v.string(),
      name: v.string(),
      /** funded, acquired, public, not_funded, unknown, no_crustdata_id */
      status: v.string(),
      rounds: v.optional(v.array(v.string())),
      firstYear: v.optional(v.number()),
      lead: v.optional(v.boolean()),
      source: vBackingSource,
      founders: v.array(v.object({ personId: v.number(), name: v.string(), timing: vBackingTiming })),
    }),
  ),
}

/** One company a founder from the list started, and who invested in it. */
export const rolodexCompanyFields = {
  /** companies.csv company_key: the upsert key. */
  key: v.string(),
  name: v.string(),
  status: v.string(),
  website: v.optional(v.string()),
  linkedinUrl: v.optional(v.string()),
  /** web: researched on the web; crustdata: Crustdata's list only; none: no investors found. */
  research: v.union(v.literal('web'), v.literal('crustdata'), v.literal('none')),
  funded: v.optional(v.string()),
  totalRaised: v.optional(v.string()),
  confidence: v.optional(v.string()),
  notes: v.optional(v.string()),
  sources: v.optional(v.array(v.string())),
  founders: v.array(v.object({ personId: v.number(), name: v.string(), title: v.optional(v.string()), from: v.optional(v.string()), to: v.optional(v.string()) })),
  investors: v.array(
    v.object({
      key: v.string(),
      name: v.string(),
      kind: vInvestorKind,
      rounds: v.optional(v.array(v.string())),
      firstYear: v.optional(v.number()),
      lead: v.optional(v.boolean()),
      source: vBackingSource,
    }),
  ),
}

export const rolodexTables = {
  rolodexPeople: defineTable({ ...rolodexPersonFields, importedAt: v.number() })
    .index('by_crustdataId', ['crustdataId'])
    .index('by_shortlist', ['shortlist'])
    .index('by_importedAt', ['importedAt']),
  rolodexFirms: defineTable({ ...rolodexFirmFields, importedAt: v.number() }).index('by_key', ['key']).index('by_importedAt', ['importedAt']),
  rolodexInvestors: defineTable({ ...rolodexInvestorFields, importedAt: v.number() })
    .index('by_key', ['key'])
    .index('by_founderCount', ['founderCount'])
    .index('by_importedAt', ['importedAt']),
  rolodexCompanies: defineTable({ ...rolodexCompanyFields, importedAt: v.number() }).index('by_key', ['key']).index('by_importedAt', ['importedAt']),
  /** One row per import (key "import"): totals for the header, and when and where from. */
  rolodexMeta: defineTable({
    key: v.string(),
    people: v.number(),
    shortlist: v.number(),
    firms: v.number(),
    investors: v.optional(v.number()),
    companies: v.optional(v.number()),
    importedAt: v.number(),
    source: v.string(),
  }).index('by_key', ['key']),
}
