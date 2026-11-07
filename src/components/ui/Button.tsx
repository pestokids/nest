import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export type ButtonVariant = 'primary' | 'secondary' | 'dark' | 'orange' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md' | 'lg'

/** Class list for a button-looking element (use on links too). */
export const buttonClass = ({ variant = 'secondary', size = 'md', block, className }: { variant?: ButtonVariant; size?: ButtonSize; block?: boolean; className?: string } = {}) =>
  ['btn', `btn--${variant}`, size !== 'md' && `btn--${size}`, block && 'btn--block', className].filter(Boolean).join(' ')

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows a spinner and the loading label; the button is disabled meanwhile. */
  loading?: boolean
  loadingLabel?: ReactNode
  icon?: IconName
  iconRight?: IconName
  block?: boolean
}

/** Primary, secondary, dark, orange, danger and ghost. Filled buttons sit on a 3px edge that presses down 2px. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, loadingLabel = 'Saving…', icon, iconRight, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  const iconSize = size === 'sm' ? 16 : 18
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClass({ variant, size, block, className })}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      data-loading={loading || undefined}
      {...rest}
    >
      {loading ? <span className="btn__spinner" aria-hidden="true" /> : icon ? <Icon name={icon} size={iconSize} /> : null}
      <span className="btn__label">{loading ? loadingLabel : children}</span>
      {!loading && iconRight ? <Icon name={iconRight} size={iconSize} /> : null}
    </button>
  )
})

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { icon: IconName; label: string; size?: 'sm' | 'md' }

/** Square 44px icon button (the top bar's search). `label` is required for screen readers. */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ icon, label, size = 'md', className, type = 'button', children, ...rest }, ref) {
  return (
    <button ref={ref} type={type} aria-label={label} title={label} className={['icon-btn', size === 'sm' && 'icon-btn--sm', className].filter(Boolean).join(' ')} {...rest}>
      <Icon name={icon} size={size === 'sm' ? 16 : 18} />
      {children}
    </button>
  )
})
