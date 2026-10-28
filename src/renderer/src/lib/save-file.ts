import type { ExportFile } from '../../../shared/types'

/**
 * Hands a file to the person. On a touch device that can share files (the iPad) this is the
 * share sheet, with 存储到"文件", AirDrop and the like; everywhere else it is a download,
 * which Electron turns into its Save dialog.
 */
export async function saveFile(file: ExportFile): Promise<void> {
  const blob = new File([file.data as BlobPart], file.name, { type: file.mime })
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [blob] })) {
    try {
      await navigator.share({ files: [blob] })
      return
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return
      // Sharing was refused (e.g. the tap that asked for it is too long ago): download it.
    }
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
