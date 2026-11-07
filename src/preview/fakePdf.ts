// DEV/preview only: a made-up PDF built in the browser, so the preview can show
// real pages (the viewer, reading an old version) without shipping a document.
const esc = (s: string) => s.replace(/[\\()]/g, (c) => '\\' + c)

/** A `pages`-page 16:9 PDF: a cream page with a title and "Page k of n". ASCII only. */
export function fakePdf(title: string, pages: number): Blob {
  const objs: string[] = []
  const font = 3 + pages * 2
  const kids = Array.from({ length: pages }, (_, k) => `${3 + k * 2} 0 R`).join(' ')
  objs.push('<< /Type /Catalog /Pages 2 0 R >>')
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages} >>`)
  for (let k = 0; k < pages; k++) {
    const heading = k === 0 ? title : ['Problem', 'Solution', 'Product', 'Market', 'Traction', 'Business model', 'Team', 'Competition', 'Go to market', 'Retention', 'Use of funds', 'The ask', 'Thank you'][(k - 1) % 13]
    const body = [
      '0.96 0.95 0.91 rg 0 0 960 540 re f',
      '0 0.25 0.18 rg 0 500 960 40 re f',
      '0.66 0.93 0.1 rg 60 120 ' + (120 + ((k * 97) % 600)) + ' 16 re f',
      `BT /F1 18 Tf 1 1 0.92 rg 60 513 Td (Pesto - made-up preview) Tj ET`,
      `BT /F1 54 Tf 0 0.25 0.18 rg 60 330 Td (${esc(heading)}) Tj ET`,
      `BT /F1 22 Tf 0.31 0.4 0.34 rg 60 270 Td (Placeholder slide for the preview. Not a real document.) Tj ET`,
      `BT /F1 16 Tf 0.31 0.4 0.34 rg 820 40 Td (Page ${k + 1} of ${pages}) Tj ET`,
    ].join('\n')
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Contents ${4 + k * 2} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`)
    objs.push(`<< /Length ${body.length} >>\nstream\n${body}\nendstream`)
  }
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, k) => {
    offsets.push(out.length)
    out += `${k + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((n) => `${String(n).padStart(10, '0')} 00000 n \n`).join('')
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Blob([out], { type: 'application/pdf' })
}
