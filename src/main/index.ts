import { app, BrowserWindow, Menu, nativeTheme, safeStorage, shell } from 'electron'
import { join } from 'path'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { openDatabase } from './db/connection'
import { hasApiKey, loadApiKey, saveApiKey, type SecretCodec } from './db/settings'
import { createFileStore } from './data/fileStore'
import { registerIpc } from './ipc'
import { createServices } from './services'

// The API key is encrypted with Windows DPAPI, so the database file alone does not reveal
// it. If encryption is unavailable the key is stored encoded but readable, marked as such.
const codec: SecretCodec = {
  encrypt(plain) {
    if (safeStorage.isEncryptionAvailable()) {
      return 'dpapi:' + safeStorage.encryptString(plain).toString('base64')
    }
    return 'plain:' + Buffer.from(plain, 'utf8').toString('base64')
  },
  decrypt(stored) {
    if (stored.startsWith('dpapi:'))
      return safeStorage.decryptString(Buffer.from(stored.slice(6), 'base64'))
    if (stored.startsWith('plain:')) return Buffer.from(stored.slice(6), 'base64').toString('utf8')
    throw new Error('unknown secret format')
  }
}

let mainWindow: BrowserWindow | null = null

// End-to-end tests (and portable setups) can point the app at another data folder.
if (process.env['WORDLOOM_DATA_DIR']) app.setPath('userData', process.env['WORDLOOM_DATA_DIR'])

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'Wordloom',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#171614' : '#f6f5f2',
    icon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      // Underlining a half-typed answer as misspelled would be a hint.
      spellcheck: false
    }
  })
  win.on('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(async () => {
    electronApp.setAppUserModelId('com.wordloom.app')
    // No menu bar. On Windows the editing shortcuts still work in text fields, and Ctrl+Z
    // reaches the page, where it undoes the last rating.
    Menu.setApplicationMenu(null)
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    const dataDir = app.getPath('userData')
    const dbFile = join(dataDir, 'wordloom.db')
    const db = openDatabase(dbFile)
    const services = createServices({
      db,
      store: createFileStore(db, dbFile, dataDir, async (path) => {
        await shell.openPath(path)
      }),
      secrets: {
        has: () => hasApiKey(db),
        load: () => loadApiKey(db, codec),
        save: (key) => saveApiKey(db, codec, key)
      },
      platform: {
        send(channel, payload) {
          if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload)
        },
        relaunch() {
          app.relaunch()
          app.exit(0)
        }
      }
    })
    registerIpc(services.api)
    mainWindow = createWindow()
    app.on('before-quit', () => services.shutdown())
    await services.start()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
