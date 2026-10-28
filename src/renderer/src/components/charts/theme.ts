import { useEffect, useState } from 'react'

export interface ChartColors {
  surface: string
  ink: string
  ink2: string
  ink3: string
  line: string
  axis: string
  border: string
  series: [string, string, string]
  ord: [string, string, string, string]
  wash: string
}

function readColors(): ChartColors {
  const css = getComputedStyle(document.documentElement)
  const v = (name: string): string => css.getPropertyValue(name).trim()
  return {
    surface: v('--surface'),
    ink: v('--ink'),
    ink2: v('--ink-2'),
    ink3: v('--ink-3'),
    line: v('--line'),
    axis: v('--axis'),
    border: v('--border'),
    series: [v('--series-1'), v('--series-2'), v('--series-3')],
    ord: [v('--ord-1'), v('--ord-2'), v('--ord-3'), v('--ord-4')],
    wash: v('--area-wash')
  }
}

/** Chart colours resolved from the CSS tokens, re-read when the system theme flips. */
export function useChartColors(): ChartColors {
  const [colors, setColors] = useState(readColors)
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => setColors(readColors())
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])
  return colors
}

export const CHART_FONT = "system-ui, -apple-system, 'Segoe UI', 'Microsoft YaHei UI', sans-serif"

/** Recessive chrome: hairline solid grid, muted labels, no ticks. */
export function axisStyle(c: ChartColors, opts: { grid?: boolean } = {}): Record<string, unknown> {
  return {
    axisLine: { lineStyle: { color: c.axis, width: 1 } },
    axisTick: { show: false },
    axisLabel: { color: c.ink3, fontSize: 11, fontFamily: CHART_FONT },
    splitLine: {
      show: opts.grid ?? false,
      lineStyle: { color: c.line, width: 1, type: 'solid' }
    }
  }
}

export function tooltipStyle(c: ChartColors): Record<string, unknown> {
  return {
    backgroundColor: c.surface,
    borderColor: c.border,
    borderWidth: 1,
    padding: [8, 10],
    textStyle: { color: c.ink, fontSize: 12, fontFamily: CHART_FONT },
    extraCssText: 'box-shadow: 0 6px 20px rgba(0,0,0,0.14); border-radius: 8px;'
  }
}

/** One tooltip row: a short stroke of the series colour, the value strong, the name after it. */
export function tooltipRow(color: string, value: string, name: string): string {
  return `<div style="display:flex;align-items:center;gap:8px;margin-top:3px"><span style="display:inline-block;width:12px;height:2px;border-radius:1px;background:${color}"></span><b style="font-weight:600">${value}</b><span style="opacity:.7">${name}</span></div>`
}
