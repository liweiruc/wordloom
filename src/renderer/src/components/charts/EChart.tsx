import { BarChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts'
import {
  CalendarComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent
} from 'echarts/components'
import * as echarts from 'echarts/core'
import { CanvasRenderer } from 'echarts/renderers'
import { useEffect, useRef } from 'react'

// Only the chart types and components the app draws, to keep the bundle lean.
echarts.use([
  BarChart,
  HeatmapChart,
  LineChart,
  ScatterChart,
  CalendarComponent,
  GridComponent,
  MarkLineComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer
])

export type ChartOption = echarts.EChartsCoreOption

export function EChart({
  option,
  height,
  label
}: {
  option: ChartOption
  /** Includes the axis band: the card never needs its own scrollbar. */
  height: number
  label: string
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  const chart = useRef<echarts.ECharts | null>(null)

  useEffect(() => {
    const el = ref.current!
    const instance = echarts.init(el, undefined, { renderer: 'canvas' })
    chart.current = instance
    const resize = new ResizeObserver(() => instance.resize())
    resize.observe(el)
    return () => {
      resize.disconnect()
      instance.dispose()
      chart.current = null
    }
  }, [])

  useEffect(() => {
    chart.current?.setOption(option, { notMerge: true })
  }, [option])

  return <div ref={ref} style={{ height }} role="img" aria-label={label} />
}
