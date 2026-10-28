import { useState, type ReactNode } from 'react'
import { Panel } from '../ui'

export interface LegendItem {
  label: string
  color: string
  shape?: 'rect' | 'line'
}

export interface TableView {
  columns: string[]
  rows: (string | number)[][]
}

/** Identity never rides on colour alone: a swatch beside text in ink colours. */
export function Legend({ items }: { items: LegendItem[] }): React.JSX.Element {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          {item.shape === 'line' ? (
            <span
              className="inline-block h-0.5 w-3 rounded-full"
              style={{ background: item.color }}
            />
          ) : (
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ background: item.color }}
            />
          )}
          {item.label}
        </span>
      ))}
    </div>
  )
}

export function DataTable({ table }: { table: TableView }): React.JSX.Element {
  return (
    <div className="max-h-[300px] overflow-auto rounded-lg border border-[var(--border)]">
      <table className="w-full text-sm tabular">
        <thead className="sticky top-0 bg-surface-2 text-left text-xs text-ink-2">
          <tr>
            {table.columns.map((c) => (
              <th key={c} className="px-3 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, i) => (
            <tr key={i} className="border-t border-[var(--border)]">
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-1.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Every chart has a table twin behind the toggle, so no value depends on hovering or on
// telling colours apart.
export function ChartCard({
  title,
  subtitle,
  legend,
  table,
  children,
  className = ''
}: {
  title: string
  subtitle?: string
  legend?: LegendItem[]
  table?: TableView
  children: ReactNode
  className?: string
}): React.JSX.Element {
  const [showTable, setShowTable] = useState(false)
  return (
    <Panel
      title={title}
      subtitle={subtitle}
      className={className}
      actions={
        table && (
          <div className="flex rounded-lg bg-surface-2 p-0.5 text-xs">
            {(['图表', '表格'] as const).map((label) => {
              const active = (label === '表格') === showTable
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => setShowTable(label === '表格')}
                  className={`cursor-pointer rounded-md px-2 py-0.5 ${active ? 'bg-surface font-medium text-ink shadow-sm' : 'text-ink-2'}`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        )
      }
    >
      {legend && legend.length > 1 && !showTable && <Legend items={legend} />}
      {showTable && table ? <DataTable table={table} /> : children}
    </Panel>
  )
}
