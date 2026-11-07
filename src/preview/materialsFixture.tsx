// DEV ONLY: made-up Materials for ?preview (PST-282). Invented investors from the
// fixture, invented numbers; dates follow today. Writes stay in memory.
//   &materials=empty|versions|views|share|sent|upload|noemail|opened
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { MaterialsContext, type MaterialsActions, type MaterialsValue, type NewLink } from '../components/materials/data'
import { useRaise } from '../components/data'
import { DAY_MS, normOptions, DEFAULT_OPTIONS, type Material, type MaterialsData, type MaterialVersion, type ShareLink, type ViewStat } from '../lib/materials'
import { fakePdf } from './fakePdf'

export const PREVIEW_MATERIALS = ['default', 'empty', 'versions', 'views', 'share', 'sent', 'upload', 'noemail', 'opened'] as const
export type PreviewMaterials = (typeof PREVIEW_MATERIALS)[number]

const H = 36e5
const sec = (s: number) => s * 1000
/** Seconds per page, as a stat's pageMs. */
const pages = (...s: number[]) => s.map(sec)

/** The made-up library: a deck in four versions, a memo and a model (Google links), a one-pager, data room files. */
export function fixtureMaterials(investorIds: Record<string, string>, now: number): MaterialsData {
  const ago = (days: number, hours = 0) => now - days * DAY_MS - hours * H
  const materials: Material[] = [
    { _id: 'mdeck', kind: 'deck', title: 'Pitch deck', currentVersionId: 'vdeck4', createdAt: ago(24) },
    { _id: 'mmemo', kind: 'memo', title: 'Investment memo', currentVersionId: 'vmemo2', createdAt: ago(14) },
    { _id: 'mone', kind: 'one-pager', title: 'One-pager', currentVersionId: 'vone3', createdAt: ago(20) },
    { _id: 'mmodel', kind: 'model', title: 'Financial model', currentVersionId: 'vmodel2', createdAt: ago(12) },
    { _id: 'mcap', kind: 'data-room', title: 'Cap table', currentVersionId: 'vcap1', createdAt: ago(10) },
    { _id: 'minc', kind: 'data-room', title: 'Incorporation documents', currentVersionId: 'vinc1', createdAt: ago(10) },
    { _id: 'mmetrics', kind: 'data-room', title: 'Beta metrics', currentVersionId: 'vmet1', createdAt: ago(6) },
  ]
  const v = (id: string, materialId: string, n: number, days: number, x: Partial<MaterialVersion>): MaterialVersion => ({ _id: id, materialId, n, createdAt: ago(days), note: '', by: 'Dev', ...x })
  const versions: MaterialVersion[] = [
    v('vdeck1', 'mdeck', 1, 24, { fileId: 'fx-file', pages: 15, note: 'First version.' }),
    v('vdeck2', 'mdeck', 2, 19, { fileId: 'fx-file', pages: 12, note: 'Rewrote the ask around the beta.' }),
    v('vdeck3', 'mdeck', 3, 13, { fileId: 'fx-file', pages: 13, note: 'Added the founding families slide.' }),
    v('vdeck4', 'mdeck', 4, 4, { fileId: 'fx-file', pages: 14, note: 'New retention slide. Market slide cut to one chart.' }),
    v('vmemo1', 'mmemo', 1, 14, { url: 'https://docs.google.com/document/d/made-up-memo/edit', note: 'First draft.' }),
    v('vmemo2', 'mmemo', 2, 7, { url: 'https://docs.google.com/document/d/made-up-memo/edit', note: 'Added the beta numbers and the use of funds.' }),
    v('vone1', 'mone', 1, 20, { fileId: 'fx-file', pages: 1, note: 'For intros.' }),
    v('vone2', 'mone', 2, 11, { fileId: 'fx-file', pages: 1, note: 'Shorter.' }),
    v('vone3', 'mone', 3, 5, { fileId: 'fx-file', pages: 1, note: 'For intros. Forwardable, no numbers that go stale.' }),
    v('vmodel1', 'mmodel', 1, 12, { url: 'https://docs.google.com/spreadsheets/d/made-up-model/edit', note: 'Base case.' }),
    v('vmodel2', 'mmodel', 2, 9, { url: 'https://docs.google.com/spreadsheets/d/made-up-model/edit', note: 'Base and stretch cases. Opens at Diligence.' }),
    v('vcap1', 'mcap', 1, 10, { url: 'https://docs.google.com/spreadsheets/d/made-up-cap-table/edit', note: 'Post-money, with the SAFE pool.' }),
    v('vinc1', 'minc', 1, 10, { fileId: 'fx-file', pages: 6, note: 'Certificate and articles.' }),
    v('vmet1', 'mmetrics', 1, 6, { fileId: 'fx-file', pages: 3, note: 'Week-4 retention and activation.' }),
  ]
  const links: ShareLink[] = []
  const stats: ViewStat[] = []
  let k = 0
  const link = (who: string, materialId: string, versionId: string, sentDays: number, view?: { at: number; opens?: number; pageMs: number[]; device?: ViewStat['device'] }) => {
    const investorId = investorIds[who]
    if (!investorId) return
    const id = `lfx${k++}`
    const createdAt = ago(sentDays, 3)
    links.push({ _id: id, token: `made-up-preview-${String(k).padStart(5, '0')}`, investorId, materialId, versionId, options: { ...DEFAULT_OPTIONS }, createdAt, expiresAt: createdAt + 30 * DAY_MS, ...(view ? { firstOpenedAt: view.at - H } : {}) })
    if (view) {
      const totalMs = view.pageMs.reduce((a, b) => a + b, 0)
      stats.push({ linkId: id, versionId, opens: view.opens ?? 1, firstAt: view.at - H, lastAt: view.at, totalMs, pageMs: view.pageMs, device: view.device ?? 'desktop', email: `${who.split(' ')[0].toLowerCase()}@example.com` })
    }
  }
  link('Kite Angels', 'mdeck', 'vdeck4', 3, { at: ago(0, 2), pageMs: pages(8, 12, 14, 9, 13, 41, 15, 12, 11, 6, 5, 4, 7, 5), device: 'phone' })
  link('Kite Angels', 'mone', 'vone3', 8, { at: ago(7), pageMs: pages(40) })
  link('Orchard Capital', 'mmemo', 'vmemo2', 2, { at: ago(1, 1), opens: 2, pageMs: pages(570) })
  link('Orchard Capital', 'mdeck', 'vdeck4', 3, { at: ago(1, 5), pageMs: pages(10, 14, 17, 12, 15, 39, 16, 11, 13, 4, 3, 3, 6, 2) })
  link('Fernhill Fund', 'mdeck', 'vdeck4', 4, { at: ago(2), pageMs: pages(18, 17, 13) })
  link('Lantern Ventures', 'mdeck', 'vdeck3', 10, { at: ago(3), pageMs: pages(9, 11, 13, 10, 12, 35, 13, 9, 13, 0, 0, 0, 0) })
  link('Northwind Accelerator', 'mdeck', 'vdeck3', 11)
  link('Juniper Seed', 'mdeck', 'vdeck4', 3, { at: ago(1, 9), pageMs: pages(11, 15, 18, 13, 16, 44, 17, 12, 14, 7, 6, 5, 9, 7), device: 'tablet' })
  link('Saltmarsh Angels', 'mdeck', 'vdeck4', 4, { at: ago(4), pageMs: pages(12, 13, 15, 11, 14, 33, 12, 5, 0, 0, 0, 0, 0, 0) })
  link('Morrow Ventures', 'mdeck', 'vdeck4', 1)
  link('Tidewater Angels', 'mone', 'vone3', 2, { at: ago(1, 3), pageMs: pages(25) })
  link('Orchard Capital', 'mmodel', 'vmodel2', 1, { at: ago(0, 5), pageMs: pages(140) })
  link('Orchard Capital', 'mcap', 'vcap1', 1, { at: ago(0, 6), pageMs: pages(65) })
  link('Orchard Capital', 'minc', 'vinc1', 1, { at: ago(0, 6), pageMs: pages(12, 8, 5, 4, 2, 2) })
  const kite = links.find((l) => l.investorId === investorIds['Kite Angels'] && l.materialId === 'mdeck')
  return {
    loaded: true,
    materials,
    versions,
    links,
    stats,
    notices: kite ? [{ linkId: kite._id, investorId: kite.investorId!, at: kite.firstOpenedAt! }] : [],
    emailReady: true,
  }
}

/** In-memory Materials for ?preview. Shares write a history note through the preview's own logNote. */
export function PreviewMaterials({ state, children }: { state: PreviewMaterials; children: ReactNode }) {
  const raise = useRaise()
  const ids = useMemo(() => Object.fromEntries(raise.investors.map((i) => [i.name, i._id])), [raise.investors])
  const [data, setData] = useState<MaterialsData | null>(null)
  useEffect(() => {
    if (data || !raise.loaded) return
    const d = state === 'empty' ? { ...fixtureMaterials({}, Date.now()), materials: [], versions: [], links: [], stats: [], notices: [] } : fixtureMaterials(ids, Date.now())
    setData({ ...d, notices: state === 'opened' ? [] : d.notices, emailReady: state !== 'noemail' })
  }, [data, raise.loaded, ids, state])
  // &materials=opened: a first open arrives a moment after load (the toast and Today's row).
  useEffect(() => {
    if (state !== 'opened' || !data?.links.length) return
    const t = setTimeout(() => {
      setData((d) => {
        const l = d?.links.find((x) => x.investorId === ids['Kite Angels'] && x.materialId === 'mdeck')
        return d && l ? { ...d, notices: [{ linkId: l._id, investorId: l.investorId!, at: Date.now() }] } : d
      })
    }, 1500)
    return () => clearTimeout(t)
  }, [state, data?.links.length, ids])
  const files = useRef(new Map<string, string>())
  const latest = useRef(raise)
  useEffect(() => {
    latest.current = raise
  })

  const act = useMemo<MaterialsActions>(() => {
    let n = 0
    const id = (p: string) => `${p}${Date.now()}${n++}`
    const set = (fn: (d: MaterialsData) => MaterialsData) => setData((d) => (d ? fn(d) : d))
    const addVersion = async (materialId: string, s: { fileId?: string; url?: string; pages?: number; note: string }) => {
      const vid = id('pv')
      set((d) => {
        const n = Math.max(0, ...d.versions.filter((x) => x.materialId === materialId).map((x) => x.n)) + 1
        return {
          ...d,
          versions: [...d.versions, { _id: vid, materialId, n, createdAt: Date.now(), by: 'Dev', ...s }],
          materials: d.materials.map((m) => (m._id === materialId ? { ...m, currentVersionId: vid } : m)),
        }
      })
      return vid
    }
    return {
      upload: async (file) => {
        const fid = id('pf')
        files.current.set(fid, URL.createObjectURL(file))
        return fid
      },
      create: async (kind, title, s) => {
        const mid = id('pm')
        set((d) => ({ ...d, materials: [...d.materials, { _id: mid, kind, title: title.trim(), createdAt: Date.now() }] }))
        await addVersion(mid, s)
        return mid
      },
      addVersion,
      makeCurrent: async (versionId) =>
        set((d) => {
          const ver = d.versions.find((x) => x._id === versionId)
          return ver ? { ...d, materials: d.materials.map((m) => (m._id === ver.materialId ? { ...m, currentVersionId: versionId } : m)) } : d
        }),
      remove: async (materialId) =>
        set((d) => ({
          ...d,
          materials: d.materials.filter((m) => m._id !== materialId),
          versions: d.versions.filter((x) => x.materialId !== materialId),
          links: d.links.filter((l) => l.materialId !== materialId),
        })),
      share: async ({ materialId, versionId, investorIds, options, expiresInDays }) => {
        const now = Date.now()
        const out: NewLink[] = investorIds.map((investorId) => ({ linkId: id('pl'), investorId, token: Math.random().toString(36).slice(2, 13).padEnd(22, 'x') }))
        set((d) => ({
          ...d,
          links: [
            ...d.links,
            ...out.map((l) => ({ _id: l.linkId, token: l.token, investorId: l.investorId, materialId, versionId, options: normOptions(options), createdAt: now, ...(expiresInDays ? { expiresAt: now + expiresInDays * DAY_MS } : {}) })),
          ],
        }))
        const title = data?.materials.find((m) => m._id === materialId)?.title ?? 'a document'
        for (const l of out) await latest.current.logNote(l.investorId, `Sent a link to ${title}`).catch(() => {})
        return out
      },
      revoke: async (linkId) => set((d) => ({ ...d, links: d.links.map((l) => (l._id === linkId ? { ...l, revokedAt: Date.now() } : l)) })),
      seen: async (linkIds) => set((d) => ({ ...d, notices: d.notices.filter((x) => !linkIds.includes(x.linkId)) })),
      email: async (linkIds) => {
        await new Promise((r) => setTimeout(r, 600))
        return state === 'noemail' ? { sent: 0, failed: 0, skipped: linkIds.length } : { sent: linkIds.length, failed: 0, skipped: 0 }
      },
      fileUrl: async (versionId) => {
        const ver = data?.versions.find((x) => x._id === versionId)
        if (!ver) return null
        if (ver.url) return ver.url
        const own = ver.fileId && files.current.get(ver.fileId)
        if (own) return own
        const title = data?.materials.find((m) => m._id === ver.materialId)?.title ?? 'Document'
        return URL.createObjectURL(fakePdf(`${title} v${ver.n}`, ver.pages ?? 1))
      },
    }
  }, [data, state])
  const value = useMemo<MaterialsValue>(() => ({ ...(data ?? { loaded: false, materials: [], versions: [], links: [], stats: [], notices: [], emailReady: false }), act }), [data, act])
  return <MaterialsContext.Provider value={value}>{children}</MaterialsContext.Provider>
}
