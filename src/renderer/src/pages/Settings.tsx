import {
  ArchiveRestore,
  Database,
  Download,
  FileDown,
  FolderOpen,
  HardDriveDownload,
  KeyRound,
  TriangleAlert,
  Volume2
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { AppSettings, ExportFile } from '../../../shared/types'
import {
  Button,
  Field,
  Notice,
  Page,
  PageHeader,
  Panel,
  Select,
  Spinner,
  TextInput,
  Toggle
} from '../components/ui'
import { api, errorText } from '../lib/api'
import { useApp } from '../lib/useApp'
import { formatBytes, formatDateTime } from '../lib/format'
import { saveFile } from '../lib/save-file'
import { speak, useEnglishVoices } from '../lib/speech'
import { useAsync } from '../lib/useAsync'

function NumberInput({
  value,
  onChange,
  min,
  max,
  step = 1
}: {
  value: number
  onChange(v: number): void
  min: number
  max: number
  step?: number
}): React.JSX.Element {
  return (
    <TextInput
      type="number"
      value={Number.isFinite(value) ? value : ''}
      min={min}
      max={max}
      step={step}
      onChange={(e) => {
        const v = Number(e.target.value)
        if (!Number.isNaN(v)) onChange(Math.min(max, Math.max(min, v)))
      }}
      className="!w-32"
    />
  )
}

// A section edits a copy of its settings and saves them together, so half-typed values
// never reach the scheduler. Sections render only once settings have loaded, and the page
// keys each one by its saved values, so a save restarts the copy from what was stored.
function useSection<K extends keyof AppSettings>(
  key: K
): {
  draft: AppSettings[K]
  set<F extends keyof AppSettings[K]>(field: F, value: AppSettings[K][F]): void
  dirty: boolean
  save(): Promise<void>
} {
  const { settings, updateSettings, toast } = useApp()
  const saved = settings!.settings[key]
  const [draft, setDraft] = useState<AppSettings[K]>(saved)
  return {
    draft,
    set(field, value) {
      setDraft((d) => ({ ...d, [field]: value }))
    },
    dirty: JSON.stringify(draft) !== JSON.stringify(saved),
    async save() {
      try {
        await updateSettings({ [key]: draft } as never)
        toast('已保存')
      } catch (err) {
        toast(errorText(err), 'error')
      }
    }
  }
}

function SaveBar({ dirty, onSave }: { dirty: boolean; onSave(): void }): React.JSX.Element {
  return (
    <div className="mt-3 flex justify-end border-t border-[var(--border)] pt-3">
      <Button variant="primary" disabled={!dirty} onClick={onSave}>
        保存
      </Button>
    </div>
  )
}

function ApiKeyField(): React.JSX.Element {
  const { settings, setApiKey, toast } = useApp()
  const [key, setKey] = useState('')
  const [testing, setTesting] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  return (
    <Field
      label="API key"
      hint={
        settings?.hasApiKey
          ? settings.storage.kind === 'folder'
            ? '已保存（用 Windows 加密存放在本机）。输入新的 key 可以替换。'
            : '已保存（只存放在这台设备上，不会写进导出的数据库文件）。输入新的 key 可以替换。'
          : '在 platform.deepseek.com 创建；只保存在本机。'
      }
    >
      <div className="flex gap-2">
        <TextInput
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={settings?.hasApiKey ? '••••••••••••' : 'sk-…'}
          autoComplete="off"
        />
        <Button
          icon={<KeyRound size={15} />}
          disabled={!key.trim()}
          onClick={async () => {
            try {
              await setApiKey(key)
              setKey('')
              setResult(null)
              toast('API key 已保存')
            } catch (err) {
              toast(errorText(err), 'error')
            }
          }}
        >
          保存
        </Button>
        <Button
          busy={testing}
          disabled={!settings?.hasApiKey}
          onClick={async () => {
            setTesting(true)
            try {
              setResult(await api.settings.testConnection())
            } finally {
              setTesting(false)
            }
          }}
        >
          测试连接
        </Button>
      </div>
      {result && (
        <span className={`mt-1.5 block text-xs ${result.ok ? 'text-good-ink' : 'text-bad-ink'}`}>
          {result.message}
        </span>
      )}
    </Field>
  )
}

function LlmSection(): React.JSX.Element {
  const s = useSection('llm')
  const d = s.draft
  return (
    <Panel title="DeepSeek" subtitle="生成音标、释义、例句和翻译；也用于导入和查词时的智能整理">
      <ApiKeyField />
      <Field
        label="Base URL"
        hint="OpenAI 兼容接口；换成其他服务（通义、Kimi、本地 Ollama）时改这里和模型名。"
      >
        <TextInput value={d.baseUrl} onChange={(e) => s.set('baseUrl', e.target.value)} />
      </Field>
      <Field label="模型">
        <TextInput
          value={d.model}
          onChange={(e) => s.set('model', e.target.value)}
          className="!w-60"
        />
      </Field>
      <Field label="每批词数" hint="一次请求生成几个词。太大容易被截断，程序会自动拆小重试。">
        <NumberInput value={d.batchSize} min={1} max={20} onChange={(v) => s.set('batchSize', v)} />
      </Field>
      <Field label="同时请求数">
        <NumberInput
          value={d.concurrency}
          min={1}
          max={10}
          onChange={(v) => s.set('concurrency', v)}
        />
      </Field>
      <Field label="每词最多义项" hint="每个义项都会单独成为一张复习卡。">
        <NumberInput value={d.maxSenses} min={1} max={6} onChange={(v) => s.set('maxSenses', v)} />
      </Field>
      <Field
        label="导入和查词时智能整理"
        hint="自动找出复数、过去式、拼写错误和专有名词：导入时给出合并建议，查词时改查原形和正确拼写。"
      >
        <Toggle
          checked={d.smartCleanup}
          onChange={(v) => s.set('smartCleanup', v)}
          label="导入和查词时智能整理"
        />
      </Field>
      <SaveBar dirty={s.dirty} onSave={s.save} />
    </Panel>
  )
}

function StudySection(): React.JSX.Element {
  const s = useSection('study')
  // The step lists are edited as text ("1m 10m") and parsed on every keystroke.
  const [learning, setLearning] = useState(() => s.draft.learningSteps.join(' '))
  const [relearning, setRelearning] = useState(() => s.draft.relearningSteps.join(' '))
  const d = s.draft
  const steps = (text: string): string[] => text.split(/[\s,，]+/).filter(Boolean)
  return (
    <Panel
      title="学习与复习"
      subtitle="复习时间由 FSRS 遗忘曲线算法安排：预测回忆率降到目标记忆率时，这张卡就到期"
    >
      <Field label="每日新卡" hint="按卡片（义项）计算；同一个词每天最多出现一张卡。">
        <NumberInput
          value={d.newPerDay}
          min={0}
          max={500}
          onChange={(v) => s.set('newPerDay', v)}
        />
      </Field>
      <Field label="每日复习上限">
        <NumberInput
          value={d.reviewsPerDay}
          min={0}
          max={5000}
          onChange={(v) => s.set('reviewsPerDay', v)}
        />
      </Field>
      <Field label="目标记忆率" hint="越高复习越频繁、越不容易忘；0.90 是常用的平衡点。">
        <div className="flex items-center gap-3 pt-1.5">
          <input
            type="range"
            min={0.8}
            max={0.97}
            step={0.01}
            value={d.retention}
            onChange={(e) => s.set('retention', Number(e.target.value))}
            className="w-64 accent-[var(--accent)]"
          />
          <span className="w-12 text-sm font-medium tabular">{Math.round(d.retention * 100)}%</span>
        </div>
      </Field>
      <Field label="学习步骤" hint="新卡在当天再出现的间隔，例如 1m 10m（m 分钟，h 小时，d 天）。">
        <TextInput
          value={learning}
          onChange={(e) => {
            setLearning(e.target.value)
            s.set('learningSteps', steps(e.target.value))
          }}
          className="!w-60"
        />
      </Field>
      <Field label="重学步骤" hint="复习时忘记了的卡，当天再出现的间隔。">
        <TextInput
          value={relearning}
          onChange={(e) => {
            setRelearning(e.target.value)
            s.set('relearningSteps', steps(e.target.value))
          }}
          className="!w-60"
        />
      </Field>
      <Field label="最长间隔（天）">
        <NumberInput
          value={d.maxIntervalDays}
          min={1}
          max={36500}
          onChange={(v) => s.set('maxIntervalDays', v)}
        />
      </Field>
      <Field label="每天从几点开始" hint="凌晨学习也算前一天。">
        <Select
          value={d.dayStartHour}
          onChange={(e) => s.set('dayStartHour', Number(e.target.value))}
          className="!w-32"
        >
          {Array.from({ length: 24 }, (_, h) => (
            <option key={h} value={h}>
              {String(h).padStart(2, '0')}:00
            </option>
          ))}
        </Select>
      </Field>
      <Field label="新卡顺序">
        <Select
          value={d.newOrder}
          onChange={(e) => s.set('newOrder', e.target.value as AppSettings['study']['newOrder'])}
          className="!w-72"
        >
          <option value="primary-first">先学每个词最常用的义项（推荐）</option>
          <option value="by-word">一个词的义项连着学（每天一个）</option>
        </Select>
      </Field>
      <SaveBar dirty={s.dirty} onSave={s.save} />
    </Panel>
  )
}

function DisplaySection(): React.JSX.Element {
  const s = useSection('display')
  const voices = useEnglishVoices()
  const d = s.draft
  return (
    <Panel title="显示与发音">
      <Field label="中文翻译" hint="英文优先：默认折叠，点一下才显示。">
        <Select
          value={d.chineseDisplay}
          onChange={(e) =>
            s.set('chineseDisplay', e.target.value as AppSettings['display']['chineseDisplay'])
          }
          className="!w-48"
        >
          <option value="tap">点击后显示</option>
          <option value="always">总是显示</option>
          <option value="never">不显示</option>
        </Select>
      </Field>
      <Field label="自动发音" hint="新卡介绍和揭晓答案时自动朗读。">
        <Toggle checked={d.autoSpeak} onChange={(v) => s.set('autoSpeak', v)} label="自动发音" />
      </Field>
      <Field
        label="发音人"
        hint={
          voices.length === 0
            ? '没有找到英文语音：在系统设置里添加（Windows：设置 → 时间和语言 → 语音）。'
            : '使用系统自带的语音，离线可用。'
        }
      >
        <div className="flex gap-2">
          <Select
            value={d.voice}
            onChange={(e) => s.set('voice', e.target.value)}
            className="!w-72"
          >
            <option value="">自动（美式英语）</option>
            {voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}（{v.lang}）
              </option>
            ))}
          </Select>
          <Button
            icon={<Volume2 size={15} />}
            onClick={() =>
              speak('The quick brown fox jumps over the lazy dog.', {
                voice: d.voice,
                speechRate: d.speechRate
              })
            }
          >
            试听
          </Button>
        </div>
      </Field>
      <Field label="语速">
        <div className="flex items-center gap-3 pt-1.5">
          <input
            type="range"
            min={0.6}
            max={1.3}
            step={0.05}
            value={d.speechRate}
            onChange={(e) => s.set('speechRate', Number(e.target.value))}
            className="w-64 accent-[var(--accent)]"
          />
          <span className="w-12 text-sm tabular">{d.speechRate.toFixed(2)}×</span>
        </div>
      </Field>
      <SaveBar dirty={s.dirty} onSave={s.save} />
    </Panel>
  )
}

function DataSection(): React.JSX.Element {
  const { settings, toast } = useApp()
  const backups = useAsync(() => api.data.listBackups(), [])
  const [busy, setBusy] = useState<string | null>(null)
  const [persisted, setPersisted] = useState<boolean | null>(null)
  const restoreInput = useRef<HTMLInputElement>(null)
  const storage = settings?.storage
  // In a browser the data can be cleared under storage pressure unless it was made persistent.
  useEffect(() => {
    if (storage?.kind !== 'browser') return
    void navigator.storage?.persisted?.().then(setPersisted)
  }, [storage?.kind])
  const act = async (
    name: string,
    fn: () => Promise<string | null | void>,
    done: (r: string | null | void) => string | null
  ): Promise<void> => {
    setBusy(name)
    try {
      const r = await fn()
      const message = done(r)
      if (message) toast(message)
    } catch (err) {
      toast(errorText(err), 'error')
    } finally {
      setBusy(null)
    }
  }
  // The save dialog or share sheet is the feedback here; only failures get a toast.
  const save = (name: string, make: () => Promise<ExportFile>): Promise<void> =>
    act(
      name,
      async () => saveFile(await make()),
      () => null
    )
  const restoreFile = async (file: File): Promise<void> => {
    if (
      !window.confirm(
        `用「${file.name}」替换现在的全部数据？当前数据会先另存一份备份，然后应用会重新启动。`
      )
    ) {
      return
    }
    await act(
      'restoreFile',
      async () => api.data.restoreFile(new Uint8Array(await file.arrayBuffer())),
      () => null
    )
  }
  return (
    <Panel title="数据" subtitle="所有数据都在本机一个 SQLite 文件里；每天第一次打开时自动备份">
      {storage?.kind === 'browser' && (
        <div className="mb-2">
          <Notice tone="warn" icon={<TriangleAlert size={16} className="shrink-0" />}>
            数据只保存在这台设备的 Wordloom 里，不会同步到别处。从主屏幕删除 Wordloom
            会同时删除全部数据，Safari
            里打开的网页版也是另外一份数据。请不时「导出数据库文件」存到「文件」里。
            {persisted === false && '浏览器还没有允许持久保存，存储空间紧张时数据可能被清除。'}
          </Notice>
        </div>
      )}
      {storage?.kind === 'folder' && (
        <Field label="数据目录">
          <div className="flex gap-2">
            <TextInput value={storage.path} readOnly />
            <Button icon={<FolderOpen size={15} />} onClick={() => api.data.openFolder()}>
              打开
            </Button>
          </div>
        </Field>
      )}
      <Field label="备份" buttons>
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button
              icon={<HardDriveDownload size={15} />}
              busy={busy === 'backup'}
              onClick={() =>
                act(
                  'backup',
                  async () => {
                    await api.data.backupNow()
                    backups.reload()
                  },
                  () => '已备份'
                )
              }
            >
              立即备份
            </Button>
            <Button
              icon={<ArchiveRestore size={15} />}
              busy={busy === 'restoreFile'}
              onClick={() => restoreInput.current?.click()}
            >
              从文件恢复…
            </Button>
            {/* No accept filter: iOS greys out file types it cannot name, and .db is one. */}
            <input
              ref={restoreInput}
              type="file"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void restoreFile(file)
              }}
            />
          </div>
          {backups.data && backups.data.length > 0 && (
            <div className="max-h-56 overflow-auto rounded-lg border border-[var(--border)]">
              {backups.data.map((b) => (
                <div
                  key={b.file}
                  className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-1.5 text-xs last:border-0"
                >
                  <span className="truncate font-mono">{b.name}</span>
                  <span className="shrink-0 text-ink-2 tabular">
                    {formatDateTime(b.createdAt)} · {formatBytes(b.size)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (
                        window.confirm(
                          `用备份「${b.name}」替换现在的全部数据？当前数据会先另存一份备份，然后应用会重新启动。`
                        )
                      ) {
                        void act(
                          'restore',
                          () => api.data.restore(b.file),
                          () => null
                        )
                      }
                    }}
                  >
                    恢复
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Field>
      <Field
        label="导出"
        hint="数据库文件就是完整备份，可以在另一台设备上用「从文件恢复」打开。"
        buttons
      >
        <div className="flex flex-wrap gap-2">
          <Button
            icon={<FileDown size={15} />}
            busy={busy === 'db'}
            onClick={() => save('db', () => api.data.exportDatabase())}
          >
            导出数据库文件
          </Button>
          <Button
            icon={<Download size={15} />}
            busy={busy === 'json'}
            onClick={() => save('json', () => api.data.exportJson())}
          >
            导出 JSON（完整）
          </Button>
          <Button
            icon={<Database size={15} />}
            busy={busy === 'csv'}
            onClick={() => save('csv', () => api.data.exportCsv())}
          >
            导出 CSV（可用 Excel 打开）
          </Button>
        </div>
      </Field>
    </Panel>
  )
}

export default function SettingsPage(): React.JSX.Element {
  const { settings } = useApp()
  return (
    <Page>
      <PageHeader title="设置" />
      {!settings ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-5">
          <LlmSection key={JSON.stringify(settings.settings.llm)} />
          <StudySection key={JSON.stringify(settings.settings.study)} />
          <DisplaySection key={JSON.stringify(settings.settings.display)} />
          <DataSection />
        </div>
      )}
    </Page>
  )
}
