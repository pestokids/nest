// pdf.js, loaded only when a PDF is read: the public viewer, and counting pages on upload.
import type { PDFDocumentProxy } from 'pdfjs-dist'

type PdfJs = typeof import('pdfjs-dist')
let lib: Promise<PdfJs> | null = null

export function loadPdfjs(): Promise<PdfJs> {
  lib ??= Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([pdfjs, worker]) => {
    pdfjs.GlobalWorkerOptions.workerSrc = worker.default
    return pdfjs
  })
  return lib
}

export async function openPdf(src: { url: string } | { data: Uint8Array }): Promise<PDFDocumentProxy> {
  const pdfjs = await loadPdfjs()
  return pdfjs.getDocument({ ...src, disableRange: true }).promise
}

/** Pages in a PDF, or null when it can't be read (then it isn't a PDF we can show). */
export async function countPages(file: Blob): Promise<number | null> {
  try {
    const doc = await openPdf({ data: new Uint8Array(await file.arrayBuffer()) })
    const n = doc.numPages
    void doc.loadingTask.destroy()
    return n
  } catch {
    return null
  }
}
