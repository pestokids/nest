import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { formatDay } from '../../lib/dates'
import { Icon } from './Icon'

type FieldBits = { label?: ReactNode; help?: ReactNode; error?: ReactNode; className?: string }

function Field({ id, label, help, error, className, children }: FieldBits & { id: string; children: ReactNode }) {
  return (
    <div className={['field', error ? 'field--error' : '', className].filter(Boolean).join(' ')}>
      {label ? (
        <label className="field__label" htmlFor={id}>
          {label}
        </label>
      ) : null}
      {children}
      {error ? (
        <span className="field__error" id={`${id}-msg`} role="alert">
          {error}
        </span>
      ) : help ? (
        <span className="field__help" id={`${id}-msg`}>
          {help}
        </span>
      ) : null}
    </div>
  )
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & FieldBits

/** Text input with label, help and error (red border, alert icon, message). */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, help, error, className, id, ...rest }, ref) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <Field id={fid} label={label} help={help} error={error} className={className}>
      <span className={rest.type === 'date' ? 'input input--date' : 'input'}>
        <input
          ref={ref}
          id={fid}
          aria-invalid={error ? true : undefined}
          aria-describedby={error || help ? `${fid}-msg` : undefined}
          {...rest}
          onClick={
            rest.type === 'date'
              ? (e) => {
                  rest.onClick?.(e)
                  try {
                    e.currentTarget.showPicker?.()
                  } catch {
                    /* not allowed here; the native control still opens */
                  }
                }
              : rest.onClick
          }
        />
        {rest.type === 'date' ? (
          <>
            {/* Dates read like the design ("Thu 12 Nov"); the native picker sits underneath. */}
            <span className={`input__date${rest.value ? '' : ' input__date--empty'}`} aria-hidden="true">
              {typeof rest.value === 'string' && rest.value ? formatDay(rest.value) : 'Pick a date'}
            </span>
            {error ? null : <Icon name="chevron-down" size={18} className="select__chevron" />}
          </>
        ) : null}
        {error ? <Icon name="alert" size={18} className="input__alert" /> : null}
      </span>
    </Field>
  )
})

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & FieldBits

/** Native select styled like the design's closed select, with a chevron. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, help, error, className, id, children, ...rest }, ref) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <Field id={fid} label={label} help={help} error={error} className={className}>
      <span className="select">
        <select ref={ref} id={fid} aria-invalid={error ? true : undefined} aria-describedby={error || help ? `${fid}-msg` : undefined} {...rest}>
          {children}
        </select>
        <Icon name="chevron-down" size={18} className="select__chevron" />
      </span>
    </Field>
  )
})

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & FieldBits

/** Multi-line text with the same label, help and error as Input. */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, help, error, className, id, ...rest }, ref) {
  const auto = useId()
  const fid = id ?? auto
  return (
    <Field id={fid} label={label} help={help} error={error} className={className}>
      <textarea ref={ref} id={fid} className="textarea" aria-invalid={error ? true : undefined} aria-describedby={error || help ? `${fid}-msg` : undefined} {...rest} />
    </Field>
  )
})
