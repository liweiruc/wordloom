// Word lists saved on Chinese Windows are often GBK rather than UTF-8. A byte-order mark
// settles it; otherwise strict UTF-8 is tried first, because a GB18030 decode accepts
// almost any bytes and would quietly garble a real UTF-8 file. TextDecoder knows all of
// these encodings in Chromium, Safari and Node, so a file is decoded where it was picked.
export function decodeText(bytes: Uint8Array): { text: string; encoding: string } {
  const decode = (label: string, skip = 0): string =>
    new TextDecoder(label).decode(bytes.subarray(skip))
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: decode('utf-8', 3), encoding: 'UTF-8 (BOM)' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: decode('utf-16le', 2), encoding: 'UTF-16 LE' }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: decode('utf-16be', 2), encoding: 'UTF-16 BE' }
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'UTF-8' }
  } catch {
    return { text: decode('gb18030'), encoding: 'GB18030' }
  }
}
