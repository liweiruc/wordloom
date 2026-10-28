// Draws the app icon and writes build/icon.png, build/icon.ico and resources/icon.png.
// Run with Electron so the canvas has a real font renderer:  npx electron scripts/make-icon.cjs
const { app, BrowserWindow } = require('electron')
const { writeFileSync } = require('fs')
const { join } = require('path')

const root = join(__dirname, '..')
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512]

// An amber tile, a white W, and under it the blank of a cloze card.
const draw = `
  window.drawIcon = (size) => {
    const c = document.createElement('canvas')
    c.width = c.height = size
    const g = c.getContext('2d')
    const r = size * 0.22
    const grad = g.createLinearGradient(0, 0, 0, size)
    grad.addColorStop(0, '#c07a16')
    grad.addColorStop(1, '#94590a')
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(r, 0); g.arcTo(size, 0, size, size, r); g.arcTo(size, size, 0, size, r)
    g.arcTo(0, size, 0, 0, r); g.arcTo(0, 0, size, 0, r); g.closePath(); g.fill()
    g.fillStyle = '#ffffff'
    g.textAlign = 'center'
    g.textBaseline = 'alphabetic'
    g.font = '700 ' + Math.round(size * 0.58) + 'px "Segoe UI", system-ui, sans-serif'
    g.fillText('W', size / 2, size * 0.66)
    g.fillStyle = 'rgba(255,255,255,0.85)'
    const w = size * 0.5, h = Math.max(1, Math.round(size * 0.06))
    g.fillRect((size - w) / 2, size * 0.76, w, h)
    return c.toDataURL('image/png')
  }
  true
`

// ICO with PNG-compressed entries (supported since Windows Vista).
function ico(pngs) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(pngs.length, 4)
  const dir = Buffer.alloc(16 * pngs.length)
  let offset = 6 + dir.length
  pngs.forEach(({ size, data }, i) => {
    const e = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, e)
    dir.writeUInt8(size >= 256 ? 0 : size, e + 1)
    dir.writeUInt8(0, e + 2)
    dir.writeUInt8(0, e + 3)
    dir.writeUInt16LE(1, e + 4)
    dir.writeUInt16LE(32, e + 6)
    dir.writeUInt32LE(data.length, e + 8)
    dir.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([header, dir, ...pngs.map((p) => p.data)])
}

// Never hang: a failure anywhere ends the process instead of leaving a hidden app running.
setTimeout(() => {
  console.error('timed out')
  app.exit(1)
}, 30_000)

app
  .whenReady()
  .then(async () => {
    const win = new BrowserWindow({ show: false })
    await win.loadURL('about:blank')
    await win.webContents.executeJavaScript(draw)
    const pngs = []
    for (const size of SIZES) {
      const url = await win.webContents.executeJavaScript(`drawIcon(${size})`)
      pngs.push({ size, data: Buffer.from(url.split(',')[1], 'base64') })
    }
    const bySize = (s) => pngs.find((p) => p.size === s).data
    writeFileSync(join(root, 'build', 'icon.png'), bySize(512))
    writeFileSync(join(root, 'resources', 'icon.png'), bySize(256))
    writeFileSync(join(root, 'build', 'icon.ico'), ico(pngs.filter((p) => p.size <= 256)))
    console.log('wrote build/icon.png, build/icon.ico, resources/icon.png')
    app.exit(0)
  })
  .catch((err) => {
    console.error(err)
    app.exit(1)
  })
