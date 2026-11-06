// Generated from the design handoff's illustration SVGs (flat, no outlines).
// Empty, locked and waiting states use these, never the mascot.
import type { SVGProps } from 'react'

type IlloProps = Omit<SVGProps<SVGSVGElement>, 'width' | 'height'> & { size?: number }
const svg = (w: number, h: number, { size, ...rest }: IlloProps) => ({
  viewBox: `0 0 ${w} ${h}`,
  width: size ? (size * w) / Math.max(w, h) : w,
  height: size ? (size * h) / Math.max(w, h) : h,
  'aria-hidden': true as const,
  focusable: false as const,
  ...rest,
})

export const Bell = (p: IlloProps) => (
  <svg {...svg(34, 34, p)}>
    <circle cx="17" cy="28.5" r="3.2" fill="#003F2E"/><path d="M17 4 C23 4 26.5 8.5 26.5 14.5 V19.5 C26.5 21.5 28 23 29.5 24 C30.3 24.6 29.9 26 28.9 26 H5.1 C4.1 26 3.7 24.6 4.5 24 C6 23 7.5 21.5 7.5 19.5 V14.5 C7.5 8.5 11 4 17 4 Z" fill="#FF6420"/><path d="M21.5 6 C24.8 7.6 26.5 10.8 26.5 14.5 V19.5 C26.5 21.5 28 23 29.5 24 C30.3 24.6 29.9 26 28.9 26 H20 C23.5 22 24.5 13 21.5 6 Z" fill="#E5531A"/><ellipse cx="12.5" cy="12" rx="1.8" ry="3.4" transform="rotate(18 12.5 12)" fill="#FF9437"/><rect x="15" y="1.5" width="4" height="4" rx="2" fill="#FF6420"/>
  </svg>
)

export const EggCracking = (p: IlloProps) => (
  <svg {...svg(52, 64, p)}>
    <path d="M26 5 C38.4 5 46.0 23.48 46.0 38.6 C46.0 53.16 37.2 61 26 61 C14.799 61 6.0 53.16 6.0 38.6 C6.0 23.48 13.6 5 26 5 Z" fill="#FFF6DE"/>
    <path d="M37.0 13.96 C43.0 21.8 46.0 30.2 46.0 38.6 C46.0 53.16 37.2 61 26 61 C16.0 61 10.0 55.4 7.0 47.56 C20.0 56.519 41.0 47.0 37.0 13.96 Z" fill="#F0DDAE"/>
    <ellipse cx="18.0" cy="21.8" rx="3.2" ry="6.2" transform="rotate(-18 18.0 21.8)" fill="#FFFFFF"/>
    <circle cx="30.8" cy="28.5" r="1.8" fill="#DCC48C"/>
    <circle cx="35.6" cy="38.6" r="1.2" fill="#DCC48C"/>
    <circle cx="22.0" cy="44.2" r="1.4" fill="#DCC48C"/>
    <circle cx="26.8" cy="18.4" r="1.0" fill="#DCC48C"/>
    <path d="M9 31 L16 25 L21 32 L27 24 L33 31 L38 26 L43 30" fill="none" stroke="#003F2E" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M5 9 L9 13" stroke="#003F2E" strokeWidth="2.4" strokeLinecap="round"/><path d="M3 17 L7 18" stroke="#003F2E" strokeWidth="2.4" strokeLinecap="round"/><path d="M47 9 L43 13" stroke="#003F2E" strokeWidth="2.4" strokeLinecap="round"/><path d="M49 17 L45 18" stroke="#003F2E" strokeWidth="2.4" strokeLinecap="round"/>
  </svg>
)

export const EggHatching = (p: IlloProps) => (
  <svg {...svg(52, 64, p)}>
    <path d="M22.4 19.299 C18.5 10.2 26.3 8.25 28.25 15.4 C30.85 10.849 36.05 13.45 32.15 20.6 Z" fill="#A9EC19"/>
    <circle cx="25" cy="31" r="13" fill="#A9EC19"/>
    <path d="M27.6 43.35 C34.75 40.75 38 34.9 38 31 C38 38.8 32.8 44 27.6 43.35 Z" fill="#86C20F"/>
    <circle cx="22.7" cy="29.1" r="5.5" fill="#FFFBEB"/>
    <circle cx="23.7" cy="29.6" r="3.5" fill="#003F2E"/>
    <circle cx="24.6" cy="28.3" r="1.2" fill="#FFFFFF"/>
    <path d="M29.94 28.4 C37.09 27.36 40.34 33.21 36.44 39.71 C33.84 35.81 30.59 35.16 28.64 34.51 Z" fill="#FF6420"/>
    <path d="M31.5 29.18 C35.4 28.92 37.74 31.52 37.48 35.16 C35.79 32.3 33.84 30.61 31.5 29.18 Z" fill="#FF9437"/>
    <path d="M5.0 38 L12.139 33 L19.07 39 L26 33 L32.93 39 L39.86 33 L47.0 38 C47.0 54.16 37.76 62 26 62 C14.239 62 5.0 54.16 5.0 38 Z" fill="#FFF6DE"/>
    <path d="M47.0 38 C47.0 54.16 37.76 62 26 62 C15.5 62 9.2 56.4 6.05 48.56 C19.7 57.519 42.8 50.8 39.86 35 Z" fill="#F0DDAE"/>
    <circle cx="18" cy="52" r="1.6" fill="#DCC48C"/><circle cx="30" cy="56" r="1.3" fill="#DCC48C"/>
    <g transform="rotate(18 34 10)"><path d="M20 15 C20 6 26 0 33 0 C40 0 46 6 46 15 L42 12 L38 16 L33 11 L28 16 L24 12 Z" fill="#FFF6DE"/><path d="M40 2 C44 5 46 9 46 15 L42 12 L38 16 L36 13 C41 10 42 6 40 2 Z" fill="#F0DDAE"/></g>
  </svg>
)

export const Egg = (p: IlloProps) => (
  <svg {...svg(52, 64, p)}>
    <path d="M26 3 C39.64 3 48.0 22.14 48.0 37.8 C48.0 52.879 38.32 61 26 61 C13.68 61 4.0 52.879 4.0 37.8 C4.0 22.14 12.36 3 26 3 Z" fill="#FFF6DE"/>
    <path d="M38.1 12.28 C44.7 20.4 48.0 29.1 48.0 37.8 C48.0 52.879 38.32 61 26 61 C15.0 61 8.399 55.2 5.1 47.08 C19.4 56.36 42.5 46.5 38.1 12.28 Z" fill="#F0DDAE"/>
    <ellipse cx="17.2" cy="20.4" rx="3.5" ry="6.4" transform="rotate(-18 17.2 20.4)" fill="#FFFFFF"/>
    <circle cx="31.3" cy="27.4" r="2.0" fill="#DCC48C"/>
    <circle cx="36.6" cy="37.8" r="1.3" fill="#DCC48C"/>
    <circle cx="21.6" cy="43.6" r="1.5" fill="#DCC48C"/>
    <circle cx="26.9" cy="16.9" r="1.1" fill="#DCC48C"/>
  </svg>
)

export const LockedNest = (p: IlloProps) => (
  <svg {...svg(190, 180, p)}>
    <circle cx="95" cy="92" r="86" fill="#0A5540"/>
    <g transform="translate(23 30) scale(1.5)">
    <ellipse cx="48" cy="56" rx="42" ry="11" fill="#7A4A22"/>
    <path d="M37 39 C43.82 39 48.0 48.24 48.0 55.8 C48.0 63.08 43.16 67 37 67 C30.84 67 26.0 63.08 26.0 55.8 C26.0 48.24 30.18 39 37 39 Z" fill="#FFF6DE"/>
    <path d="M43.05 43.48 C46.35 47.4 48.0 51.6 48.0 55.8 C48.0 63.08 43.16 67 37 67 C31.5 67 28.2 64.2 26.55 60.28 C33.7 64.76 45.25 60.0 43.05 43.48 Z" fill="#F0DDAE"/>
    <ellipse cx="32.6" cy="47.4" rx="1.8" ry="3.1" transform="rotate(-18 32.6 47.4)" fill="#FFFFFF"/>
    <circle cx="39.6" cy="50.8" r="1.0" fill="#DCC48C"/>
    <circle cx="42.3" cy="55.8" r="0.7" fill="#DCC48C"/>
    <circle cx="34.8" cy="58.6" r="0.8" fill="#DCC48C"/>
    <circle cx="37.4" cy="45.7" r="0.6" fill="#DCC48C"/>
    <path d="M59 38 C65.82 38 70.0 47.24 70.0 54.8 C70.0 62.08 65.16 66 59 66 C52.84 66 48.0 62.08 48.0 54.8 C48.0 47.24 52.18 38 59 38 Z" fill="#FFF6DE"/>
    <path d="M65.05 42.48 C68.35 46.4 70.0 50.6 70.0 54.8 C70.0 62.08 65.16 66 59 66 C53.5 66 50.2 63.2 48.55 59.28 C55.7 63.76 67.25 59.0 65.05 42.48 Z" fill="#F0DDAE"/>
    <ellipse cx="54.6" cy="46.4" rx="1.8" ry="3.1" transform="rotate(-18 54.6 46.4)" fill="#FFFFFF"/>
    <circle cx="61.6" cy="49.8" r="1.0" fill="#DCC48C"/>
    <circle cx="64.3" cy="54.8" r="0.7" fill="#DCC48C"/>
    <circle cx="56.8" cy="57.6" r="0.8" fill="#DCC48C"/>
    <circle cx="59.4" cy="44.7" r="0.6" fill="#DCC48C"/>
    <path d="M6 56 C8 72 29.099 80 48 80 C66.9 80 88 72 90 56 C80 64 64.8 66 48 66 C31.2 66 16 64 6 56 Z" fill="#C58B4A"/>
    <path d="M12.703 68.32 C30.351 74.32 65.648 74.32 83.296 68.32 C65.648 77.32 30.351 77.32 12.703 68.32 Z" fill="#9E6630"/>
    <path d="M17.642 72.24 C32.821 78.24 63.178 78.24 78.357 72.24 C63.178 81.24 32.821 81.24 17.642 72.24 Z" fill="#9E6630"/>
    <path d="M6 56 C16 64 31.2 66 48 66 C64.8 66 80 64 90 56 C82 69 64.8 71 48 71 C31.2 71 14 69 6 56 Z" fill="#E0AA68"/>
    <rect x="1" y="52" width="14" height="4" rx="2" transform="rotate(-22 8 54)" fill="#9E6630"/>
    <rect x="81" y="53" width="14" height="4" rx="2" transform="rotate(20 88 55)" fill="#9E6630"/>
    <rect x="62" y="74" width="12" height="3.5" rx="1.75" transform="rotate(-12 68 76)" fill="#7A4A22"/>
    </g>
    <path d="M81 48 V36 C81 27 87 21 95 21 C103 21 109 27 109 36 V48" fill="none" stroke="#FFFBEB" strokeWidth="8" strokeLinecap="round"/>
    <rect x="70" y="44" width="50" height="38" rx="10" fill="#FF6420"/>
    <rect x="70" y="44" width="50" height="8" rx="4" fill="#FF9437"/>
    <circle cx="95" cy="61" r="5.5" fill="#003F2E"/><rect x="92.5" y="63" width="5" height="11" rx="2.5" fill="#003F2E"/>
  </svg>
)

export const Mug = (p: IlloProps) => (
  <svg {...svg(64, 84, p)}>
    <g className="steam"><path d="M22 4 C16 10 28 14 22 22" fill="none" stroke="#A9EC19" strokeWidth="3" strokeLinecap="round"/><path d="M34 0 C28 7 40 11 34 20" fill="none" stroke="#A9EC19" strokeWidth="3" strokeLinecap="round" opacity=".7"/></g><path d="M46 30 h6 a10 10 0 0 1 0 22 h-6" fill="none" stroke="#FFF6DE" strokeWidth="6"/><path d="M6 28 H48 V70 C48 77 43 82 36 82 H18 C11 82 6 77 6 70 Z" fill="#FFF6DE"/><rect x="6" y="44" width="42" height="10" fill="#FF6420"/>
  </svg>
)

export const NestEmpty = (p: IlloProps) => (
  <svg {...svg(96, 84, p)}>
    <ellipse cx="48" cy="56" rx="42" ry="11" fill="#7A4A22"/>
    <g transform="rotate(-28 50 46)"><path d="M50 30 C58 36 60 48 52 60 C44 50 43 38 50 30 Z" fill="#A9EC19"/><path d="M50 30 C58 36 60 48 52 60 C55 48 54 38 50 30 Z" fill="#86C20F"/><path d="M50.5 34 L52 64" stroke="#0A5540" strokeWidth="1.6" strokeLinecap="round"/></g>
    <path d="M6 56 C8 72 29.099 80 48 80 C66.9 80 88 72 90 56 C80 64 64.8 66 48 66 C31.2 66 16 64 6 56 Z" fill="#C58B4A"/>
    <path d="M12.703 68.32 C30.351 74.32 65.648 74.32 83.296 68.32 C65.648 77.32 30.351 77.32 12.703 68.32 Z" fill="#9E6630"/>
    <path d="M17.642 72.24 C32.821 78.24 63.178 78.24 78.357 72.24 C63.178 81.24 32.821 81.24 17.642 72.24 Z" fill="#9E6630"/>
    <path d="M6 56 C16 64 31.2 66 48 66 C64.8 66 80 64 90 56 C82 69 64.8 71 48 71 C31.2 71 14 69 6 56 Z" fill="#E0AA68"/>
    <rect x="1" y="52" width="14" height="4" rx="2" transform="rotate(-22 8 54)" fill="#9E6630"/>
    <rect x="81" y="53" width="14" height="4" rx="2" transform="rotate(20 88 55)" fill="#9E6630"/>
    <rect x="62" y="74" width="12" height="3.5" rx="1.75" transform="rotate(-12 68 76)" fill="#7A4A22"/>
  </svg>
)

export const NestOffline = (p: IlloProps) => (
  <svg {...svg(96, 84, p)}>
    <ellipse cx="48" cy="56" rx="42" ry="11" fill="#7A4A22"/>
    <path d="M44 37 C51.75 37 56.5 47.56 56.5 56.2 C56.5 64.52 51.0 69 44 69 C37.0 69 31.5 64.52 31.5 56.2 C31.5 47.56 36.25 37 44 37 Z" fill="#FFF6DE"/>
    <path d="M50.875 42.12 C54.625 46.6 56.5 51.4 56.5 56.2 C56.5 64.52 51.0 69 44 69 C37.75 69 34.0 65.8 32.125 61.32 C40.25 66.44 53.375 61.0 50.875 42.12 Z" fill="#F0DDAE"/>
    <ellipse cx="39.0" cy="46.6" rx="2.0" ry="3.5" transform="rotate(-18 39.0 46.6)" fill="#FFFFFF"/>
    <circle cx="47.0" cy="50.4" r="1.1" fill="#DCC48C"/>
    <circle cx="50.0" cy="56.2" r="0.8" fill="#DCC48C"/>
    <circle cx="41.5" cy="59.4" r="0.9" fill="#DCC48C"/>
    <circle cx="44.5" cy="44.7" r="0.6" fill="#DCC48C"/>
    <path d="M6 56 C8 72 29.099 80 48 80 C66.9 80 88 72 90 56 C80 64 64.8 66 48 66 C31.2 66 16 64 6 56 Z" fill="#C58B4A"/>
    <path d="M12.703 68.32 C30.351 74.32 65.648 74.32 83.296 68.32 C65.648 77.32 30.351 77.32 12.703 68.32 Z" fill="#9E6630"/>
    <path d="M17.642 72.24 C32.821 78.24 63.178 78.24 78.357 72.24 C63.178 81.24 32.821 81.24 17.642 72.24 Z" fill="#9E6630"/>
    <path d="M6 56 C16 64 31.2 66 48 66 C64.8 66 80 64 90 56 C82 69 64.8 71 48 71 C31.2 71 14 69 6 56 Z" fill="#E0AA68"/>
    <rect x="1" y="52" width="14" height="4" rx="2" transform="rotate(-22 8 54)" fill="#9E6630"/>
    <rect x="81" y="53" width="14" height="4" rx="2" transform="rotate(20 88 55)" fill="#9E6630"/>
    <rect x="62" y="74" width="12" height="3.5" rx="1.75" transform="rotate(-12 68 76)" fill="#7A4A22"/>
    <path d="M62 31 C58 31 56 28 56 25 C56 21 59 18 63 18 C64 13 68 10 73 10 C79 10 83 14 83 19 C87 19 90 22 90 25 C90 28 87 31 84 31 Z" fill="#D3DCCC"/><path d="M64 27 L82 14" stroke="#FF6420" strokeWidth="2.6" strokeLinecap="round"/>
  </svg>
)

export const NestSleeping = (p: IlloProps) => (
  <svg {...svg(96, 84, p)}>
    <ellipse cx="48" cy="56" rx="42" ry="11" fill="#7A4A22"/>
    <path d="M48 35 C56.06 35 61.0 45.89 61.0 54.8 C61.0 63.38 55.28 68 48 68 C40.72 68 35.0 63.38 35.0 54.8 C35.0 45.89 39.94 35 48 35 Z" fill="#FFF6DE"/>
    <path d="M55.15 40.28 C59.05 44.9 61.0 49.85 61.0 54.8 C61.0 63.38 55.28 68 48 68 C41.5 68 37.6 64.7 35.65 60.08 C44.1 65.36 57.75 59.75 55.15 40.28 Z" fill="#F0DDAE"/>
    <ellipse cx="42.8" cy="44.9" rx="2.1" ry="3.6" transform="rotate(-18 42.8 44.9)" fill="#FFFFFF"/>
    <circle cx="51.1" cy="48.9" r="1.2" fill="#DCC48C"/>
    <circle cx="54.2" cy="54.8" r="0.8" fill="#DCC48C"/>
    <circle cx="45.4" cy="58.1" r="0.9" fill="#DCC48C"/>
    <circle cx="48.5" cy="42.9" r="0.7" fill="#DCC48C"/>
    <path d="M6 56 C8 72 29.099 80 48 80 C66.9 80 88 72 90 56 C80 64 64.8 66 48 66 C31.2 66 16 64 6 56 Z" fill="#C58B4A"/>
    <path d="M12.703 68.32 C30.351 74.32 65.648 74.32 83.296 68.32 C65.648 77.32 30.351 77.32 12.703 68.32 Z" fill="#9E6630"/>
    <path d="M17.642 72.24 C32.821 78.24 63.178 78.24 78.357 72.24 C63.178 81.24 32.821 81.24 17.642 72.24 Z" fill="#9E6630"/>
    <path d="M6 56 C16 64 31.2 66 48 66 C64.8 66 80 64 90 56 C82 69 64.8 71 48 71 C31.2 71 14 69 6 56 Z" fill="#E0AA68"/>
    <rect x="1" y="52" width="14" height="4" rx="2" transform="rotate(-22 8 54)" fill="#9E6630"/>
    <rect x="81" y="53" width="14" height="4" rx="2" transform="rotate(20 88 55)" fill="#9E6630"/>
    <rect x="62" y="74" width="12" height="3.5" rx="1.75" transform="rotate(-12 68 76)" fill="#7A4A22"/>
    <path d="M68 20 H76 L68 28 H76" fill="none" stroke="#0A5540" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M80 9 H86 L80 15 H86" fill="none" stroke="#0A5540" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

export const NestWithEggs = (p: IlloProps) => (
  <svg {...svg(96, 84, p)}>
    <ellipse cx="48" cy="56" rx="42" ry="11" fill="#7A4A22"/>
    <path d="M35 39 C41.82 39 46.0 48.24 46.0 55.8 C46.0 63.08 41.16 67 35 67 C28.84 67 24.0 63.08 24.0 55.8 C24.0 48.24 28.18 39 35 39 Z" fill="#FFF6DE"/>
    <path d="M41.05 43.48 C44.35 47.4 46.0 51.6 46.0 55.8 C46.0 63.08 41.16 67 35 67 C29.5 67 26.2 64.2 24.55 60.28 C31.7 64.76 43.25 60.0 41.05 43.48 Z" fill="#F0DDAE"/>
    <ellipse cx="30.6" cy="47.4" rx="1.8" ry="3.1" transform="rotate(-18 30.6 47.4)" fill="#FFFFFF"/>
    <circle cx="37.6" cy="50.8" r="1.0" fill="#DCC48C"/>
    <circle cx="40.3" cy="55.8" r="0.7" fill="#DCC48C"/>
    <circle cx="32.8" cy="58.6" r="0.8" fill="#DCC48C"/>
    <circle cx="35.4" cy="45.7" r="0.6" fill="#DCC48C"/>
    <path d="M61 38 C67.82 38 72.0 47.24 72.0 54.8 C72.0 62.08 67.16 66 61 66 C54.84 66 50.0 62.08 50.0 54.8 C50.0 47.24 54.18 38 61 38 Z" fill="#FFF6DE"/>
    <path d="M67.05 42.48 C70.35 46.4 72.0 50.6 72.0 54.8 C72.0 62.08 67.16 66 61 66 C55.5 66 52.2 63.2 50.55 59.28 C57.7 63.76 69.25 59.0 67.05 42.48 Z" fill="#F0DDAE"/>
    <ellipse cx="56.6" cy="46.4" rx="1.8" ry="3.1" transform="rotate(-18 56.6 46.4)" fill="#FFFFFF"/>
    <circle cx="63.6" cy="49.8" r="1.0" fill="#DCC48C"/>
    <circle cx="66.3" cy="54.8" r="0.7" fill="#DCC48C"/>
    <circle cx="58.8" cy="57.6" r="0.8" fill="#DCC48C"/>
    <circle cx="61.4" cy="44.7" r="0.6" fill="#DCC48C"/>
    <path d="M48 43 C55.13 43 59.5 52.57 59.5 60.4 C59.5 67.94 54.44 72 48 72 C41.56 72 36.5 67.94 36.5 60.4 C36.5 52.57 40.87 43 48 43 Z" fill="#FFF6DE"/>
    <path d="M54.325 47.64 C57.775 51.7 59.5 56.05 59.5 60.4 C59.5 67.94 54.44 72 48 72 C42.25 72 38.8 69.1 37.075 65.04 C44.55 69.68 56.625 64.75 54.325 47.64 Z" fill="#F0DDAE"/>
    <ellipse cx="43.4" cy="51.7" rx="1.8" ry="3.2" transform="rotate(-18 43.4 51.7)" fill="#FFFFFF"/>
    <circle cx="50.8" cy="55.2" r="1.0" fill="#DCC48C"/>
    <circle cx="53.5" cy="60.4" r="0.7" fill="#DCC48C"/>
    <circle cx="45.7" cy="63.3" r="0.8" fill="#DCC48C"/>
    <circle cx="48.5" cy="50.0" r="0.6" fill="#DCC48C"/>
    <path d="M6 56 C8 72 29.099 80 48 80 C66.9 80 88 72 90 56 C80 64 64.8 66 48 66 C31.2 66 16 64 6 56 Z" fill="#C58B4A"/>
    <path d="M12.703 68.32 C30.351 74.32 65.648 74.32 83.296 68.32 C65.648 77.32 30.351 77.32 12.703 68.32 Z" fill="#9E6630"/>
    <path d="M17.642 72.24 C32.821 78.24 63.178 78.24 78.357 72.24 C63.178 81.24 32.821 81.24 17.642 72.24 Z" fill="#9E6630"/>
    <path d="M6 56 C16 64 31.2 66 48 66 C64.8 66 80 64 90 56 C82 69 64.8 71 48 71 C31.2 71 14 69 6 56 Z" fill="#E0AA68"/>
    <rect x="1" y="52" width="14" height="4" rx="2" transform="rotate(-22 8 54)" fill="#9E6630"/>
    <rect x="81" y="53" width="14" height="4" rx="2" transform="rotate(20 88 55)" fill="#9E6630"/>
    <rect x="62" y="74" width="12" height="3.5" rx="1.75" transform="rotate(-12 68 76)" fill="#7A4A22"/>
  </svg>
)
