// PST-307: what the Advisor reads and writes: its chats and their messages, the
// settings, this month against the cap, and memory. Convex when signed in (with
// optimistic updates, so a tick or a pin answers at once), an in-memory store
// under ?preview (src/preview/advisorFixture.ts), whose answers stream from a
// canned reply so the preview never calls Claude.
import type { OptimisticLocalStore } from 'convex/browser'
import { useAction, useMutation, useQuery } from 'convex/react'
import { ConvexError } from 'convex/values'
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import {
  ADVISOR_CAP, capCheck, estimateAnswer, HISTORY_MESSAGES, partsText, titleFrom,
  type AdvisorMessage, type AnswerPart, type AdvisorMode, type AdvisorModel, type AdvisorSettings, type ChatRow, type Pinned, type ScreenContext,
} from '../../lib/advisor'
import { fillBlank, type Block } from '../../lib/advisorBlocks'
import { OPUS, SONNET, type RealUsage } from '../../lib/models'
import { advisorStart, previewReply, type PreviewAdvisor } from '../../preview/advisorFixture'
import { useRaise } from '../data'
import { usePreviewState } from '../preview-state'

export type AdvisorChat = ChatRow & { pinnedContext: Pinned[]; screen?: ScreenContext }
export type ChatView = { chat: AdvisorChat; messages: AdvisorMessage[] }
export type AdvisorOverview = {
  connected: boolean
  settings: AdvisorSettings
  monthUsd: number
  monthAnswers: number
  memoryCount: number
  /** What answers have really used on each model (null: too few yet). */
  real: { sonnet: RealUsage | null; opus: RealUsage | null }
}
export type MemoryRow = { _id: string; fact: string; createdAt: number; chat?: string }
/** What Undo needs to put a deleted memory back. */
export type MemoryBackup = { fact: string; createdAt: number; chatId?: string }
export type SendInput = { chatId?: string; text: string; mode: AdvisorMode; model?: AdvisorModel; pinned?: Pinned[]; screen?: ScreenContext }
/** Whether a Suggestion was added, and what Nest said (a duplicate, a missing investor…). */
export type Outcome = { added: boolean; message: string }

export type AdvisorValue = {
  overview: AdvisorOverview | undefined
  /** Your chats, newest first. */
  chats: AdvisorChat[] | undefined
  /** One chat with its messages (null: not yours, or deleted). A hook. */
  useChat: (chatId: string | null) => ChatView | null | undefined
  /** Settings › AI › Advisor › Memory. A hook. */
  useMemory: () => MemoryRow[] | undefined
  send: (a: SendInput) => Promise<{ chatId: string; messageId: string }>
  stop: (messageId: string) => Promise<unknown>
  /** Regenerate, or "Ask Opus instead" with a model for this answer only. */
  regenerate: (messageId: string, model?: AdvisorModel) => Promise<unknown>
  editLast: (chatId: string, text: string) => Promise<unknown>
  rename: (chatId: string, title: string) => Promise<unknown>
  setPinned: (chatId: string, pinned: boolean) => Promise<unknown>
  setModel: (chatId: string, model: AdvisorModel) => Promise<unknown>
  setContext: (chatId: string, pinned: Pinned[]) => Promise<unknown>
  remove: (chatId: string) => Promise<unknown>
  restore: (chatId: string) => Promise<unknown>
  updateBlock: (messageId: string, index: number, block: Block) => Promise<unknown>
  answerMemory: (messageId: string, index: number, yes: boolean, fact?: string) => Promise<unknown>
  sendSuggestion: (messageId: string, index: number) => Promise<Outcome>
  blankToPlan: (messageId: string, index: number, value: string) => Promise<Outcome>
  saveToQanda: (messageId: string, index: number) => Promise<string>
  /** "Move to …" on an investor card: a stage Suggestion, nothing moves. */
  suggestMove: (messageId: string, index: number, stage: string) => Promise<Outcome>
  /** "Try another" on a story beat: resolves with the new line. */
  tryAnother: (messageId: string, index: number, beat: number) => Promise<string>
  setSettings: (p: Partial<AdvisorSettings>) => Promise<unknown>
  editMemory: (id: string, fact: string) => Promise<unknown>
  deleteMemory: (id: string) => Promise<MemoryBackup | null>
  restoreMemory: (b: MemoryBackup) => Promise<unknown>
}

const AdvisorContext = createContext<AdvisorValue | null>(null)
export function useAdvisor(): AdvisorValue {
  const v = useContext(AdvisorContext)
  if (!v) throw new Error('useAdvisor outside AdvisorProvider')
  return v
}

/** The cap refused it (send, Regenerate, Try another): the notice with its link to Settings shows instead of a toast. */
export const isCapError = (e: unknown) => e instanceof ConvexError && (e.data as { code?: string } | null)?.code === ADVISOR_CAP

/** What the next answer in a chat should cost (the composer's estimate, and the cap check before sending). */
export function nextCost(o: AdvisorOverview, model: AdvisorModel, mode: AdvisorMode, messages: readonly Pick<AdvisorMessage, 'text'>[]) {
  const real = o.real[model === OPUS ? 'opus' : 'sonnet']
  const historyChars = messages.slice(-HISTORY_MESSAGES).reduce((s, m) => s + m.text.length, 0)
  return estimateAnswer({ model, mode, web: o.settings.web, historyChars, real: real?.avg, realCount: real?.runs })
}

/** Inside the Raise data (ConvexData, or PreviewData under ?preview). */
export function AdvisorProvider({ children }: { children: ReactNode }) {
  const preview = usePreviewState()
  return preview ? <PreviewAdvisorProvider state={(preview.advisor as PreviewAdvisor | null | undefined) ?? null}>{children}</PreviewAdvisorProvider> : <ConvexAdvisor>{children}</ConvexAdvisor>
}

/* ---------- Convex ---------- */

const chatId = (id: string) => id as Id<'advisorChats'>
const messageId = (id: string) => id as Id<'advisorMessages'>

function useConvexChat(id: string | null): ChatView | null | undefined {
  return useQuery(api.advisor.chat, id ? { chatId: chatId(id) } : 'skip') as ChatView | null | undefined
}
function useConvexMemory(): MemoryRow[] | undefined {
  return useQuery(api.advisor.memory)
}

function ConvexAdvisor({ children }: { children: ReactNode }) {
  const overview = useQuery(api.advisor.overview) as AdvisorOverview | undefined
  const chats = useQuery(api.advisor.chats) as AdvisorChat[] | undefined
  const patchChat = (store: OptimisticLocalStore, id: string, p: Partial<AdvisorChat>) => {
    const list = store.getQuery(api.advisor.chats, {})
    if (list) store.setQuery(api.advisor.chats, {}, list.map((c) => (c._id === id ? { ...c, ...p } : c)) as typeof list)
  }
  const rename = useMutation(api.advisor.rename).withOptimisticUpdate((s, a) => patchChat(s, a.chatId, { title: a.title }))
  const setPinned = useMutation(api.advisor.setPinned).withOptimisticUpdate((s, a) => patchChat(s, a.chatId, { pinned: a.pinned }))
  const setModel = useMutation(api.advisor.setModel).withOptimisticUpdate((s, a) => patchChat(s, a.chatId, { model: a.model as AdvisorModel }))
  const remove = useMutation(api.advisor.remove).withOptimisticUpdate((s, a) => {
    const list = s.getQuery(api.advisor.chats, {})
    if (list) s.setQuery(api.advisor.chats, {}, list.filter((c) => c._id !== a.chatId))
  })
  const updateBlock = useMutation(api.advisor.updateBlock).withOptimisticUpdate((s, a) => {
    for (const q of s.getAllQueries(api.advisor.chat)) {
      const v = q.value
      if (!v || !v.messages.some((m) => m._id === a.messageId)) continue
      s.setQuery(api.advisor.chat, q.args, { ...v, messages: v.messages.map((m) => (m._id === a.messageId ? { ...m, blocks: m.blocks.map((b, i) => (i === a.index ? a.block : b)) } : m)) as typeof v.messages })
    }
  })
  const m = {
    send: useMutation(api.advisor.send),
    stop: useMutation(api.advisor.stop),
    regenerate: useMutation(api.advisor.regenerate),
    editLast: useMutation(api.advisor.editLast),
    setContext: useMutation(api.advisor.setContext),
    restore: useMutation(api.advisor.restore),
    answerMemory: useMutation(api.advisor.answerMemory),
    sendSuggestion: useMutation(api.advisor.sendSuggestion),
    blankToPlan: useMutation(api.advisor.blankToPlan),
    saveToQanda: useMutation(api.advisor.saveToQanda),
    suggestMove: useMutation(api.advisor.suggestMove),
    tryAnother: useAction(api.advisor.tryAnother),
    setSettings: useMutation(api.advisor.setSettings),
    editMemory: useMutation(api.advisor.editMemory),
    deleteMemory: useMutation(api.advisor.deleteMemory),
    restoreMemory: useMutation(api.advisor.restoreMemory),
  }
  const value = useMemo<AdvisorValue>(
    () => ({
      overview,
      chats,
      useChat: useConvexChat,
      useMemory: useConvexMemory,
      send: (a) => m.send({ ...a, chatId: a.chatId ? chatId(a.chatId) : undefined }),
      stop: (id) => m.stop({ messageId: messageId(id) }),
      regenerate: (id, model) => m.regenerate({ messageId: messageId(id), ...(model ? { model } : {}) }),
      editLast: (id, text) => m.editLast({ chatId: chatId(id), text }),
      rename: (id, title) => rename({ chatId: chatId(id), title }),
      setPinned: (id, pinned) => setPinned({ chatId: chatId(id), pinned }),
      setModel: (id, model) => setModel({ chatId: chatId(id), model }),
      setContext: (id, pinned) => m.setContext({ chatId: chatId(id), pinned }),
      remove: (id) => remove({ chatId: chatId(id) }),
      restore: (id) => m.restore({ chatId: chatId(id) }),
      updateBlock: (id, index, block) => updateBlock({ messageId: messageId(id), index, block }),
      answerMemory: (id, index, yes, fact) => m.answerMemory({ messageId: messageId(id), index, yes, ...(fact !== undefined ? { fact } : {}) }),
      sendSuggestion: (id, index) => m.sendSuggestion({ messageId: messageId(id), index }),
      blankToPlan: (id, index, value) => m.blankToPlan({ messageId: messageId(id), index, value }),
      saveToQanda: (id, index) => m.saveToQanda({ messageId: messageId(id), index }),
      suggestMove: (id, index, stage) => m.suggestMove({ messageId: messageId(id), index, stage }),
      tryAnother: (id, index, beat) => m.tryAnother({ messageId: messageId(id), index, beat }),
      setSettings: (p) => m.setSettings(p),
      editMemory: (id, fact) => m.editMemory({ id: id as Id<'advisorMemory'>, fact }),
      deleteMemory: (id) => m.deleteMemory({ id: id as Id<'advisorMemory'> }),
      restoreMemory: (b) => m.restoreMemory({ ...b, chatId: b.chatId ? chatId(b.chatId) : undefined }),
    }),
    // The mutation hooks are stable; the data is what changes.
    [overview, chats], // eslint-disable-line react-hooks/exhaustive-deps
  )
  return <AdvisorContext.Provider value={value}>{children}</AdvisorContext.Provider>
}

/* ---------- preview: one store per page load ---------- */

export type PreviewStore = { overview: AdvisorOverview; chats: AdvisorChat[]; messages: Record<string, AdvisorMessage[]>; memory: MemoryRow[]; /** Deleted chats, for Undo. */ removed: Record<string, AdvisorChat> }
let store: PreviewStore | null = null
const listeners = new Set<() => void>()
const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
const read = () => store
const write = (fn: (s: PreviewStore) => PreviewStore) => {
  if (!store) return
  store = fn(store)
  listeners.forEach((l) => l())
}
const later = <T,>(v: T, ms = 250) => new Promise<T>((r) => setTimeout(() => r(v), ms))
let seq = 0
const newId = (p: string) => p + Date.now().toString(36) + seq++

const patchMessage = (id: string, fn: (m: AdvisorMessage) => AdvisorMessage) =>
  write((s) => ({ ...s, messages: Object.fromEntries(Object.entries(s.messages).map(([k, ms]) => [k, ms.map((m) => (m._id === id ? fn(m) : m))])) }))
const findMessage = (id: string) => Object.values(read()?.messages ?? {}).flat().find((m) => m._id === id)
const setBlock = (id: string, index: number, b: Block) => patchMessage(id, (m) => ({ ...m, blocks: m.blocks.map((x, i) => (i === index ? b : x)) }))
const patchChat = (id: string, p: Partial<AdvisorChat>) => write((s) => ({ ...s, chats: s.chats.map((c) => (c._id === id ? { ...c, ...p } : c)) }))

/** The canned reply streams in a few words at a time, each block landing in its place (PST-308), then the follow-ups. Stop ends it where it is. */
function streamReply(id: string, mode: AdvisorMode, question: string) {
  const reply = previewReply(mode, question, read()?.chats ?? [])
  // One step per three words, one per block.
  const steps: AnswerPart[][] = []
  const shown: AnswerPart[] = []
  for (const p of reply.parts) {
    if ('text' in p) {
      const words = p.text.split(/(?<=\s)/)
      for (let at = 3; at < words.length + 3; at += 3) steps.push([...shown, { text: words.slice(0, at).join('') }])
    } else steps.push([...shown, p])
    shown.push(p)
  }
  let at = 0
  const t = setInterval(() => {
    const m = findMessage(id)
    if (!m || m.status !== 'streaming') return clearInterval(t)
    const parts = steps[Math.min(at++, steps.length - 1)] ?? []
    const done = at >= steps.length
    // Blocks land as they're reached (the reply lists them in order), the follow-ups at the end.
    const blocks = done ? reply.blocks : reply.blocks.slice(0, Math.max(-1, ...parts.flatMap((p) => ('block' in p ? [p.block] : []))) + 1)
    patchMessage(id, (x) => ({ ...x, parts, blocks, text: partsText(parts), ...(done ? { status: 'done', sources: reply.sources, costUsd: reply.costUsd } : {}) }))
    if (done) {
      clearInterval(t)
      write((s) => ({ ...s, overview: { ...s.overview, monthUsd: s.overview.monthUsd + reply.costUsd, monthAnswers: s.overview.monthAnswers + 1 } }))
      const c = read()?.chats.find((x) => x._id === m.chatId)
      if (c) patchChat(c._id, { totalCostUsd: c.totalCostUsd + reply.costUsd })
    }
  }, 90)
}

function capError(o: AdvisorOverview, model: AdvisorModel, mode: AdvisorMode, history: readonly AdvisorMessage[]) {
  const ok = capCheck(o.monthUsd, nextCost(o, model, mode, history), o.settings.capUsd)
  return ok.ok ? null : new ConvexError({ code: ADVISOR_CAP, message: ok.message })
}

function PreviewAdvisorProvider({ state, children }: { state: PreviewAdvisor | null; children: ReactNode }) {
  const d = useRaise()
  useEffect(() => {
    if (store || !d.loaded) return
    store = advisorStart(state, d.investors, Date.now())
    listeners.forEach((l) => l())
  }, [state, d.loaded, d.investors])
  const s = useSyncExternalStore(subscribe, read, read)
  const value = useMemo<AdvisorValue>(() => {
    const answerAgain = (id: string, model?: AdvisorModel) => {
      const m = findMessage(id)
      if (!m || !s) return Promise.reject(new ConvexError('That message is gone.'))
      const history = s.messages[m.chatId] ?? []
      const err = capError(s.overview, model ?? (m.model === OPUS ? OPUS : SONNET), m.mode ?? 'coach', history)
      if (err) return Promise.reject(err)
      const q = [...history].reverse().find((x) => x.role === 'user' && x.createdAt <= m.createdAt)
      patchMessage(id, (x) => ({ ...x, text: '', blocks: [], parts: [], sources: [], status: 'streaming', error: undefined, ...(model ? { model } : {}) }))
      streamReply(id, m.mode ?? 'coach', q?.text ?? '')
      return later(id, 0)
    }
    return {
      overview: s?.overview,
      chats: s?.chats.slice().sort((a, b) => b.updatedAt - a.updatedAt),
      useChat: usePreviewChat,
      useMemory: usePreviewMemory,
      send: async (a) => {
        if (!s) throw new ConvexError('Still loading.')
        const now = Date.now()
        const existing = a.chatId ? s.chats.find((c) => c._id === a.chatId) : undefined
        const history = existing ? (s.messages[existing._id] ?? []) : []
        if (history.some((m) => m.status === 'streaming')) throw new ConvexError('Wait for the answer, or press Stop.')
        const model: AdvisorModel = a.model ?? (existing ? (existing.model === OPUS ? OPUS : SONNET) : s.overview.settings.model)
        const err = capError(s.overview, model, a.mode, history)
        if (err) throw err
        const id = existing?._id ?? newId('pc')
        const answerId = newId('pm')
        const user: AdvisorMessage = { _id: newId('pm'), chatId: id, role: 'user', text: a.text.trim(), blocks: [], sources: [], mode: a.mode, costUsd: 0, status: 'done', createdAt: now }
        const answer: AdvisorMessage = { _id: answerId, chatId: id, role: 'assistant', text: '', blocks: [], parts: [], sources: [], model, mode: a.mode, costUsd: 0, status: 'streaming', createdAt: now + 1 }
        write((x) => ({
          ...x,
          chats: existing
            ? x.chats.map((c) => (c._id === id ? { ...c, updatedAt: now, mode: a.mode, messageCount: c.messageCount + 2, ...(a.pinned ? { pinnedContext: a.pinned } : {}) } : c))
            : [{ _id: id, title: titleFrom(a.text), pinned: false, model, mode: a.mode, createdAt: now, updatedAt: now, totalCostUsd: 0, messageCount: 2, pinnedContext: a.pinned ?? [], ...(a.screen ? { screen: a.screen } : {}) }, ...x.chats],
          messages: { ...x.messages, [id]: [...history, user, answer] },
        }))
        setTimeout(() => streamReply(answerId, a.mode, a.text), 500)
        return { chatId: id, messageId: answerId }
      },
      stop: async (id) => patchMessage(id, (m) => (m.status === 'streaming' ? { ...m, status: 'stopped' } : m)),
      regenerate: answerAgain,
      editLast: async (id, text) => {
        const ms = s?.messages[id] ?? []
        const last = [...ms].reverse().find((m) => m.role === 'user')
        const answer = ms[ms.length - 1]
        if (!last) return
        patchMessage(last._id, (m) => ({ ...m, text: text.trim() }))
        if (answer?.role === 'assistant') return answerAgain(answer._id)
      },
      rename: async (id, title) => patchChat(id, { title: title.replace(/\s+/g, ' ').trim() }),
      setPinned: async (id, pinned) => patchChat(id, { pinned }),
      setModel: async (id, model) => patchChat(id, { model }),
      setContext: async (id, pinned) => patchChat(id, { pinnedContext: pinned }),
      remove: async (id) =>
        write((x) => {
          const gone = x.chats.find((c) => c._id === id)
          return gone ? { ...x, chats: x.chats.filter((c) => c._id !== id), removed: { ...x.removed, [id]: gone } } : x
        }),
      restore: async (id) => write((x) => (x.removed[id] ? { ...x, chats: [...x.chats, x.removed[id]] } : x)),
      updateBlock: async (id, index, block) => setBlock(id, index, block),
      answerMemory: async (id, index, yes, fact) => {
        const b = findMessage(id)?.blocks[index]
        if (b?.kind !== 'memory') return
        if (!yes) return setBlock(id, index, { ...b, state: 'dismissed' })
        const memoryId = newId('pmem')
        write((x) => ({ ...x, memory: [{ _id: memoryId, fact: fact ?? b.fact, createdAt: Date.now() }, ...x.memory], overview: { ...x.overview, memoryCount: x.overview.memoryCount + 1 } }))
        setBlock(id, index, { ...b, fact: fact ?? b.fact, state: 'saved', memoryId })
      },
      sendSuggestion: async (id, index) => {
        const b = findMessage(id)?.blocks[index]
        if (b?.kind !== 'suggestion') return { added: false, message: '' }
        setBlock(id, index, { ...b, state: 'sent', note: 'Added to Suggestions.' })
        return later({ added: true, message: 'Added to Suggestions.' })
      },
      blankToPlan: async (id, index, v) => {
        const b = findMessage(id)?.blocks[index]
        if (b?.kind === 'blank') setBlock(id, index, { ...b, value: v.trim(), saved: 'plan' })
        return later({ added: true, message: 'Added to Suggestions.' })
      },
      saveToQanda: async (id, index) => {
        const b = findMessage(id)?.blocks[index]
        if (b?.kind === 'draft') setBlock(id, index, { ...b, questionId: 'pq-' + index })
        return later('pq-' + index)
      },
      suggestMove: async () => later({ added: true, message: 'Added to Suggestions.' }),
      tryAnother: async (id, index, beat) => {
        const m = findMessage(id)
        const b = m?.blocks[index]
        if (!m || b?.kind !== 'story' || !b.beats[beat]) throw new ConvexError('That line is gone.')
        const text = fillBlank('Picture bedtime: [__] parents told us the same story is the only one that works.', '[__]')
        await later(null, 700)
        setBlock(id, index, { ...b, beats: b.beats.map((x, i) => (i === beat ? { ...x, text: beat % 2 ? text : x.text.replace(/\.$/, '') + ', every single night.' } : x)) })
        return text
      },
      setSettings: async (p) => write((x) => ({ ...x, overview: { ...x.overview, settings: { ...x.overview.settings, ...p } } })),
      editMemory: async (id, fact) => write((x) => ({ ...x, memory: x.memory.map((r) => (r._id === id ? { ...r, fact } : r)) })),
      deleteMemory: async (id) => {
        const r = read()?.memory.find((x) => x._id === id)
        if (!r) return null
        write((x) => ({ ...x, memory: x.memory.filter((y) => y._id !== id), overview: { ...x.overview, memoryCount: x.overview.memoryCount - 1 } }))
        return { fact: r.fact, createdAt: r.createdAt }
      },
      restoreMemory: async (b) => write((x) => ({ ...x, memory: [...x.memory, { _id: newId('pmem'), ...b }].sort((p, q) => q.createdAt - p.createdAt), overview: { ...x.overview, memoryCount: x.overview.memoryCount + 1 } })),
    }
  }, [s])
  return <AdvisorContext.Provider value={value}>{children}</AdvisorContext.Provider>
}

function usePreviewChat(id: string | null): ChatView | null | undefined {
  const s = useSyncExternalStore(subscribe, read, read)
  return useMemo(() => {
    if (!s) return undefined
    const chat = id ? s.chats.find((c) => c._id === id) : undefined
    return chat ? { chat, messages: s.messages[chat._id] ?? [] } : null
  }, [s, id])
}
function usePreviewMemory(): MemoryRow[] | undefined {
  return useSyncExternalStore(subscribe, read, read)?.memory
}
