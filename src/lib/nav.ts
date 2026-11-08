// The top bar's sections (PST-289). Growth, Families, Hiring and Ops & Legal are
// hidden until each has real content; drop `hidden` to bring one back.
export type Section = { to: string; label: string; live?: boolean; exact?: boolean; hidden?: boolean }

export const SECTIONS: Section[] = [
  { to: '/', label: 'Home', exact: true },
  { to: '/raise', label: 'Raise', live: true },
  { to: '', label: 'Growth', hidden: true },
  { to: '', label: 'Families', hidden: true },
  { to: '', label: 'Hiring', hidden: true },
  { to: '', label: 'Ops & Legal', hidden: true },
]

/** What the top bar (and the phones' avatar menu) shows. */
export const shownSections = (all: readonly Section[] = SECTIONS) => all.filter((s) => !s.hidden)
