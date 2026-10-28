# Wordloom

自用的 Windows 背单词应用：导入单词文件 → DeepSeek 生成词条 → 挖空拼写复习，复习时间由 FSRS 遗忘曲线安排 → 统计。

- **导入**：txt / md / csv 或直接粘贴；自动识别编码（UTF-8、UTF-16、GBK）和格式（词典单词本导出、逐行词表、文章）。只提取词头，原文件里的释义一概不用。粘贴的文本默认导入「生词本」。
- **智能整理**（可选）：DeepSeek 找出复数、过去式、拼写错误、写法变体和专有名词，给出合并建议（thresholds → threshold，harrass → harass）。
- **生成词条**：英/美音标、词性、语域，每个词 1–4 个常用义项；每个义项一句日常英文释义（不出现这个词本身）、最多 3 个近义词（没有真正的近义词就不给）、一个例句，释义和例句都有中文翻译。生成在后台进行，生成好的词立即可学。
- **查词**：输入一个新词，DeepSeek 用和词库完全相同的 prompt 与检查生成词条；先做智能整理（struck 按 strike 查，也可以按原样查）。词库里已有的词和查过的词直接显示，不再调用模型。一键加入「生词本」：直接用这份词条复习、不会重新生成，并且比其他新词先学。
- **背单词**：显示英文释义、近义词和挖空例句（例句用斜体），键入缺少的词（要写出句子需要的形式，如 struck）。每个义项一张卡，同一个词一天只出一张卡。
- **统计**：今日概况、卡片状态、真实保持率、每日复习量、首答正确率、学习日历、未来到期预测、记忆稳定度分布、难词榜、词表进度，以及每张卡自己的遗忘曲线。

## 使用

1. 安装 `dist\wordloom-<版本>-setup.exe`，或直接运行便携版 `dist\wordloom-<版本>-portable.exe`。程序未签名，Windows 首次运行会提示「已保护你的电脑」，点「更多信息 → 仍要运行」。
2. 打开「设置」，填入 DeepSeek API key（在 platform.deepseek.com 创建），点「测试连接」。key 用 Windows DPAPI 加密后存在本机，不会写进任何文件明文。
3. 「导入」选择单词文件，检查预览后点「导入」。左下角显示生成进度。
4. 「复习」→「开始学习」。

### 学习时的快捷键

| 场景     | 按键                                                                      |
| -------- | ------------------------------------------------------------------------- |
| 新卡介绍 | Enter 记住了开始测试 · K 我已经会了 · P 发音                              |
| 挖空作答 | Enter 提交 · Ctrl+H 提示（先中文释义，再首字母和长度）· Ctrl+G 不知道     |
| 揭晓答案 | Enter 接受建议评分 · 1–4 重来/困难/良好/简单 · P 发音 · Ctrl+Z 撤销上一张 |
| 任何时候 | Esc 结束本轮                                                              |

建议评分：答对且没用提示 = 良好；用了提示、拼写差一点或词形不对 = 困难；答错或不知道 = 重来。「简单」由自己按。

### 复习是怎么安排的

- 调度用 FSRS（ts-fsrs，FSRS-6）：每张卡有自己的遗忘曲线，预测回忆率降到「目标记忆率」（默认 90%）时到期。
- 新卡当天按学习步骤（默认 1 分钟、10 分钟）再出现；忘记的卡按重学步骤（默认 10 分钟）再出现。
- 新卡默认先学每个词最常用的义项，同级随机，避免字母表里挨着的相似词挤在一起。
- 「一天」从凌晨 4 点开始（可改）。今天到期的卡任何时候都可以学，不必等到它的具体时刻。

## 数据

- 数据库：`%APPDATA%\wordloom\wordloom.db`（SQLite）。每天第一次启动自动备份到 `backups\`，保留 14 份；「设置 → 数据」可以立即备份、从备份恢复、导出 JSON / CSV。
- 环境变量 `WORDLOOM_DATA_DIR` 可以把数据放到别的目录（便携使用或测试）。

## 开发

需要 Node.js 24。不需要 Python 或 VS C++ 构建工具：better-sqlite3 13 自带 Windows 预编译的 N-API 二进制。

```powershell
npm install
npm run dev          # 开发模式（热更新）
npm test             # 单元测试（Vitest）
npm run typecheck
npm run lint
npm run build:win    # 打包：dist\ 下的安装包和便携版
```

其他脚本：

- `npm run smoke:llm`：用真实 DeepSeek 跑一遍整理和生成，打印每个词条和校验结果。先设置 `$env:DEEPSEEK_API_KEY = 'sk-…'`。
- `npm run e2e -- <截图目录>`：先 `npm run build`，再用 Playwright 驱动整个应用（导入、学习、词库、查词、统计、设置、深色模式）并截图；数据放在临时目录，不碰真实数据。设置 `E2E_EXECUTABLE=dist\win-unpacked\Wordloom.exe` 可测试打包后的程序。
- `npm run icon`：重新生成应用图标。

### 代码结构

```
src/main/        Electron 主进程：数据库、导入解析、DeepSeek 生成队列、FSRS 调度、统计
  db/            SQLite 连接、迁移（PRAGMA user_version）、设置与加密的 API key
  import/        解码、格式识别与解析、规范化、写入词表
  llm/           DeepSeek 客户端、prompt、JSON 校验与修复、后台生成队列、智能整理
  library/       词库查询与编辑
  lookup/        查词：先找词库和查过的词，否则整理 + 生成并保存；加入生词本
  srs/           ts-fsrs 封装、每日队列（同词互斥、穿插）、学习会话（含撤销）
  stats/         仪表盘统计、单卡遗忘曲线
  data/          备份、导出
src/preload/     contextBridge：只暴露类型化的 window.api
src/shared/      两端共用：类型、IPC 契约、挖空定位、答案判定、词形还原
src/renderer/    React 界面：查词、复习、学习、词库、单词详情、导入、统计、设置
tests/           Vitest 单元测试（样例 tests/fixtures/20261025.txt）
scripts/         LLM 冒烟、端到端测试、图标生成
```
