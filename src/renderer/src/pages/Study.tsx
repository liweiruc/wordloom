import {
  ChevronDown,
  CircleCheck,
  CircleX,
  Lightbulb,
  PartyPopper,
  TriangleAlert,
  Undo2,
  X
} from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  GRADE_LABEL,
  GRADES,
  type AnswerResult,
  type DisplaySettings,
  type Grade,
  type Register,
  type SessionSummary,
  type StudyCardContent,
  type StudyProgress,
  type StudyStep
} from '../../../shared/types'
import { letterHint } from '../../../shared/cloze'
import { Chinese } from '../components/Chinese'
import { ClozeSentence, MarkedSentence } from '../components/Cloze'
import { SpeakButton } from '../components/SpeakButton'
import { Synonyms } from '../components/Synonyms'
import { Badge, Button, Kbd, Spinner } from '../components/ui'
import { api, errorText } from '../lib/api'
import { useApp } from '../lib/useApp'
import { diffChars } from '../lib/diff'
import { formatDuration, percent } from '../lib/format'
import { speak } from '../lib/speech'

const FALLBACK_DISPLAY: DisplaySettings = {
  chineseDisplay: 'tap',
  autoSpeak: true,
  voice: '',
  speechRate: 0.9
}

const REGISTER_LABEL: Record<Register, string> = {
  neutral: '',
  formal: '正式',
  informal: '非正式',
  slang: '俚语'
}

const GRADE_STYLE: Record<Grade, string> = {
  1: 'bg-bad-bg text-bad-ink',
  2: 'bg-warn-bg text-warn-ink',
  3: 'bg-good-bg text-good-ink',
  4: 'bg-info-bg text-info-ink'
}

/** Keyboard handling for the current card; ignores held-down repeats and IME composition. */
function useKeys(handler: (e: KeyboardEvent) => void): void {
  const ref = useRef(handler)
  // Updated before paint, so a key pressed right after a render reaches the new handler.
  useLayoutEffect(() => {
    ref.current = handler
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.repeat || e.isComposing) return
      ref.current(e)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

function SenseLabels({ card }: { card: StudyCardContent }): React.JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <Badge>{card.pos}</Badge>
      {REGISTER_LABEL[card.register] && <Badge tone="info">{REGISTER_LABEL[card.register]}</Badge>}
    </div>
  )
}

function OtherSenses({
  card,
  display,
  label
}: {
  card: StudyCardContent
  display: DisplaySettings
  label: string
}): React.JSX.Element | null {
  if (card.otherSenses.length === 0) return null
  return (
    <details className="group mt-4 rounded-xl border border-[var(--border)] bg-surface px-5 py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm text-ink-2 select-none">
        <ChevronDown size={16} className="transition group-open:rotate-180" />
        {label}（{card.otherSenses.length}）
      </summary>
      <ul className="mt-3 flex flex-col gap-2.5 pb-1">
        {card.otherSenses.map((s, i) => (
          <li key={i} className="text-[15px]">
            <span className="mr-2 text-xs text-ink-3">{s.pos}</span>
            {s.defEn}
            <Synonyms words={s.synonyms} className="mt-0.5 text-sm" />
            <Chinese mode={display.chineseDisplay} className="mt-0.5 text-sm">
              {s.defZh}
            </Chinese>
          </li>
        ))}
      </ul>
    </details>
  )
}

function Ipa({ card }: { card: StudyCardContent }): React.JSX.Element {
  return (
    <span className="flex gap-4 text-ink-2">
      {card.ipaUk && <span>英 {card.ipaUk}</span>}
      {card.ipaUs && <span>美 {card.ipaUs}</span>}
    </span>
  )
}

// ---------- intro: a new sense, shown whole before it is asked ----------

function IntroCard({
  card,
  display,
  onContinue,
  onKnown
}: {
  card: StudyCardContent
  display: DisplaySettings
  onContinue(): void
  onKnown(): void
}): React.JSX.Element {
  useEffect(() => {
    if (display.autoSpeak) speak(card.headword, display)
    // Speak once per card, not on every settings change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.cardId])

  useKeys((e) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onContinue()
    } else if (e.key.toLowerCase() === 'k') {
      e.preventDefault()
      onKnown()
    } else if (e.key.toLowerCase() === 'p') {
      e.preventDefault()
      speak(card.headword, display)
    }
  })

  return (
    <div className="animate-fade-in">
      <Badge tone="accent">{card.firstSenseOfWord ? '新词' : '新义项'}</Badge>
      <div className="mt-3 flex items-center gap-3">
        <h1 className="text-5xl font-semibold tracking-tight">{card.headword}</h1>
        <SpeakButton text={card.headword} size={22} />
      </div>
      <div className="mt-2 text-[15px]">
        <Ipa card={card} />
      </div>

      <div className="mt-8 rounded-xl border border-[var(--border)] bg-surface p-6">
        <SenseLabels card={card} />
        <p className="mt-3 text-xl leading-snug">{card.defEn}</p>
        <Synonyms words={card.synonyms} className="mt-1.5 text-[15px]" />
        <Chinese mode={display.chineseDisplay} className="mt-2 text-[15px]">
          {card.defZh}
        </Chinese>
        <p className="mt-6 text-xl leading-relaxed">
          <MarkedSentence sentence={card.example.en} cloze={card.example.cloze} />
        </p>
        <Chinese mode={display.chineseDisplay} className="mt-2 text-[15px]">
          {card.example.zh}
        </Chinese>
      </div>

      <OtherSenses card={card} display={display} label="这个词的其他义项，之后会单独学" />

      <div className="mt-8 flex items-center justify-between">
        <Button size="lg" variant="ghost" onClick={onKnown}>
          我已经会了
          <Kbd>K</Kbd>
        </Button>
        <Button size="lg" variant="primary" onClick={onContinue}>
          记住了，开始测试
          <Kbd>Enter</Kbd>
        </Button>
      </div>
    </div>
  )
}

// ---------- cloze: the definition and the sentence, the word left out ----------

function Verdict({ result, input }: { result: AnswerResult; input: string }): React.JSX.Element {
  const typed = input.trim()
  if (result.outcome === 'correct') {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-good-bg px-4 py-3 text-good-ink">
        <CircleCheck size={20} />
        <span className="font-medium">正确</span>
        <span className="text-lg font-semibold">{result.expected}</span>
      </div>
    )
  }
  if (result.outcome === 'gave_up') {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-bad-bg px-4 py-3 text-bad-ink">
        <CircleX size={20} />
        <span className="font-medium">答案是</span>
        <span className="text-lg font-semibold">{result.expected}</span>
      </div>
    )
  }
  const near = result.outcome === 'typo' || result.outcome === 'wrong_form'
  const diff = diffChars(typed, result.expected)
  const title =
    result.outcome === 'typo'
      ? '拼写差一点'
      : result.outcome === 'wrong_form'
        ? '词形不对'
        : '答错了'
  return (
    <div
      className={`rounded-lg px-4 py-3 ${near ? 'bg-warn-bg text-warn-ink' : 'bg-bad-bg text-bad-ink'}`}
    >
      <div className="flex items-center gap-2 font-medium">
        {near ? <TriangleAlert size={20} /> : <CircleX size={20} />}
        {title}
        {result.outcome === 'wrong_form' && (
          <span className="font-normal">：句子里需要这个形式</span>
        )}
      </div>
      <div className="mt-2 grid grid-cols-[72px_1fr] gap-y-1 text-[15px]">
        <span className="opacity-80">你的答案</span>
        <span className="font-mono text-lg">
          {diff.given.map((c, i) => (
            <span key={i} className={c.ok ? '' : 'underline decoration-2 underline-offset-4'}>
              {c.ch}
            </span>
          ))}
        </span>
        <span className="opacity-80">正确答案</span>
        <span className="font-mono text-lg font-semibold">
          {diff.expected.map((c, i) => (
            <span key={i} className={c.ok ? '' : 'rounded bg-[var(--surface)] px-px'}>
              {c.ch}
            </span>
          ))}
        </span>
      </div>
    </div>
  )
}

function RatingBar({
  result,
  onRate
}: {
  result: AnswerResult
  onRate(grade: Grade): void
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-4 gap-2">
      {GRADES.map((g) => {
        const suggested = g === result.suggested
        return (
          <button
            key={g}
            type="button"
            onClick={() => onRate(g)}
            className={`relative flex cursor-pointer flex-col items-center gap-0.5 rounded-xl px-3 py-3 transition hover:brightness-95 ${GRADE_STYLE[g]} ${
              suggested ? 'ring-2 ring-[var(--ink)] ring-offset-2 ring-offset-[var(--page)]' : ''
            }`}
          >
            <span className="text-[15px] font-semibold">
              {GRADE_LABEL[g]}
              <span className="ml-1.5 text-xs font-normal opacity-70">{g}</span>
            </span>
            <span className="text-xs opacity-80">{result.intervals[g]}</span>
            {suggested && (
              <span className="absolute -top-2.5 rounded-full bg-ink px-2 text-[11px] leading-5 text-page">
                建议 · Enter
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

function ClozeCard({
  card,
  display,
  canUndo,
  onRate,
  onUndo
}: {
  card: StudyCardContent
  display: DisplaySettings
  canUndo: boolean
  onRate(grade: Grade): void
  onUndo(): void
}): React.JSX.Element {
  const { toast } = useApp()
  const [input, setInput] = useState('')
  const [hints, setHints] = useState(0)
  const [result, setResult] = useState<AnswerResult | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [shake, setShake] = useState(false)
  const started = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const words = card.example.cloze.join(' ').trim().split(/\s+/).length

  // The answer clock starts when the card is on screen.
  useEffect(() => {
    started.current = performance.now()
    inputRef.current?.focus()
  }, [])

  const submit = async (gaveUp: boolean): Promise<void> => {
    if (result || submitting) return
    if (!gaveUp && !input.trim()) {
      setShake(true)
      setTimeout(() => setShake(false), 300)
      return
    }
    setSubmitting(true)
    try {
      const r = await api.study.answer({
        cardId: card.cardId,
        input,
        hintsUsed: hints,
        durationMs: performance.now() - started.current,
        gaveUp
      })
      setResult(r)
      inputRef.current?.blur()
      if (display.autoSpeak) speak(r.expected, display)
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      setSubmitting(false)
    }
  }

  useKeys((e) => {
    const key = e.key.toLowerCase()
    if (!result) {
      if (e.ctrlKey && key === 'h') {
        e.preventDefault()
        setHints((h) => Math.min(2, h + 1))
      } else if (e.ctrlKey && key === 'g') {
        e.preventDefault()
        void submit(true)
      } else if (e.ctrlKey && key === 'z' && !input && canUndo) {
        e.preventDefault()
        onUndo()
      }
      return
    }
    if (e.ctrlKey && key === 'z' && canUndo) {
      e.preventDefault()
      onUndo()
    } else if (e.key === 'Enter') {
      e.preventDefault()
      onRate(result.suggested)
    } else if (['1', '2', '3', '4'].includes(e.key) && !e.ctrlKey) {
      e.preventDefault()
      onRate(Number(e.key) as Grade)
    } else if (key === 'p' && !e.ctrlKey) {
      e.preventDefault()
      speak(result.expected, display)
    }
  })

  return (
    <div className="animate-fade-in">
      <div className="flex items-center justify-between">
        <SenseLabels card={card} />
        <span className="text-xs text-ink-3">
          {words > 1 ? `填入 ${words} 个词` : '填入缺少的词'}
        </span>
      </div>

      <p className="mt-4 text-[21px] leading-snug text-ink">{card.defEn}</p>
      <Synonyms words={card.synonyms} className="mt-2 text-base" />
      {hints >= 1 && !result && (
        <p className="mt-2 flex items-center gap-1.5 text-[15px] text-ink-2">
          <Lightbulb size={15} className="text-accent-text" />
          {card.defZh}
        </p>
      )}

      <div className="mt-8 rounded-xl border border-[var(--border)] bg-surface px-7 py-6 text-[24px] leading-relaxed">
        {result ? (
          <MarkedSentence sentence={card.example.en} cloze={card.example.cloze} />
        ) : (
          <ClozeSentence sentence={card.example.en} cloze={card.example.cloze} />
        )}
        {result && (
          <Chinese mode={display.chineseDisplay} className="mt-3 text-base leading-normal">
            {card.example.zh}
          </Chinese>
        )}
      </div>

      {!result ? (
        <>
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                e.preventDefault()
                void submit(false)
              }
            }}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="输入单词，按 Enter 提交"
            aria-label="答案"
            // Same size as the definition above. "!" because the unlayered font reset in
            // styles.css would otherwise override text-*.
            className={`mt-6 h-14 w-full rounded-xl border-2 border-[var(--border)] bg-surface px-5 text-center text-[21px]! outline-none focus:border-accent ${shake ? 'animate-shake' : ''}`}
          />
          {hints >= 2 && (
            <p className="mt-3 text-center font-mono text-xl tracking-wider text-ink-2">
              {letterHint(card.example.cloze)}
            </p>
          )}
          <div className="mt-5 flex items-center justify-center gap-3">
            <Button
              variant="ghost"
              onClick={() => setHints((h) => Math.min(2, h + 1))}
              disabled={hints >= 2}
              icon={<Lightbulb size={16} />}
            >
              {hints === 0 ? '提示：中文' : hints === 1 ? '提示：首字母' : '没有更多提示'}
              <Kbd>Ctrl+H</Kbd>
            </Button>
            <Button variant="ghost" onClick={() => void submit(true)}>
              不知道
              <Kbd>Ctrl+G</Kbd>
            </Button>
            <Button variant="primary" onClick={() => void submit(false)} busy={submitting}>
              提交
              <Kbd>Enter</Kbd>
            </Button>
          </div>
        </>
      ) : (
        <div className="mt-6 flex flex-col gap-4">
          <Verdict result={result} input={input} />
          <div className="rounded-xl border border-[var(--border)] bg-surface px-5 py-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl font-semibold">{card.headword}</span>
              <SpeakButton text={card.headword} size={18} />
              <span className="text-sm">
                <Ipa card={card} />
              </span>
            </div>
            <Chinese mode={display.chineseDisplay} className="mt-2 text-[15px]">
              <span className="mr-2 text-xs text-ink-3">{card.pos}</span>
              {card.defZh}
            </Chinese>
          </div>
          <OtherSenses card={card} display={display} label="这个词的其他义项" />
          <div className="mt-2">
            <RatingBar result={result} onRate={onRate} />
            <p className="mt-3 text-center text-xs text-ink-3">
              按 1–4 选择评分，P 朗读，Ctrl+Z 撤销上一张
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- the end of a session ----------

function DoneCard({
  summary,
  onExit,
  onAgain
}: {
  summary: SessionSummary
  onExit(): void
  onAgain(): void
}): React.JSX.Element {
  const accuracy = summary.reviewed > 0 ? summary.correct / summary.reviewed : null
  return (
    <div className="animate-fade-in text-center">
      <PartyPopper size={44} className="mx-auto text-accent-text" />
      <h1 className="mt-4 text-3xl font-semibold">
        {summary.reviewed > 0 ? '这一轮完成了' : '现在没有要学的卡片'}
      </h1>
      {summary.reviewed > 0 && (
        <div className="mx-auto mt-8 grid max-w-xl grid-cols-4 gap-3">
          {[
            ['复习', summary.reviewed],
            ['正确率', percent(accuracy)],
            ['新学', summary.newLearned],
            ['用时', formatDuration(summary.durationMs)]
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-xl border border-[var(--border)] bg-surface px-3 py-3"
            >
              <div className="text-xs text-ink-2">{label}</div>
              <div className="mt-1 text-xl font-semibold">{value}</div>
            </div>
          ))}
        </div>
      )}
      {summary.learningLater > 0 && (
        <p className="mt-6 text-sm text-ink-2">
          还有 {summary.learningLater} 张学习中的卡片稍后到期，过一会儿再来学一轮。
        </p>
      )}
      {summary.troubleWords.length > 0 && (
        <div className="mx-auto mt-6 max-w-xl text-left">
          <div className="mb-2 text-sm text-ink-2">这些词这次答错了，多留意：</div>
          <div className="flex flex-wrap gap-2">
            {summary.troubleWords.map((w) => (
              <Link
                key={w.wordId}
                to={`/words/${w.wordId}`}
                className="rounded-lg border border-[var(--border)] bg-surface px-3 py-1.5 text-[15px] hover:bg-surface-2"
              >
                {w.headword}
              </Link>
            ))}
          </div>
        </div>
      )}
      <div className="mt-10 flex justify-center gap-3">
        <Button size="lg" onClick={onAgain}>
          再看看有没有要学的
        </Button>
        <Button size="lg" variant="primary" onClick={onExit}>
          返回复习
        </Button>
      </div>
    </div>
  )
}

function ProgressHeader({ progress }: { progress: StudyProgress }): React.JSX.Element {
  const total = progress.done + progress.remaining
  return (
    <div className="flex flex-1 items-center gap-4">
      <div className="h-1.5 max-w-[360px] flex-1 overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${total ? (progress.done / total) * 100 : 0}%` }}
        />
      </div>
      <div className="flex gap-3 text-xs text-ink-2 tabular">
        <span>新 {progress.newLeft}</span>
        <span>复习 {progress.reviewLeft}</span>
        <span>学习中 {progress.learningLeft}</span>
        <span className="text-ink-3">已完成 {progress.done}</span>
      </div>
    </div>
  )
}

export default function Study(): React.JSX.Element {
  const navigate = useNavigate()
  const { settings, toast } = useApp()
  const display = settings?.settings.display ?? FALLBACK_DISPLAY
  const [step, setStep] = useState<StudyStep | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const current = await api.study.current()
        const next = current && current.kind !== 'done' ? current : await api.study.start()
        if (!cancelled) setStep(next)
      } catch (err) {
        if (!cancelled) setError(errorText(err))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const run = useCallback(
    async (action: () => Promise<StudyStep>) => {
      if (busy.current) return
      busy.current = true
      try {
        setStep(await action())
      } catch (err) {
        toast(errorText(err), 'error')
      } finally {
        busy.current = false
      }
    },
    [toast]
  )

  const exit = useCallback(async () => {
    await api.study.finish()
    navigate('/review')
  }, [navigate])

  useKeys((e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      void exit()
    }
  })

  const undo = (): void => void run(() => api.study.undo())

  let body: React.JSX.Element
  if (error) body = <div className="text-center text-bad-ink">{error}</div>
  else if (!step)
    body = (
      <div className="flex justify-center">
        <Spinner label="正在准备今天的卡片…" />
      </div>
    )
  else if (step.kind === 'intro') {
    body = (
      <IntroCard
        key={`intro-${step.card.cardId}`}
        card={step.card}
        display={display}
        onContinue={() => void run(() => api.study.continueIntro())}
        onKnown={() => void run(() => api.study.markKnown())}
      />
    )
  } else if (step.kind === 'cloze') {
    body = (
      <ClozeCard
        key={`cloze-${step.card.cardId}-${step.progress.done}`}
        card={step.card}
        display={display}
        canUndo={step.canUndo}
        onRate={(g) => void run(() => api.study.rate(g))}
        onUndo={undo}
      />
    )
  } else {
    body = (
      <DoneCard
        summary={step.summary}
        onExit={() => void exit()}
        onAgain={() => void run(() => api.study.start())}
      />
    )
  }

  return (
    <div className="flex h-full flex-col bg-page">
      <header className="flex items-center gap-4 border-b border-[var(--border)] bg-surface px-5 py-2.5">
        <Button variant="ghost" size="sm" icon={<X size={15} />} onClick={() => void exit()}>
          结束
          <Kbd>Esc</Kbd>
        </Button>
        {step && step.kind !== 'done' ? (
          <ProgressHeader progress={step.progress} />
        ) : (
          <div className="flex-1" />
        )}
        {step?.canUndo && (
          <Button variant="ghost" size="sm" icon={<Undo2 size={15} />} onClick={undo}>
            撤销
            <Kbd>Ctrl+Z</Kbd>
          </Button>
        )}
      </header>
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full max-w-[780px] flex-col justify-center px-8 py-10">
          {body}
        </div>
      </main>
    </div>
  )
}
