import { ArrowLeft, Pause, Pencil, Play, RefreshCw, Trash } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  CARD_STATE_LABEL,
  GRADE_LABEL,
  REGISTER_LABEL,
  type Register,
  type SensePatch,
  type SenseView,
  type WordDetail as Detail
} from '../../../shared/types'
import { cleanSynonyms } from '../../../shared/synonyms'
import { CurveChart } from '../components/charts/charts'
import { ClozeSentence } from '../components/Cloze'
import { SenseBody } from '../components/SenseBody'
import { SpeakButton } from '../components/SpeakButton'
import { Badge, Button, Notice, Page, Panel, Select, Spinner, TextInput } from '../components/ui'
import { api, errorText } from '../lib/api'
import { useApp } from '../lib/useApp'
import { formatDateTime, formatDays, formatDue, percent } from '../lib/format'
import { useAsync } from '../lib/useAsync'

const POS_OPTIONS = [
  'n.',
  'v.',
  'adj.',
  'adv.',
  'prep.',
  'conj.',
  'pron.',
  'det.',
  'num.',
  'int.',
  'phr. v.',
  'idiom',
  'phrase'
]
const REGISTERS = Object.keys(REGISTER_LABEL) as Register[]
const OUTCOME_LABEL: Record<string, string> = {
  correct: '正确',
  typo: '拼写接近',
  wrong_form: '词形不对',
  wrong: '答错',
  gave_up: '不知道',
  known: '已会'
}

function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>): React.JSX.Element {
  return (
    <textarea
      rows={2}
      {...props}
      className="w-full resize-y rounded-lg border border-[var(--border)] bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent"
    />
  )
}

function SenseEditor({
  sense,
  onSave,
  onCancel
}: {
  sense: SenseView
  onSave(patch: SensePatch): Promise<void>
  onCancel(): void
}): React.JSX.Element {
  const [pos, setPos] = useState(sense.pos)
  const [register, setRegister] = useState<Register>(sense.register)
  const [defEn, setDefEn] = useState(sense.defEn)
  const [defZh, setDefZh] = useState(sense.defZh)
  const [synonyms, setSynonyms] = useState(sense.synonyms.join(', '))
  const [exampleEn, setExampleEn] = useState(sense.example?.en ?? '')
  const [exampleZh, setExampleZh] = useState(sense.example?.zh ?? '')
  const [cloze, setCloze] = useState((sense.example?.cloze ?? []).join(' | '))
  const [saving, setSaving] = useState(false)
  const parts = cloze
    .split('|')
    .map((p) => p.trim())
    .filter(Boolean)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-3">
        <Select
          value={POS_OPTIONS.includes(pos) ? pos : '__custom'}
          onChange={(e) => e.target.value !== '__custom' && setPos(e.target.value)}
          className="!w-32"
        >
          {POS_OPTIONS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
          {!POS_OPTIONS.includes(pos) && <option value="__custom">{pos}</option>}
        </Select>
        <Select
          value={register}
          onChange={(e) => setRegister(e.target.value as Register)}
          className="!w-32"
        >
          {REGISTERS.map((r) => (
            <option key={r} value={r}>
              {REGISTER_LABEL[r]}
            </option>
          ))}
        </Select>
      </div>
      <label className="text-xs text-ink-2">
        英文释义（不能出现这个词本身）
        <TextArea value={defEn} onChange={(e) => setDefEn(e.target.value)} />
      </label>
      <label className="text-xs text-ink-2">
        中文释义
        <TextInput value={defZh} onChange={(e) => setDefZh(e.target.value)} />
      </label>
      <label className="text-xs text-ink-2">
        近义词（英文，用逗号分隔；没有就留空，不能出现这个词本身）
        <TextInput value={synonyms} onChange={(e) => setSynonyms(e.target.value)} />
      </label>
      <label className="text-xs text-ink-2">
        例句
        <TextArea value={exampleEn} onChange={(e) => setExampleEn(e.target.value)} />
      </label>
      <label className="text-xs text-ink-2">
        例句翻译
        <TextArea value={exampleZh} onChange={(e) => setExampleZh(e.target.value)} />
      </label>
      <label className="text-xs text-ink-2">
        挖空内容（例句里这个词的原样写法；被隔开的短语用 | 分隔，如 ripped | off）
        <TextInput value={cloze} onChange={(e) => setCloze(e.target.value)} />
      </label>
      <div className="rounded-lg bg-surface-2 px-4 py-3 text-[15px]">
        <span className="mr-2 text-xs text-ink-3">预览</span>
        <ClozeSentence sentence={exampleEn} cloze={parts} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          取消
        </Button>
        <Button
          variant="primary"
          busy={saving}
          onClick={async () => {
            setSaving(true)
            try {
              await onSave({
                pos,
                register,
                defEn,
                defZh,
                synonyms: cleanSynonyms(synonyms),
                exampleEn,
                exampleZh,
                cloze: parts
              })
            } finally {
              setSaving(false)
            }
          }}
        >
          保存
        </Button>
      </div>
    </div>
  )
}

function CardFacts({ sense }: { sense: SenseView }): React.JSX.Element | null {
  const card = sense.card
  if (!card) return null
  const facts: [string, string][] = [
    ['状态', card.suspended ? '已暂停' : CARD_STATE_LABEL[card.state]]
  ]
  if (card.state !== 0) {
    facts.push(['下次复习', formatDue(card.due)])
    facts.push(['稳定度', formatDays(card.stability)])
    facts.push(['难度', card.difficulty.toFixed(1)])
    facts.push(['当前回忆率', percent(card.retrievability)])
    facts.push(['复习', `${card.reps} 次`])
    facts.push(['遗忘', `${card.lapses} 次`])
  }
  return (
    <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-[var(--border)] pt-3 text-xs text-ink-2 tabular">
      {facts.map(([k, v]) => (
        <span key={k}>
          {k} <span className="font-medium text-ink">{v}</span>
        </span>
      ))}
    </div>
  )
}

export default function WordDetail(): React.JSX.Element {
  const { id } = useParams()
  const wordId = Number(id)
  const navigate = useNavigate()
  const { toast, enrich } = useApp()
  const detail = useAsync(() => api.words.get(wordId), [wordId])
  const [editing, setEditing] = useState<number | null>(null)
  const [editHead, setEditHead] = useState(false)
  const [pickedCard, setCurveCard] = useState<number | null>(null)
  const word = detail.data
  // The curve shows the picked card while it still belongs to this word and has history;
  // otherwise the first studied sense.
  const studiedCards = (word?.senses ?? []).flatMap((s) =>
    s.card && s.card.reps > 0 ? [s.card.id] : []
  )
  const curveCard =
    pickedCard !== null && studiedCards.includes(pickedCard)
      ? pickedCard
      : (studiedCards[0] ?? null)
  const curve = useAsync(
    () => (curveCard ? api.words.curve(curveCard) : Promise.resolve(null)),
    [curveCard]
  )
  const { reload } = detail

  // While this word is being generated, pick up the result as soon as it lands.
  useEffect(() => {
    if (word && (word.status === 'pending' || word.status === 'enriching')) reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrich?.ready, enrich?.failed])

  const apply = async (action: () => Promise<Detail>, done?: string): Promise<void> => {
    try {
      detail.setData(await action())
      if (done) toast(done)
    } catch (err) {
      toast(errorText(err), 'error')
    }
  }

  if (!word) {
    return (
      <Page>
        {detail.error ? (
          <div className="text-bad-ink">{detail.error}</div>
        ) : (
          <Spinner label="加载中…" />
        )}
      </Page>
    )
  }

  const generating = word.status === 'pending' || word.status === 'enriching'
  const senseOrd = new Map(word.senses.map((s, i) => [s.id, i + 1]))

  return (
    <Page>
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="mb-4 inline-flex cursor-pointer items-center gap-1 text-sm text-ink-2 hover:text-ink"
      >
        <ArrowLeft size={15} /> 返回
      </button>

      <div className="mb-6 flex items-start justify-between gap-6">
        <div className="min-w-0">
          {editHead ? (
            <HeadEditor
              word={word}
              onCancel={() => setEditHead(false)}
              onSave={async (patch) => {
                await apply(() => api.words.update(word.id, patch), '已保存')
                setEditHead(false)
              }}
            />
          ) : (
            <>
              <div className="flex items-center gap-3">
                <h1 className="text-4xl font-semibold tracking-tight">{word.headword}</h1>
                <SpeakButton text={word.headword} size={20} />
                <button
                  type="button"
                  title="编辑词头和音标"
                  onClick={() => setEditHead(true)}
                  className="cursor-pointer rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink"
                >
                  <Pencil size={15} />
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-4 text-[15px] text-ink-2">
                {word.ipaUk && <span>英 {word.ipaUk}</span>}
                {word.ipaUs && <span>美 {word.ipaUs}</span>}
                {word.variants.length > 0 && (
                  <span className="text-sm">也写作 {word.variants.join('、')}</span>
                )}
              </div>
              {word.lists.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {word.lists.map((l) => (
                    <Badge key={l.id}>{l.name}</Badge>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <Button
            icon={<RefreshCw size={15} />}
            disabled={generating}
            onClick={() => apply(() => api.words.regenerate(word.id), '已加入生成队列')}
            title="重新生成尚未学过的义项；学过或手动改过的义项会保留"
          >
            重新生成
          </Button>
          <Button
            variant="danger"
            icon={<Trash size={15} />}
            onClick={async () => {
              if (!window.confirm(`删除「${word.headword}」以及它所有的复习记录？`)) return
              try {
                await api.words.remove(word.id)
                toast('已删除')
                navigate('/library')
              } catch (err) {
                toast(errorText(err), 'error')
              }
            }}
          >
            删除
          </Button>
        </div>
      </div>

      {generating && (
        <div className="mb-5">
          <Notice tone="info" icon={<Spinner />}>
            {word.status === 'enriching' ? '正在生成词条…' : '排队等待生成。'}
          </Notice>
        </div>
      )}
      {word.status === 'failed' && (
        <div className="mb-5">
          <Notice tone="bad">生成失败：{word.error}</Notice>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {word.senses.map((sense, i) => (
          <Panel key={sense.id}>
            {editing === sense.id ? (
              <SenseEditor
                sense={sense}
                onCancel={() => setEditing(null)}
                onSave={async (patch) => {
                  try {
                    detail.setData(await api.words.updateSense(sense.id, patch))
                    setEditing(null)
                    toast('已保存')
                  } catch (err) {
                    toast(errorText(err), 'error')
                  }
                }}
              />
            ) : (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-3">#{i + 1}</span>
                    <Badge>{sense.pos}</Badge>
                    {sense.register !== 'neutral' && (
                      <Badge tone="info">{REGISTER_LABEL[sense.register]}</Badge>
                    )}
                    {sense.userEdited && <Badge tone="accent">已手动修改</Badge>}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Pencil size={13} />}
                      onClick={() => setEditing(sense.id)}
                    >
                      编辑
                    </Button>
                    {sense.card && (
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={sense.card.suspended ? <Play size={13} /> : <Pause size={13} />}
                        onClick={() =>
                          apply(() =>
                            api.words.setSuspended(sense.card!.id, !sense.card!.suspended)
                          )
                        }
                      >
                        {sense.card.suspended ? '恢复' : '暂停'}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Trash size={13} />}
                      onClick={() => {
                        if (window.confirm('删除这个义项以及它的复习记录？'))
                          void apply(() => api.words.deleteSense(sense.id))
                      }}
                    >
                      删除
                    </Button>
                  </div>
                </div>
                <SenseBody
                  defEn={sense.defEn}
                  defZh={sense.defZh}
                  synonyms={sense.synonyms}
                  example={sense.example}
                />
                <CardFacts sense={sense} />
              </>
            )}
          </Panel>
        ))}
      </div>

      {word.senses.some((s) => s.card && s.card.reps > 0) && (
        <Panel
          className="mt-6"
          title="遗忘曲线"
          subtitle="复习后回忆率回到 100%，之后沿着这张卡自己的曲线下降；降到目标记忆率附近时安排下一次复习"
          actions={
            <Select
              value={curveCard ?? ''}
              onChange={(e) => setCurveCard(Number(e.target.value))}
              className="!h-8 !w-40 text-xs"
            >
              {word.senses
                .filter((s) => s.card && s.card.reps > 0)
                .map((s) => (
                  <option key={s.id} value={s.card!.id}>
                    义项 #{senseOrd.get(s.id)} · {s.pos}
                  </option>
                ))}
            </Select>
          }
        >
          {curve.data ? <CurveChart curve={curve.data} /> : <Spinner />}
        </Panel>
      )}

      {word.logs.length > 0 && (
        <Panel className="mt-6" title="复习记录" padded={false}>
          <table className="mt-2 w-full text-sm tabular">
            <thead className="text-left text-xs text-ink-2">
              <tr>
                <th className="px-5 py-2 font-medium">时间</th>
                <th className="px-3 py-2 font-medium">义项</th>
                <th className="px-3 py-2 font-medium">作答</th>
                <th className="px-3 py-2 font-medium">判定</th>
                <th className="px-3 py-2 font-medium">评分</th>
                <th className="px-5 py-2 font-medium">间隔</th>
              </tr>
            </thead>
            <tbody>
              {word.logs.map((log) => (
                <tr key={log.id} className="border-t border-[var(--border)]">
                  <td className="px-5 py-1.5 text-ink-2">{formatDateTime(log.reviewedAt)}</td>
                  <td className="px-3 py-1.5">#{senseOrd.get(log.senseId) ?? '?'}</td>
                  <td className="px-3 py-1.5 font-mono">{log.answer || '—'}</td>
                  <td className="px-3 py-1.5">{OUTCOME_LABEL[log.outcome] ?? log.outcome}</td>
                  <td className="px-3 py-1.5">{GRADE_LABEL[log.rating]}</td>
                  <td className="px-5 py-1.5 text-ink-2">
                    {log.scheduledDays > 0 ? `${log.scheduledDays} 天` : '当天'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </Page>
  )
}

function HeadEditor({
  word,
  onSave,
  onCancel
}: {
  word: Detail
  onSave(patch: { headword: string; ipaUk: string; ipaUs: string }): Promise<void>
  onCancel(): void
}): React.JSX.Element {
  const [headword, setHeadword] = useState(word.headword)
  const [ipaUk, setIpaUk] = useState(word.ipaUk)
  const [ipaUs, setIpaUs] = useState(word.ipaUs)
  return (
    <div className="flex flex-col gap-2">
      <TextInput
        value={headword}
        onChange={(e) => setHeadword(e.target.value)}
        className="!h-11 !text-2xl font-semibold"
      />
      <div className="flex gap-2">
        <TextInput value={ipaUk} onChange={(e) => setIpaUk(e.target.value)} placeholder="英音" />
        <TextInput value={ipaUs} onChange={(e) => setIpaUs(e.target.value)} placeholder="美音" />
      </div>
      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={() => onSave({ headword, ipaUk, ipaUs })}>
          保存
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          取消
        </Button>
      </div>
    </div>
  )
}
