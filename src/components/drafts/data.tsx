// PST-278: what Drafts read and write. Anything can open the Draft dialog
// (Today's Gone quiet, the drawer, a prep brief, a meeting); DraftsProvider in
// the Raise layout shows it. Convex when signed in, an in-memory store over
// made-up text under ?preview (src/preview/draftsFixture.ts).
import { useAction, useMutation, useQuery } from 'convex/react'
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { BLANK, blanks, DATA_ROOM_LINK, DECK_LINK, isAiType, isEmail, LINK_SLOTS, mainContact, warmPathContact, type Draft, type DraftInput, type DraftType, type Forward, type Generated, type InvestorDrafts, type Known, type Tweak } from '../../lib/drafts'
import { SAFE_LINK } from '../../lib/closeKit'
import { previewConfirmSent } from '../close/CloseData'
import { NO_AI_KEY } from '../../lib/enrich'
import { todayIST } from '../../lib/dates'
import { normEmail } from '../../lib/google'
import { linkState, shareUrl, type MaterialKind } from '../../lib/materials'
import { PREVIEW_KNOWN, previewDraftText, previewHistory, previewOpen, type PreviewDrafts } from '../../preview/draftsFixture'
import { useRaise } from '../data'
import { useMaterials } from '../materials/data'
import { usePreviewState } from '../preview-state'
import { DraftDialog } from './DraftDialog'
import { ForwardableDialog } from './ForwardableDialog'
import { useIntroducers } from '../introducers/data'
import { PREVIEW_FORWARDABLE, previewForwardable } from '../../preview/introducersFixture'

/** Open the dialog on an investor: a type to start on (else the drawer's pick), or a saved draft to reopen. */
export type DraftOpen = { investorId: string; type?: DraftType; draftId?: string; /** PST-294: a forwardable intro's intro. */ introId?: string }

let request: DraftOpen | null = null
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
export function openDraft(o: DraftOpen | null) {
  request = o
  listeners.forEach((l) => l())
}
const useRequest = () => useSyncExternalStore(subscribe, () => request, () => null)

export type GenerateInput = { draftId?: string; investorId: string; type: DraftType; tweak?: Tweak; current?: { subject: string; body: string }; introId?: string }

export type DraftsValue = {
  /** One investor's contact, warm path, keys and recent drafts. A hook; undefined while loading, null if the investor is gone. */
  useInvestorDrafts: (investorId: string | null) => InvestorDrafts | null | undefined
  generate: (i: GenerateInput) => Promise<Generated>
  /** Keep what's in the fields (closing after an edit). */
  save: (d: DraftInput) => Promise<string>
  /** Copy or WhatsApp: the text with its links filled in (a forwardable intro's note too). Logs nothing. */
  copied: (d: DraftInput, via: 'copy' | 'whatsapp') => Promise<{ draftId: string; body: string; forward?: Forward }>
  /** "I sent it": the touch, once. */
  markSent: (draftId: string) => Promise<{ logged: boolean }>
  send: (d: DraftInput) => Promise<{ draftId: string; to: string }>
  /** PST-291: several drafts at once (allocation emails), each to the investor's main contact when `to` is empty. Nothing is sent. */
  saveMany: (ds: Omit<DraftInput, 'draftId'>[]) => Promise<string[]>
}

const DraftsContext = createContext<DraftsValue | null>(null)
export function useDrafts(): DraftsValue {
  const v = useContext(DraftsContext)
  if (!v) throw new Error('useDrafts outside DraftsProvider')
  return v
}

/** Wrap the app (inside Materials): Convex, or the preview store under ?preview. */
export function DraftsProvider({ children }: { children: ReactNode }) {
  const preview = usePreviewState()
  return preview ? <PreviewDrafts state={(preview.drafts as PreviewDrafts | null | undefined) ?? null}>{children}</PreviewDrafts> : <ConvexDrafts>{children}</ConvexDrafts>
}

/** The dialog, when something opened one. In the Raise layout, so it has the drawer's data and toasts. */
export function DraftHost() {
  const r = useRequest()
  const { investors } = useRaise()
  const inv = r ? investors.find((i) => i._id === r.investorId) : undefined
  if (!r || !inv) return null
  // PST-294: a forwardable intro has its own dialog (two emails, to the introducer).
  if (r.type === 'forwardable') return r.introId ? <ForwardableDialog key={r.introId + (r.draftId ?? '')} start={r} introId={r.introId} investor={inv} onClose={() => openDraft(null)} /> : null
  return <DraftDialog key={r.investorId + (r.draftId ?? r.type ?? '')} start={r} investor={inv} onClose={() => openDraft(null)} />
}

const useInvestorDrafts = (investorId: string | null) => useQuery(api.drafts.forInvestor, investorId ? { investorId: investorId as Id<'investors'> } : 'skip')
const ids = (d: DraftInput) => ({ ...d, draftId: d.draftId as Id<'drafts'> | undefined, investorId: d.investorId as Id<'investors'>, introId: d.introId as Id<'intros'> | undefined })

function ConvexDrafts({ children }: { children: ReactNode }) {
  const generate = useAction(api.drafts.generate)
  const save = useMutation(api.drafts.save)
  const copied = useMutation(api.drafts.copied)
  const markSent = useMutation(api.drafts.markSent)
  const send = useAction(api.drafts.send)
  const saveMany = useMutation(api.drafts.saveMany)
  const value = useMemo<DraftsValue>(
    () => ({
      useInvestorDrafts,
      generate: (i) => generate({ ...i, draftId: i.draftId as Id<'drafts'> | undefined, investorId: i.investorId as Id<'investors'>, introId: i.introId as Id<'intros'> | undefined }),
      save: (d) => save(ids(d)),
      copied: (d, via) => copied({ ...ids(d), via }),
      markSent: (draftId) => markSent({ draftId: draftId as Id<'drafts'> }),
      send: (d) => send(ids(d)),
      saveMany: (ds) => saveMany({ drafts: ds.map((d) => ({ ...d, investorId: d.investorId as Id<'investors'> })) }),
    }),
    [generate, save, copied, markSent, send, saveMany],
  )
  return <DraftsContext.Provider value={value}>{children}</DraftsContext.Provider>
}

/* ---------- preview: one store per page load, Claude and Resend faked ---------- */

let drafts: Draft[] | null = null
let flags = { aiReady: true, emailReady: true }
const previewListeners = new Set<() => void>()
const previewSubscribe = (l: () => void) => {
  previewListeners.add(l)
  return () => {
    previewListeners.delete(l)
  }
}
const NO_DRAFTS: Draft[] = []
const readDrafts = () => drafts ?? NO_DRAFTS
const writeDrafts = (fn: (xs: Draft[]) => Draft[]) => {
  drafts = fn(readDrafts())
  previewListeners.forEach((l) => l())
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const reject = (message: string) => Promise.reject({ data: message })

/** The investor's live share link to the newest material of a kind, from the Materials preview data. */
function useLinkOf() {
  const m = useMaterials()
  return (investorId: string, kind: MaterialKind) => {
    const mat = m.materials.find((x) => x.kind === kind)
    const l = mat && m.links.find((x) => x.investorId === investorId && x.materialId === mat._id && linkState(x, Date.now()) === 'live')
    return { has: !!mat, url: l ? shareUrl(l.token) : undefined }
  }
}

function usePreviewInvestorDrafts(investorId: string | null): InvestorDrafts | null | undefined {
  const d = useRaise()
  const ai = d.useInvestorAI(investorId)
  const linkOf = useLinkOf()
  const list = useSyncExternalStore(previewSubscribe, readDrafts, readDrafts)
  const inv = investorId ? d.investors.find((i) => i._id === investorId) : undefined
  if (!investorId) return undefined
  if (!inv) return null
  const people = ai?.people ?? []
  const known: Known[] = [...PREVIEW_KNOWN, ...d.google.meetings.flatMap((x) => x.people.map((p) => ({ email: p.email, name: p.name, at: x.start })))]
  return {
    ...flags,
    contact: mainContact(people, inv.email),
    warm: warmPathContact(inv.path, known, { exclude: [inv.email, ...(inv.emails ?? []), ...people.map((p) => p.email)], excludeDomains: inv.domains }),
    hasDeck: linkOf(investorId, 'deck').has,
    drafts: list.filter((x) => x.investorId === investorId).slice(0, 5),
  }
}

function PreviewDrafts({ state, children }: { state: PreviewDrafts | null; children: ReactNode }) {
  const d = useRaise()
  const linkOf = useLinkOf()
  flags = { aiReady: state !== 'nokey', emailReady: state !== 'noemail' }
  // A few earlier drafts once the made-up investors are in (kept while you move between views).
  useEffect(() => {
    if (drafts === null && d.loaded) writeDrafts(() => previewHistory(d.investors, Date.now()))
  }, [d.loaded]) // eslint-disable-line react-hooks/exhaustive-deps
  // &drafts=<state> opens the dialog once the data is in.
  useEffect(() => {
    if (state && d.loaded) openDraft(previewOpen(state, d.investors))
  }, [state, d.loaded]) // eslint-disable-line react-hooks/exhaustive-deps
  // PST-294: &draft=forwardable opens the forwardable intro (Ankur, for an intro the preview links first).
  const intro = useIntroducers()
  const previewDraft = usePreviewState()?.draft
  useEffect(() => {
    const inv = d.investors.find((i) => i.name === PREVIEW_FORWARDABLE.investor)
    if (previewDraft !== 'forwardable' || !d.loaded || !intro.loaded || !inv) return
    void intro.link(inv._id, { introducerId: PREVIEW_FORWARDABLE.introducerId }).then((introId) => openDraft({ investorId: inv._id, type: 'forwardable', introId }))
  }, [previewDraft, d.loaded, intro.loaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<DraftsValue>(() => {
    const fill = (investorId: string, body: string) => {
      let out = body
      for (const { slot, kind } of LINK_SLOTS) if (out.includes(slot)) out = out.split(slot).join(linkOf(investorId, kind).url ?? shareUrl(('Pv' + kind + investorId).replace(/[^A-Za-z0-9]/g, '').padEnd(22, 'x').slice(0, 22)))
      return out
    }
    const find = (id?: string) => readDrafts().find((y) => y._id === id)
    const upsert = (x: DraftInput, patch: Partial<Draft> = {}) => {
      const id = x.draftId ?? 'pd' + Date.now().toString(36)
      writeDrafts((xs) => {
        const prev = xs.find((y) => y._id === id)
        const row: Draft = {
          status: 'draft', costUsd: 0, createdAt: Date.now(), ...prev, _id: id, investorId: x.investorId, type: x.type, subject: x.subject.trim(), body: x.body.trim(),
          ...(x.to.trim() ? { to: normEmail(x.to) } : {}), ...(x.introId ? { introId: x.introId } : {}), ...(x.forward ? { forward: x.forward } : {}), ...patch,
        }
        return [row, ...xs.filter((y) => y._id !== id)]
      })
      return id
    }
    const touch = (id: string) => {
      const x = find(id)
      if (!x || x.status === 'sent') return false
      const at = Date.now()
      writeDrafts((xs) => xs.map((y) => (y._id === id ? { ...y, status: 'sent', sentAt: at } : y)))
      if (x.type === 'confirm') previewConfirmSent(x.investorId, at)
      void d.logNote(x.investorId, (x.via === 'whatsapp' ? 'On WhatsApp: ' : '') + x.subject, { touch: x.via === 'whatsapp' ? 'note' : 'email' })
      // PST-294: a forwardable intro's ask going ticks Asked.
      if (x.introId && !intro.intros.find((y) => y._id === x.introId)?.steps.asked) void intro.setStep(x.introId, 'asked', todayIST())
      return true
    }
    return {
      useInvestorDrafts: usePreviewInvestorDrafts,
      generate: async (i) => {
        if (!isAiType(i.type)) return reject('Nest fills this one in from Close. Edit it by hand.')
        const type = i.type
        if (state === 'nokey') return Promise.reject({ data: { code: NO_AI_KEY, message: 'AI isn’t set up here.' } })
        if (state === 'writing') return new Promise<never>(() => {})
        await wait(state === 'failed' ? 600 : 900)
        if (state === 'failed') return reject('Couldn’t write it: Claude request failed (529). Try again.')
        const inv = d.investors.find((x) => x._id === i.investorId)
        if (!inv) return reject('That investor was deleted')
        const deck = linkOf(inv._id, 'deck')
        if (i.type === 'forwardable') {
          const x = intro.intros.find((y) => y._id === i.introId)
          const who = x && (x.introducerId ? intro.introducers.find((p) => p._id === x.introducerId)?.name : d.investors.find((v) => v._id === x.viaInvestorId)?.name)
          if (!who) return reject('Pick who makes the intro first.')
          const text = previewForwardable({ investor: inv, introducer: who, deck: deck.url })
          const prev = find(i.draftId)
          const costUsd = (prev && prev.status !== 'sent' ? prev.costUsd : 0) + 0.001
          const draftId = upsert({ draftId: prev && prev.status !== 'sent' ? prev._id : undefined, investorId: inv._id, type: 'forwardable', to: '', introId: i.introId, ...text }, { costUsd })
          return { draftId, ...text, costUsd }
        }
        if (i.tweak === 'deck' && !deck.has) return reject('There’s no deck in Materials yet. Add it there, then Nest can link it.')
        const text = previewDraftText({ type, investor: inv, tweak: i.tweak, current: i.current, deck: deck.url ?? DECK_LINK, dataRoom: linkOf(inv._id, 'data-room').url ?? DATA_ROOM_LINK })
        const prev = find(i.draftId)
        const reuse = prev && prev.status !== 'sent' ? prev : undefined
        const costUsd = (reuse?.costUsd ?? 0) + 0.011
        const draftId = upsert({ draftId: reuse?._id, investorId: inv._id, type: i.type, to: reuse?.to ?? '', ...text }, { costUsd })
        return { draftId, ...text, costUsd }
      },
      save: async (x) => (find(x.draftId)?.status === 'sent' ? x.draftId! : upsert(x)),
      copied: async (x, via) => {
        const body = fill(x.investorId, x.body.trim())
        if (!body) return reject('Write the message first.')
        const forward = x.forward ? { subject: x.forward.subject.trim(), body: fill(x.investorId, x.forward.body.trim()) } : undefined
        return { draftId: upsert({ ...x, body, forward }, find(x.draftId)?.status === 'sent' ? {} : { status: 'copied', via }), body, ...(forward ? { forward } : {}) }
      },
      markSent: async (id) => ({ logged: touch(id) }),
      send: async (x) => {
        if (state === 'noemail') return reject('Email isn’t set up here. Copy the text instead.')
        const to = normEmail(x.to)
        if (!isEmail(to)) return reject('Add who it goes to: an email address.')
        const n = blanks(x.subject + '\n' + x.body)
        if (n) return reject('Fill in the ' + (n === 1 ? 'blank' : n + ' blanks') + ' (' + BLANK + ') before sending.')
        if (x.body.includes(SAFE_LINK)) return reject('Paste the SAFE link in place of ' + SAFE_LINK + ' before sending.')
        if (find(x.draftId)?.status === 'sent') return reject('This one has already gone. Start a new draft.')
        await wait(700)
        const draftId = upsert({ ...x, to, body: fill(x.investorId, x.body.trim()) }, { via: 'nest' })
        touch(draftId)
        return { draftId, to }
      },
      saveMany: async (ds) => {
        const made = ds.map((x, k) => {
          const inv = d.investors.find((y) => y._id === x.investorId)
          const to = normEmail(x.to) || normEmail(inv?.email)
          return { ...x, _id: 'pd' + Date.now().toString(36) + k, to }
        })
        writeDrafts((xs) => [
          ...made.map((x): Draft => ({ _id: x._id, investorId: x.investorId, type: x.type, subject: x.subject.trim(), body: x.body.trim(), status: 'draft', costUsd: 0, createdAt: Date.now(), ...(x.to ? { to: x.to } : {}) })),
          ...xs,
        ])
        return made.map((x) => x._id)
      },
    }
  }, [d, linkOf, state, intro])
  return <DraftsContext.Provider value={value}>{children}</DraftsContext.Provider>
}
