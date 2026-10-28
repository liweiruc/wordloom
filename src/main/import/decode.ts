import iconv from 'iconv-lite'

// Word lists saved on Chinese Windows are often GBK rather than UTF-8. A byte-order mark
// settles it; otherwise strict UTF-8 is tried first, because a GB18030 decode accepts
// almost any bytes and would quietly garble a real UTF-8 file.
export function decodeText(buf: Buffer): { text: string; encoding: string } {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString('utf8'), encoding: 'UTF-8 (BOM)' }
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: iconv.decode(buf.subarray(2), 'utf16le'), encoding: 'UTF-16 LE' }
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    return { text: iconv.decode(buf.subarray(2), 'utf16be'), encoding: 'UTF-16 BE' }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'UTF-8' }
  } catch {
    return { text: iconv.decode(buf, 'gb18030'), encoding: 'GB18030' }
  }
}
