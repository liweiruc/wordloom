import { useMemo } from 'react'
import type { CurveData, DailyStat, Dashboard, Grade } from '../../../../shared/types'
import { GRADE_LABEL } from '../../../../shared/types'
import { compact, formatDateTime, percent } from '../../lib/format'
import { ChartCard, Legend, type LegendItem } from './ChartCard'
import { EChart } from './EChart'
import {
  axisStyle,
  CHART_FONT,
  tooltipRow,
  tooltipStyle,
  useChartColors,
  type ChartColors
} from './theme'

const mmdd = (date: string): string => date.slice(5).replace('-', '/')

function labelEvery(n: number, target = 7): number {
  return Math.max(0, Math.ceil(n / target) - 1)
}

/** Column bars: capped thickness, 4px rounded data end, square at the baseline. */
function columnSeries(name: string, color: string, data: number[]): Record<string, unknown> {
  return {
    name,
    type: 'bar',
    data,
    barMaxWidth: 24,
    itemStyle: { color, borderRadius: [4, 4, 0, 0] },
    emphasis: { itemStyle: { color, opacity: 0.85 } }
  }
}

function barAxisTooltip(
  c: ChartColors,
  format: (index: number) => string
): Record<string, unknown> {
  return {
    ...tooltipStyle(c),
    trigger: 'axis',
    axisPointer: { type: 'shadow', shadowStyle: { color: c.line, opacity: 0.45 } },
    formatter: (params: { dataIndex: number }[]) => format(params[0]?.dataIndex ?? 0)
  }
}

// ---------- daily activity: reviews, new cards and learning steps, stacked ----------

export function DailyActivityChart({ daily }: { daily: DailyStat[] }): React.JSX.Element {
  const c = useChartColors()
  const series = useMemo(
    () => [
      { name: '复习', color: c.series[0], values: daily.map((d) => d.review) },
      { name: '新卡', color: c.series[1], values: daily.map((d) => d.newCards) },
      { name: '学习步骤', color: c.series[2], values: daily.map((d) => d.learning + d.relearning) }
    ],
    [daily, c]
  )
  const option = useMemo(() => {
    // Only the top segment of each stack gets the rounded end; the 2px surface stroke is the
    // gap between segments.
    const topIndex = daily.map((_, i) => {
      for (let s = series.length - 1; s >= 0; s--) if (series[s].values[i] > 0) return s
      return -1
    })
    return {
      textStyle: { fontFamily: CHART_FONT },
      grid: { left: 36, right: 12, top: 10, bottom: 26 },
      tooltip: barAxisTooltip(c, (i) => {
        const total = series.reduce((n, s) => n + s.values[i], 0)
        return (
          `<div style="opacity:.7">${daily[i].date}</div>` +
          `<div style="margin-top:2px"><b style="font-weight:600">${total}</b> <span style="opacity:.7">张</span></div>` +
          series.map((s) => tooltipRow(s.color, String(s.values[i]), s.name)).join('')
        )
      }),
      xAxis: {
        type: 'category',
        data: daily.map((d) => mmdd(d.date)),
        ...axisStyle(c),
        axisLabel: { ...(axisStyle(c).axisLabel as object), interval: labelEvery(daily.length) }
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        ...axisStyle(c, { grid: true }),
        axisLine: { show: false },
        axisLabel: { color: c.ink3, fontSize: 11, formatter: (v: number) => compact(v) }
      },
      series: series.map((s, si) => ({
        name: s.name,
        type: 'bar',
        stack: 'total',
        barMaxWidth: 24,
        data: s.values.map((v, i) => ({
          value: v,
          itemStyle: { borderRadius: topIndex[i] === si ? [4, 4, 0, 0] : 0 }
        })),
        itemStyle: { color: s.color, borderColor: c.surface, borderWidth: 2 },
        emphasis: { itemStyle: { color: s.color, opacity: 0.85 } }
      }))
    }
  }, [daily, series, c])
  const legend: LegendItem[] = series.map((s) => ({ label: s.name, color: s.color }))
  return (
    <ChartCard
      title="每日复习量"
      subtitle="每一次作答算一次，按卡片当时的状态分开"
      legend={legend}
      table={{
        columns: ['日期', '复习', '新卡', '学习步骤', '合计'],
        rows: daily.map((d, i) => [
          d.date,
          series[0].values[i],
          series[1].values[i],
          series[2].values[i],
          series.reduce((n, s) => n + s.values[i], 0)
        ])
      }}
    >
      <EChart option={option} height={220} label="每日复习量柱状图" />
    </ChartCard>
  )
}

// ---------- first-attempt accuracy ----------

interface AccuracyPoint {
  label: string
  range: string
  attempts: number
  correct: number
}

function accuracyPoints(daily: DailyStat[], weekly: boolean): AccuracyPoint[] {
  if (!weekly) {
    return daily.map((d) => ({
      label: mmdd(d.date),
      range: d.date,
      attempts: d.firstAttempts,
      correct: d.firstCorrect
    }))
  }
  const points: AccuracyPoint[] = []
  for (let i = 0; i < daily.length; i += 7) {
    const week = daily.slice(i, i + 7)
    points.push({
      label: mmdd(week[0].date),
      range: `${week[0].date} – ${week[week.length - 1].date}`,
      attempts: week.reduce((n, d) => n + d.firstAttempts, 0),
      correct: week.reduce((n, d) => n + d.firstCorrect, 0)
    })
  }
  return points
}

export function AccuracyChart({
  daily,
  target,
  weekly
}: {
  daily: DailyStat[]
  target: number
  weekly: boolean
}): React.JSX.Element {
  const c = useChartColors()
  const points = useMemo(() => accuracyPoints(daily, weekly), [daily, weekly])
  const option = useMemo(() => {
    const values = points.map((p) => (p.attempts > 0 ? p.correct / p.attempts : null))
    const last = values.reduce<number>((at, v, i) => (v !== null ? i : at), -1)
    return {
      textStyle: { fontFamily: CHART_FONT },
      grid: { left: 40, right: 56, top: 14, bottom: 26 },
      tooltip: {
        ...tooltipStyle(c),
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: c.axis, width: 1, type: 'solid' } },
        formatter: (params: { dataIndex: number }[]) => {
          const p = points[params[0]?.dataIndex ?? 0]
          const value = p.attempts > 0 ? percent(p.correct / p.attempts) : '没有学习'
          return (
            `<div style="opacity:.7">${p.range}</div>` +
            tooltipRow(c.series[0], value, `首答正确 ${p.correct}/${p.attempts}`)
          )
        }
      },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: points.map((p) => p.label),
        ...axisStyle(c),
        axisLabel: { ...(axisStyle(c).axisLabel as object), interval: labelEvery(points.length) }
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 1,
        interval: 0.25,
        ...axisStyle(c, { grid: true }),
        axisLine: { show: false },
        axisLabel: {
          color: c.ink3,
          fontSize: 11,
          formatter: (v: number) => `${Math.round(v * 100)}%`
        }
      },
      series: [
        {
          name: '首答正确率',
          type: 'line',
          data: values.map((v, i) => ({
            value: v,
            // Only the latest point is marked and labelled; the axis and tooltip carry the rest.
            symbolSize: i === last ? 9 : 7,
            label:
              i === last
                ? {
                    show: true,
                    position: 'right',
                    color: c.ink,
                    fontSize: 12,
                    fontWeight: 600,
                    formatter: () => percent(v)
                  }
                : { show: false }
          })),
          connectNulls: false,
          showSymbol: true,
          symbol: 'circle',
          lineStyle: { width: 2, color: c.series[0], cap: 'round', join: 'round' },
          itemStyle: { color: c.series[0], borderColor: c.surface, borderWidth: 2 },
          areaStyle: { color: c.wash },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: c.ink3, width: 1, type: 'solid' },
            // Inside the plot on the left, clear of the latest value's label on the right.
            label: {
              color: c.ink2,
              fontSize: 11,
              formatter: `目标 ${percent(target)}`,
              position: 'insideStartTop'
            },
            data: [{ yAxis: target }]
          }
        }
      ]
    }
  }, [points, target, c])
  return (
    <ChartCard
      title="首答正确率"
      subtitle={weekly ? '每周汇总；每张卡每天的第一次作答' : '每张卡每天的第一次作答'}
      table={{
        columns: [weekly ? '周' : '日期', '首答', '正确', '正确率'],
        rows: points.map((p) => [
          p.range,
          p.attempts,
          p.correct,
          p.attempts ? percent(p.correct / p.attempts) : '—'
        ])
      }}
    >
      <EChart option={option} height={200} label="首答正确率折线图" />
    </ChartCard>
  )
}

// ---------- calendar heatmap ----------

export function HeatmapChart({ heatmap }: { heatmap: Dashboard['heatmap'] }): React.JSX.Element {
  const c = useChartColors()
  const { option, pieces } = useMemo(() => {
    const max = Math.max(0, ...heatmap.map((d) => d.count))
    const q = Math.max(1, Math.ceil(max / 4))
    const ranges: [number, number | null][] = [
      [1, q],
      [q + 1, 2 * q],
      [2 * q + 1, 3 * q],
      [3 * q + 1, null]
    ]
    const pieces = [
      { value: 0, color: c.line, label: '没有学习' },
      ...ranges.map(([min, maxV], i) => ({
        min,
        ...(maxV !== null ? { max: maxV } : {}),
        color: c.ord[i],
        label: maxV !== null ? (min === maxV ? `${min}` : `${min}–${maxV}`) : `${min}+`
      }))
    ]
    const option = {
      textStyle: { fontFamily: CHART_FONT },
      tooltip: {
        ...tooltipStyle(c),
        formatter: (p: { value: [string, number] }) =>
          `<div style="opacity:.7">${p.value[0]}</div><b style="font-weight:600">${p.value[1]}</b> <span style="opacity:.7">次作答</span>`
      },
      visualMap: { type: 'piecewise', show: false, dimension: 1, pieces },
      calendar: {
        top: 22,
        left: 28,
        right: 8,
        bottom: 4,
        range: [heatmap[0]?.date, heatmap[heatmap.length - 1]?.date],
        cellSize: ['auto', 14],
        splitLine: { show: false },
        itemStyle: { color: c.line, borderColor: c.surface, borderWidth: 2 },
        yearLabel: { show: false },
        dayLabel: {
          firstDay: 1,
          nameMap: ['日', '一', '二', '三', '四', '五', '六'],
          color: c.ink3,
          fontSize: 10
        },
        monthLabel: { nameMap: 'ZH', color: c.ink3, fontSize: 10 }
      },
      series: [
        {
          type: 'heatmap',
          coordinateSystem: 'calendar',
          data: heatmap.map((d) => [d.date, d.count])
        }
      ]
    }
    return { option, pieces }
  }, [heatmap, c])
  return (
    <ChartCard
      title="学习日历"
      subtitle="过去一年每天的作答次数"
      table={{
        columns: ['日期', '作答次数'],
        rows: heatmap
          .filter((d) => d.count > 0)
          .map((d) => [d.date, d.count])
          .reverse()
      }}
    >
      <EChart option={option} height={140} label="学习日历热力图" />
      <div className="mt-2 flex items-center justify-end gap-3 text-[11px] text-ink-2">
        {pieces.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-1">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
            {p.label}
          </span>
        ))}
      </div>
    </ChartCard>
  )
}

// ---------- single-series columns ----------

function SimpleColumns({
  title,
  subtitle,
  labels,
  values,
  unit,
  label,
  tableHead
}: {
  title: string
  subtitle: string
  labels: string[]
  values: number[]
  unit: string
  label: string
  tableHead: [string, string]
}): React.JSX.Element {
  const c = useChartColors()
  const option = useMemo(
    () => ({
      textStyle: { fontFamily: CHART_FONT },
      grid: { left: 36, right: 12, top: 10, bottom: 26 },
      tooltip: barAxisTooltip(
        c,
        (i) =>
          `<div style="opacity:.7">${labels[i]}</div><b style="font-weight:600">${values[i]}</b> <span style="opacity:.7">${unit}</span>`
      ),
      xAxis: {
        type: 'category',
        data: labels,
        ...axisStyle(c),
        axisLabel: { ...(axisStyle(c).axisLabel as object), interval: labelEvery(labels.length) }
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        ...axisStyle(c, { grid: true }),
        axisLine: { show: false },
        axisLabel: { color: c.ink3, fontSize: 11, formatter: (v: number) => compact(v) }
      },
      series: [columnSeries(title, c.series[0], values)]
    }),
    [labels, values, unit, title, c]
  )
  return (
    <ChartCard
      title={title}
      subtitle={subtitle}
      table={{ columns: tableHead, rows: labels.map((l, i) => [l, values[i]]) }}
    >
      <EChart option={option} height={200} label={label} />
    </ChartCard>
  )
}

export function ForecastChart({
  forecast
}: {
  forecast: Dashboard['forecast']
}): React.JSX.Element {
  return (
    <SimpleColumns
      title="未来 30 天到期"
      subtitle="今天这一栏包含已经过期还没复习的卡片"
      labels={forecast.map((d) => mmdd(d.date))}
      values={forecast.map((d) => d.count)}
      unit="张到期"
      label="未来30天到期卡片柱状图"
      tableHead={['日期', '到期卡片']}
    />
  )
}

export function StabilityChart({
  buckets
}: {
  buckets: Dashboard['stabilityBuckets']
}): React.JSX.Element {
  return (
    <SimpleColumns
      title="记忆稳定度分布"
      subtitle="稳定度：回忆率从 100% 降到 90% 大约需要的时间"
      labels={buckets.map((b) => b.label)}
      values={buckets.map((b) => b.count)}
      unit="张卡片"
      label="记忆稳定度分布柱状图"
      tableHead={['稳定度', '卡片数']}
    />
  )
}

export function MinutesChart({ daily }: { daily: DailyStat[] }): React.JSX.Element {
  return (
    <SimpleColumns
      title="每日学习时长"
      subtitle="分钟，按作答用时累计"
      labels={daily.map((d) => mmdd(d.date))}
      values={daily.map((d) => d.minutes)}
      unit="分钟"
      label="每日学习时长柱状图"
      tableHead={['日期', '分钟']}
    />
  )
}

// ---------- card states: one ordered, stacked bar ----------

export function CardStateBar({ states }: { states: Dashboard['states'] }): React.JSX.Element {
  const c = useChartColors()
  const parts = [
    { label: '新卡', value: states.new, color: c.ord[0] },
    { label: '学习中', value: states.learning + states.relearning, color: c.ord[1] },
    { label: '巩固中', value: states.young, color: c.ord[2] },
    { label: '已掌握', value: states.mature, color: c.ord[3] }
  ]
  const total = parts.reduce((n, p) => n + p.value, 0)
  return (
    <div>
      <div
        className="flex h-3 w-full gap-0.5 overflow-hidden rounded"
        role="img"
        aria-label="卡片状态构成"
      >
        {total === 0 ? (
          <div className="h-full w-full bg-surface-3" />
        ) : (
          parts
            .filter((p) => p.value > 0)
            .map((p) => (
              <div
                key={p.label}
                className="h-full first:rounded-l last:rounded-r"
                style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
                title={`${p.label} ${p.value} 张（${percent(p.value / total)}）`}
              />
            ))
        )}
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2">
        {parts.map((p) => (
          <div key={p.label} className="flex items-start gap-2">
            <span
              className="mt-1.5 inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
              style={{ background: p.color }}
            />
            <div>
              <div className="text-xs text-ink-2">{p.label}</div>
              <div className="text-lg font-semibold">{p.value}</div>
            </div>
          </div>
        ))}
      </div>
      {states.suspended > 0 && (
        <div className="mt-2 text-xs text-ink-2">另有 {states.suspended} 张已暂停</div>
      )}
    </div>
  )
}

// ---------- one card's forgetting curve ----------

export function CurveChart({ curve }: { curve: CurveData }): React.JSX.Element {
  const c = useChartColors()
  const option = useMemo(() => {
    const line: [number, number | null][] = []
    for (const segment of curve.segments) {
      for (const p of segment) line.push([p.t, p.r])
    }
    const reviewPoints = curve.reviews.map((r) => [r.t, 1, r.rating])
    return {
      textStyle: { fontFamily: CHART_FONT },
      grid: { left: 44, right: 64, top: 16, bottom: 28 },
      tooltip: {
        ...tooltipStyle(c),
        trigger: 'axis',
        axisPointer: { type: 'line', lineStyle: { color: c.axis, width: 1, type: 'solid' } },
        formatter: (
          params: { value: [number, number]; seriesIndex: number; data: [number, number, Grade] }[]
        ) => {
          const p = params.find((x) => x.seriesIndex === 0) ?? params[0]
          if (!p) return ''
          const review = params.find((x) => x.seriesIndex === 1)
          return (
            `<div style="opacity:.7">${formatDateTime(p.value[0])}</div>` +
            tooltipRow(c.series[0], percent(p.value[1]), '预测回忆率') +
            (review
              ? `<div style="margin-top:3px;opacity:.8">复习：${GRADE_LABEL[review.data[2]]}</div>`
              : '')
          )
        }
      },
      xAxis: {
        type: 'time',
        ...axisStyle(c),
        axisLabel: { color: c.ink3, fontSize: 11, formatter: '{MM}/{dd}' }
      },
      yAxis: {
        type: 'value',
        min: 0,
        max: 1,
        interval: 0.25,
        ...axisStyle(c, { grid: true }),
        axisLine: { show: false },
        axisLabel: {
          color: c.ink3,
          fontSize: 11,
          formatter: (v: number) => `${Math.round(v * 100)}%`
        }
      },
      series: [
        {
          name: '预测回忆率',
          type: 'line',
          data: line,
          showSymbol: false,
          lineStyle: { width: 2, color: c.series[0], cap: 'round', join: 'round' },
          itemStyle: { color: c.series[0] },
          areaStyle: { color: c.wash },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: c.ink3, width: 1, type: 'solid' },
            data: [
              {
                yAxis: curve.retention,
                label: {
                  formatter: `目标 ${percent(curve.retention)}`,
                  color: c.ink2,
                  fontSize: 11,
                  position: 'end'
                }
              },
              {
                xAxis: curve.now,
                label: { formatter: '现在', color: c.ink2, fontSize: 11, position: 'end' }
              }
            ]
          }
        },
        {
          name: '复习',
          type: 'scatter',
          data: reviewPoints,
          symbolSize: 9,
          itemStyle: { color: c.series[0], borderColor: c.surface, borderWidth: 2 },
          z: 3
        }
      ]
    }
  }, [curve, c])
  const legend: LegendItem[] = [
    { label: '预测回忆率', color: c.series[0], shape: 'line' },
    { label: '复习（回忆率回到 100%）', color: c.series[0] }
  ]
  return (
    <div>
      <Legend items={legend} />
      <EChart option={option} height={220} label="这张卡的遗忘曲线" />
    </div>
  )
}
