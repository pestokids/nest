// PST-282: what the Materials views read and write. Backed by Convex
// (ConvexMaterials) or by the made-up preview data (src/preview/materialsFixture.ts).
import { useConvex, useMutation, useQuery, useAction } from 'convex/react'
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { showMaterials } from '../optimistic'
import { NO_MATERIALS, PDF_TYPE, type LinkOptions, type MaterialKind, type MaterialsData } from '../../lib/materials'

/** A version's contents: an uploaded PDF (its storage id and page count) or a link, and a one-line note. */
export type Source = { fileId?: string; url?: string; pages?: number; note: string }
export type NewLink = { linkId: string; investorId: string; token: string }
export type ShareInput = { materialId: string; versionId: string; investorIds: string[]; options: LinkOptions; expiresInDays: number }

export type MaterialsActions = {
  /** Put a PDF in file storage; resolves with its storage id. */
  upload: (file: File) => Promise<string>
  create: (kind: MaterialKind, title: string, source: Source) => Promise<string>
  /** A new version, which becomes current. */
  addVersion: (materialId: string, source: Source) => Promise<string>
  makeCurrent: (versionId: string) => Promise<unknown>
  remove: (materialId: string) => Promise<unknown>
  /** One link per investor. */
  share: (input: ShareInput) => Promise<NewLink[]>
  revoke: (linkId: string) => Promise<unknown>
  /** First-open notices seen (Today's row, the toast). */
  seen: (linkIds: string[]) => Promise<unknown>
  email: (linkIds: string[], message: string) => Promise<{ sent: number; failed: number; skipped: number }>
  /** Where to read one version inside Nest (older versions stay readable). */
  fileUrl: (versionId: string) => Promise<string | null>
}
export type MaterialsValue = MaterialsData & { act: MaterialsActions }

export const MaterialsContext = createContext<MaterialsValue | null>(null)
export function useMaterials(): MaterialsValue {
  const v = useContext(MaterialsContext)
  if (!v) throw new Error('useMaterials outside MaterialsContext')
  return v
}

/** Live Convex data for Materials. */
export function ConvexMaterials({ children }: { children: ReactNode }) {
  const d = useQuery(api.materials.data)
  const convex = useConvex()
  const uploadUrl = useMutation(api.materials.uploadUrl)
  const create = useMutation(api.materials.create)
  const addVersion = useMutation(api.materials.addVersion)
  // PST-298: these show at once; uploads, new versions and shares wait for what they make.
  const makeCurrent = useMutation(api.materials.makeCurrent).withOptimisticUpdate((store, { versionId }) => showMaterials(store, { current: versionId }))
  const remove = useMutation(api.materials.remove).withOptimisticUpdate((store, { materialId }) => showMaterials(store, { remove: materialId }))
  const share = useMutation(api.materials.share)
  const revoke = useMutation(api.materials.revoke).withOptimisticUpdate((store, { linkId }) => showMaterials(store, { revoke: linkId }))
  const seen = useMutation(api.materials.seen).withOptimisticUpdate((store, { linkIds }) => showMaterials(store, { seen: linkIds }))
  const email = useAction(api.materials.emailLinks)
  const act = useMemo<MaterialsActions>(() => {
    const src = (s: Source) => ({ ...s, fileId: s.fileId as Id<'_storage'> | undefined })
    return {
      upload: async (file) => {
        const url = await uploadUrl({})
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': file.type || PDF_TYPE }, body: file }).catch(() => null)
        if (!res?.ok) throw { data: 'The upload didn’t go through. Check your connection and try again.' }
        return ((await res.json()) as { storageId: string }).storageId
      },
      create: (kind, title, s) => create({ kind, title, source: src(s) }),
      addVersion: (materialId, s) => addVersion({ materialId: materialId as Id<'materials'>, source: src(s) }),
      makeCurrent: (versionId) => makeCurrent({ versionId: versionId as Id<'materialVersions'> }),
      remove: (materialId) => remove({ materialId: materialId as Id<'materials'> }),
      share: (x) =>
        share({
          materialId: x.materialId as Id<'materials'>,
          versionId: x.versionId === 'current' ? 'current' : (x.versionId as Id<'materialVersions'>),
          investorIds: x.investorIds as Id<'investors'>[],
          options: x.options,
          expiresInDays: x.expiresInDays,
        }),
      revoke: (linkId) => revoke({ linkId: linkId as Id<'shareLinks'> }),
      seen: (linkIds) => seen({ linkIds: linkIds as Id<'shareLinks'>[] }),
      email: (linkIds, message) => email({ linkIds: linkIds as Id<'shareLinks'>[], message }),
      fileUrl: (versionId) => convex.query(api.materials.fileUrl, { versionId: versionId as Id<'materialVersions'> }),
    }
  }, [convex, uploadUrl, create, addVersion, makeCurrent, remove, share, revoke, seen, email])
  const value = useMemo<MaterialsValue>(() => (d ? { loaded: true, ...d, act } : { ...NO_MATERIALS, act }), [d, act])
  return <MaterialsContext.Provider value={value}>{children}</MaterialsContext.Provider>
}
