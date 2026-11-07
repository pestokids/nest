import { useEffect, useState, type InputHTMLAttributes } from 'react'
import { formatAmount, parseAmount } from '../../lib/settingsForm'

type Base = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'>

/** A number field that keeps what you type; reports NaN while it isn't a number, undefined when empty. */
export function NumberInput({ value, onChange, ...rest }: Base & { value: number | undefined; onChange: (n: number | undefined) => void }) {
  const [s, setS] = useState(value === undefined || Number.isNaN(value) ? '' : String(value))
  useEffect(() => {
    setS((cur) => (Number(cur) === value || (cur === '' && value === undefined) || (Number.isNaN(value) && cur !== '') ? cur : value === undefined ? '' : String(value)))
  }, [value])
  return (
    <input
      type="text"
      inputMode="decimal"
      value={s}
      onChange={(e) => {
        setS(e.target.value)
        const t = e.target.value.trim()
        onChange(t === '' ? undefined : Number(t))
      }}
      {...rest}
    />
  )
}

/** Dollars as "$2,000,000"; accepts "2m", "250k", "$10M post". Formats when you leave the field. */
export function AmountInput({ value, onChange, onBlur, ...rest }: Base & { value: number | undefined; onChange: (n: number | undefined) => void }) {
  const [s, setS] = useState(formatAmount(value))
  const [focused, setFocused] = useState(false)
  useEffect(() => {
    if (!focused) setS(Number.isNaN(value) ? (cur) => cur : formatAmount(value))
  }, [value, focused])
  return (
    <input
      type="text"
      inputMode="decimal"
      autoComplete="off"
      value={s}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        setS(e.target.value)
        onChange(parseAmount(e.target.value))
      }}
      onBlur={(e) => {
        setFocused(false)
        const n = parseAmount(s)
        if (n !== undefined && Number.isFinite(n)) setS(formatAmount(n))
        onBlur?.(e)
      }}
      {...rest}
    />
  )
}
