import { LoaderCircle } from 'lucide-react'
import type { ButtonHTMLAttributes, ComponentProps, ReactNode, SelectHTMLAttributes } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-ink hover:brightness-110 disabled:brightness-100',
  secondary: 'bg-surface border border-[var(--border)] text-ink hover:bg-surface-2',
  ghost: 'text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'bg-surface border border-[var(--border)] text-bad-ink hover:bg-bad-bg'
}

export function Button({
  variant = 'secondary',
  size = 'md',
  busy = false,
  icon,
  children,
  className = '',
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  busy?: boolean
  icon?: ReactNode
}): React.JSX.Element {
  const sizes = {
    sm: 'h-7 px-2.5 text-xs gap-1.5',
    md: 'h-9 px-3.5 text-sm gap-2',
    lg: 'h-11 px-5 text-base gap-2'
  }
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={`inline-flex shrink-0 cursor-pointer items-center justify-center rounded-lg font-medium whitespace-nowrap transition disabled:cursor-not-allowed disabled:opacity-50 ${sizes[size]} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {busy ? <LoaderCircle size={size === 'lg' ? 18 : 15} className="animate-spin" /> : icon}
      {children}
    </button>
  )
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = '',
  padded = true
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  padded?: boolean
}): React.JSX.Element {
  return (
    <section className={`rounded-xl border border-[var(--border)] bg-surface ${className}`}>
      {(title || actions) && (
        <header className="flex items-start justify-between gap-4 px-5 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-xs text-ink-2">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={padded ? 'p-5' : ''}>{children}</div>
    </section>
  )
}

export function PageHeader({
  title,
  description,
  actions
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}): React.JSX.Element {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}

export function Page({
  children,
  wide = false
}: {
  children: ReactNode
  wide?: boolean
}): React.JSX.Element {
  return (
    <div className={`mx-auto w-full px-8 py-8 ${wide ? 'max-w-[1240px]' : 'max-w-[1040px]'}`}>
      {children}
    </div>
  )
}

type Tone = 'neutral' | 'good' | 'warn' | 'bad' | 'info' | 'accent'

const TONES: Record<Tone, string> = {
  neutral: 'bg-surface-2 text-ink-2',
  good: 'bg-good-bg text-good-ink',
  warn: 'bg-warn-bg text-warn-ink',
  bad: 'bg-bad-bg text-bad-ink',
  info: 'bg-info-bg text-info-ink',
  accent: 'bg-accent-soft text-accent-text'
}

export function Badge({
  tone = 'neutral',
  children,
  title
}: {
  tone?: Tone
  children: ReactNode
  title?: string
}): React.JSX.Element {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}
    >
      {children}
    </span>
  )
}

export function Notice({
  tone = 'info',
  icon,
  children,
  action
}: {
  tone?: Tone
  icon?: ReactNode
  children: ReactNode
  action?: ReactNode
}): React.JSX.Element {
  return (
    <div className={`flex items-center gap-3 rounded-lg px-4 py-3 text-sm ${TONES[tone]}`}>
      {icon}
      <div className="min-w-0 flex-1">{children}</div>
      {action}
    </div>
  )
}

/** Stat tile: a sentence-case label, then the value. Proportional figures, no colon. */
export function StatTile({
  label,
  value,
  sub,
  className = ''
}: {
  label: string
  value: ReactNode
  sub?: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={`rounded-xl border border-[var(--border)] bg-surface px-4 py-3.5 ${className}`}>
      <div className="text-xs text-ink-2">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-ink">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-ink-3">{sub}</div>}
    </div>
  )
}

/** A ratio on a track that is a lighter step of the fill's own ramp. */
export function Meter({
  value,
  target,
  label
}: {
  value: number
  target?: number
  label?: string
}): React.JSX.Element {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div
      className="relative h-2 w-full rounded-full"
      style={{ background: 'var(--ord-1)', opacity: 1 }}
      aria-label={label}
      role="meter"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className="absolute inset-y-0 left-0 rounded-full"
        style={{ width: `${pct}%`, background: 'var(--ord-4)' }}
      />
      {target !== undefined && (
        <div
          className="absolute -inset-y-1 w-0.5 rounded bg-ink"
          style={{ left: `calc(${target * 100}% - 1px)` }}
          title={`目标 ${Math.round(target * 100)}%`}
        />
      )}
    </div>
  )
}

export function ProgressBar({
  value,
  tone = 'accent'
}: {
  value: number
  tone?: 'accent' | 'series'
}): React.JSX.Element {
  const pct = Math.max(0, Math.min(1, value)) * 100
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
      <div
        className="h-full rounded-full transition-[width] duration-300"
        style={{
          width: `${pct}%`,
          background: tone === 'accent' ? 'var(--accent)' : 'var(--series-1)'
        }}
      />
    </div>
  )
}

export function Spinner({ label }: { label?: string }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2 text-sm text-ink-2">
      <LoaderCircle size={16} className="animate-spin" />
      {label}
    </div>
  )
}

export function Empty({
  icon,
  title,
  children
}: {
  icon?: ReactNode
  title: string
  children?: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {icon && <div className="text-ink-3">{icon}</div>}
      <div className="text-base font-medium text-ink">{title}</div>
      {children && <div className="max-w-md text-sm text-ink-2">{children}</div>}
    </div>
  )
}

export function Kbd({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <kbd className="ml-1 rounded border border-[var(--border)] bg-surface-2 px-1 font-sans text-[11px] text-ink-3">
      {children}
    </kbd>
  )
}

// A <label>, so a click on the caption reaches the control. A field of buttons is a plain
// group instead: a label would pass every click anywhere in it on to its first button.
export function Field({
  label,
  hint,
  buttons = false,
  children
}: {
  label: string
  hint?: ReactNode
  buttons?: boolean
  children: ReactNode
}): React.JSX.Element {
  const layout = 'grid grid-cols-[180px_1fr] items-start gap-4 py-2.5'
  const content = (
    <>
      <span className="pt-2 text-sm text-ink">{label}</span>
      <span className="min-w-0">
        {children}
        {hint && <span className="mt-1 block text-xs text-ink-2">{hint}</span>}
      </span>
    </>
  )
  return buttons ? (
    <div role="group" aria-label={label} className={layout}>
      {content}
    </div>
  ) : (
    <label className={layout}>{content}</label>
  )
}

const control =
  'h-9 w-full rounded-lg border border-[var(--border)] bg-surface px-3 text-sm text-ink outline-none placeholder:text-ink-3 focus:border-accent'

// ComponentProps rather than the bare attributes, so a ref reaches the input.
export function TextInput({ className = '', ...rest }: ComponentProps<'input'>): React.JSX.Element {
  return <input className={`${control} ${className}`} {...rest} />
}

export function Select({
  className = '',
  children,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>): React.JSX.Element {
  return (
    <select className={`${control} cursor-pointer pr-8 ${className}`} {...rest}>
      {children}
    </select>
  )
}

export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange(checked: boolean): void
  label?: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={`relative mt-1.5 inline-flex h-5 w-9 cursor-pointer items-center rounded-full transition ${checked ? 'bg-accent' : 'bg-surface-3'}`}
    >
      <span
        className={`absolute h-4 w-4 rounded-full bg-white shadow transition ${checked ? 'left-[18px]' : 'left-0.5'}`}
      />
    </button>
  )
}
