import { BookOpen, BookSearch, ChartColumn, FileUp, Pause, Play, Settings, Sun } from 'lucide-react'
import { NavLink } from 'react-router-dom'
import { api } from '../lib/api'
import { useApp } from '../lib/useApp'
import { ProgressBar } from './ui'

const NAV = [
  { to: '/lookup', label: '查词', icon: BookSearch },
  { to: '/', label: '复习', icon: Sun, end: true },
  { to: '/library', label: '词库', icon: BookOpen },
  { to: '/import', label: '导入', icon: FileUp },
  { to: '/stats', label: '统计', icon: ChartColumn },
  { to: '/settings', label: '设置', icon: Settings }
]

function GenerationStatus(): React.JSX.Element | null {
  const { enrich, refreshEnrich } = useApp()
  if (!enrich) return null
  const open = enrich.pending + enrich.enriching
  const total = open + enrich.ready + enrich.failed
  if (open === 0 && !enrich.lastError) return null

  const toggle = async (): Promise<void> => {
    if (enrich.paused) await api.enrich.resume()
    else await api.enrich.pause()
    await refreshEnrich()
  }

  return (
    <div className="rounded-lg border border-[var(--border)] bg-surface p-3 text-xs">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-medium text-ink">
          {enrich.paused ? '生成已暂停' : enrich.running ? '正在生成词条' : '等待生成'}
        </span>
        {enrich.hasApiKey && open > 0 && (
          <button
            type="button"
            onClick={toggle}
            className="cursor-pointer rounded p-0.5 text-ink-2 hover:bg-surface-2 hover:text-ink"
            title={enrich.paused ? '继续' : '暂停'}
          >
            {enrich.paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
        )}
      </div>
      <ProgressBar value={total > 0 ? (enrich.ready + enrich.failed) / total : 0} />
      <div className="mt-1.5 text-ink-2">
        还剩 {open} 个 · 已完成 {enrich.ready}
        {enrich.failed > 0 && ` · 失败 ${enrich.failed}`}
      </div>
      {enrich.lastError && <div className="mt-1.5 text-bad-ink">{enrich.lastError}</div>}
    </div>
  )
}

export function Sidebar(): React.JSX.Element {
  return (
    <aside className="flex w-[200px] shrink-0 flex-col border-r border-[var(--border)] bg-surface px-3 py-5">
      <div className="mb-6 flex items-center gap-2 px-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-ink">
          W
        </div>
        <div>
          <div className="text-[15px] leading-tight font-semibold text-ink">Wordloom</div>
          <div className="text-[11px] text-ink-3">背单词 · 遗忘曲线</div>
        </div>
      </div>
      <nav className="flex flex-col gap-0.5">
        {NAV.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${
                isActive
                  ? 'bg-accent-soft font-medium text-accent-text'
                  : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
              }`
            }
          >
            <Icon size={17} />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="mt-auto">
        <GenerationStatus />
      </div>
    </aside>
  )
}
