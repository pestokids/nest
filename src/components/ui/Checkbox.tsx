import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { Icon } from './Icon'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label?: ReactNode }

/** 22px checkbox; the tick draws in (240ms). */
export const Checkbox = forwardRef<HTMLInputElement, Props>(function Checkbox({ label, className, ...rest }, ref) {
  return (
    <label className={['checkbox', className].filter(Boolean).join(' ')}>
      <span className="checkbox__box">
        <input ref={ref} type="checkbox" {...rest} />
        <span className="checkbox__mark" aria-hidden="true">
          <Icon name="check" size={16} strokeWidth={2.6} />
        </span>
      </span>
      {label ? <span className="checkbox__label">{label}</span> : null}
    </label>
  )
})

/** 40 × 24 switch (role="switch"). */
export const Toggle = forwardRef<HTMLInputElement, Props>(function Toggle({ label, className, ...rest }, ref) {
  return (
    <label className={['toggle', className].filter(Boolean).join(' ')}>
      {label ? <span className="toggle__label">{label}</span> : null}
      <input ref={ref} type="checkbox" role="switch" {...rest} />
      <span className="toggle__track" aria-hidden="true">
        <span className="toggle__thumb" />
      </span>
    </label>
  )
})
