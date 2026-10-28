import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AccuracyChart,
  CardStateBar,
  DailyActivityChart,
  ForecastChart,
  HeatmapChart,
  MinutesChart,
  StabilityChart
} from '../components/charts/charts'
import { Empty, Meter, Page, PageHeader, Panel, Spinner, StatTile } from '../components/ui'
import { api } from '../lib/api'
import { compact, percent } from '../lib/format'
import { useAsync } from '../lib/useAsync'

function RangeToggle({
  value,
  onChange
}: {
  value: 30 | 90
  onChange(v: 30 | 90): void
}): React.JSX.Element {
  return (
    <div
      className="flex rounded-lg bg-surface-2 p-0.5 text-xs"
      role="radiogroup"
      aria-label="时间范围"
    >
      {([30, 90] as const).map((days) => (
        <button
          key={days}
          type="button"
          role="radio"
          aria-checked={value === days}
          onClick={() => onChange(days)}
          className={`cursor-pointer rounded-md px-2.5 py-1 ${value === days ? 'bg-surface font-medium text-ink shadow-sm' : 'text-ink-2'}`}
        >
          近 {days} 天
        </button>
      ))}
    </div>
  )
}

export default function Stats(): React.JSX.Element {
  const dash = useAsync(() => api.stats.dashboard(), [])
  const [range, setRange] = useState<30 | 90>(30)
  const d = dash.data

  if (!d) {
    return (
      <Page>
        <PageHeader title="统计" />
        {dash.error ? (
          <div className="text-bad-ink">{dash.error}</div>
        ) : (
          <Spinner label="正在统计…" />
        )}
      </Page>
    )
  }

  const daily = d.daily.slice(-range)
  const retention30 =
    d.retention.last30Total > 0 ? d.retention.last30Passed / d.retention.last30Total : null
  const totalCards =
    d.states.new + d.states.learning + d.states.relearning + d.states.young + d.states.mature

  return (
    <Page wide>
      <PageHeader title="统计" description="记忆状态来自每张卡自己的遗忘曲线（FSRS）" />

      <div className="grid grid-cols-5 gap-4">
        <StatTile label="词库" value={compact(d.words.total)} sub={`已生成 ${d.words.ready} 个`} />
        <StatTile
          label="学过的词"
          value={compact(d.words.studied)}
          sub={`全部义项已掌握 ${d.words.fullyMature} 个`}
        />
        <StatTile
          label="已掌握的卡片"
          value={compact(d.states.mature)}
          sub={`共 ${totalCards} 张`}
        />
        <StatTile label="连续学习" value={`${d.today.streak} 天`} />
        <StatTile
          label="当前平均回忆率"
          value={percent(d.retention.avgRetrievability)}
          sub="所有复习中的卡片"
        />
      </div>

      <div className="mt-5 grid grid-cols-[3fr_2fr] gap-5">
        <Panel title="卡片状态" subtitle="新卡 → 学习中 → 巩固中（稳定度不到 21 天）→ 已掌握">
          <CardStateBar states={d.states} />
        </Panel>
        <Panel title="记忆保持" subtitle="近 30 天复习时答对（没按「重来」）的比例">
          {retention30 === null ? (
            <div className="text-sm text-ink-2">
              还没有复习记录。卡片第一次到期复习后，这里会显示真实保持率。
            </div>
          ) : (
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-3xl font-semibold">{percent(retention30)}</span>
                <span className="text-sm text-ink-2">目标 {percent(d.retention.target)}</span>
              </div>
              <div className="mt-3">
                <Meter value={retention30} target={d.retention.target} label="真实保持率" />
              </div>
              <div className="mt-2 text-xs text-ink-2">
                {d.retention.last30Passed} / {d.retention.last30Total} 次复习答对。
                {retention30 < d.retention.target - 0.05
                  ? '明显低于目标：可以考虑减少每日新卡。'
                  : ''}
              </div>
            </div>
          )}
        </Panel>
      </div>

      <div className="mt-8 mb-3 flex items-center justify-between">
        <h2 className="text-base font-semibold">学习活动</h2>
        <RangeToggle value={range} onChange={setRange} />
      </div>
      <div className="grid grid-cols-2 gap-5">
        <DailyActivityChart daily={daily} />
        <AccuracyChart daily={daily} target={d.retention.target} weekly={range === 90} />
        <MinutesChart daily={daily} />
        <ForecastChart forecast={d.forecast} />
      </div>

      <div className="mt-5">
        <HeatmapChart heatmap={d.heatmap} />
      </div>

      <div className="mt-5 grid grid-cols-2 gap-5">
        <StabilityChart buckets={d.stabilityBuckets} />
        <Panel title="难词榜" subtitle="遗忘次数最多的词（至少复习过 3 次）" padded={false}>
          {d.hardest.length === 0 ? (
            <div className="px-5 pb-5 text-sm text-ink-2">暂时还没有。</div>
          ) : (
            <table className="mt-2 w-full text-sm tabular">
              <thead className="text-left text-xs text-ink-2">
                <tr>
                  <th className="px-5 py-2 font-medium">单词</th>
                  <th className="px-3 py-2 font-medium">遗忘</th>
                  <th className="px-3 py-2 font-medium">复习</th>
                  <th className="px-5 py-2 font-medium">正确率</th>
                </tr>
              </thead>
              <tbody>
                {d.hardest.map((w) => (
                  <tr key={w.wordId} className="border-t border-[var(--border)]">
                    <td className="px-5 py-1.5">
                      <Link
                        to={`/words/${w.wordId}`}
                        className="font-medium text-accent-text hover:underline"
                      >
                        {w.headword}
                      </Link>
                      {d.leeches.some((l) => l.wordId === w.wordId) && (
                        <span className="ml-2 text-xs text-bad-ink">顽固词</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">{w.lapses}</td>
                    <td className="px-3 py-1.5">{w.reviews}</td>
                    <td className="px-5 py-1.5">{percent(w.accuracy)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
      </div>

      <div className="mt-5 grid grid-cols-[3fr_2fr] gap-5">
        <Panel title="词表进度" padded={false}>
          {d.lists.length === 0 ? (
            <Empty title="还没有导入过词表" />
          ) : (
            <table className="mt-2 w-full text-sm tabular">
              <thead className="text-left text-xs text-ink-2">
                <tr>
                  <th className="px-5 py-2 font-medium">词表</th>
                  <th className="px-3 py-2 font-medium">词数</th>
                  <th className="px-3 py-2 font-medium">已生成</th>
                  <th className="w-[38%] px-5 py-2 font-medium">进度（按卡片）</th>
                </tr>
              </thead>
              <tbody>
                {d.lists.map((l) => (
                  <tr key={l.id} className="border-t border-[var(--border)]">
                    <td className="px-5 py-2">
                      <Link to={`/library?list=${l.id}`} className="font-medium hover:underline">
                        {l.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{l.words}</td>
                    <td className="px-3 py-2">
                      {l.ready}
                      {l.failed > 0 && (
                        <span className="ml-1 text-xs text-bad-ink">（失败 {l.failed}）</span>
                      )}
                    </td>
                    <td className="px-5 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1">
                          <Meter value={l.cards ? l.studiedCards / l.cards : 0} />
                        </div>
                        <span className="w-32 text-right text-xs text-ink-2">
                          已学 {l.studiedCards}/{l.cards} · 掌握 {l.matureCards}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>
        <Panel title="DeepSeek 用量" subtitle="所有生成和整理请求的累计">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
            <div>
              <div className="text-xs text-ink-2">请求次数</div>
              <div className="text-xl font-semibold">{compact(d.llm.calls)}</div>
            </div>
            <div>
              <div className="text-xs text-ink-2">失败</div>
              <div className="text-xl font-semibold">{compact(d.llm.failed)}</div>
            </div>
            <div>
              <div className="text-xs text-ink-2">输入 token（命中缓存）</div>
              <div className="text-xl font-semibold">
                {compact(d.llm.promptTokens)}
                <span className="ml-1 text-sm font-normal text-ink-2">
                  （{compact(d.llm.cacheHitTokens)}）
                </span>
              </div>
            </div>
            <div>
              <div className="text-xs text-ink-2">输出 token</div>
              <div className="text-xl font-semibold">{compact(d.llm.completionTokens)}</div>
            </div>
          </div>
        </Panel>
      </div>
    </Page>
  )
}
