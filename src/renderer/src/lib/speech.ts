import { useEffect, useState } from 'react'

// Pronunciation comes from the system's own voices: those installed in Windows (Zira, David,
// Mark for US English), or the iPad's. Nothing is sent anywhere, and it works offline.

export function englishVoices(): SpeechSynthesisVoice[] {
  if (!('speechSynthesis' in window)) return []
  return window.speechSynthesis.getVoices().filter((v) => v.lang.toLowerCase().startsWith('en'))
}

export function useEnglishVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState(englishVoices)
  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    const update = (): void => setVoices(englishVoices())
    window.speechSynthesis.addEventListener('voiceschanged', update)
    update()
    return () => window.speechSynthesis.removeEventListener('voiceschanged', update)
  }, [])
  return voices
}

export function speak(text: string, options: { voice: string; speechRate: number }): void {
  if (!('speechSynthesis' in window) || !text.trim()) return
  const synth = window.speechSynthesis
  synth.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  const voices = englishVoices()
  const voice =
    voices.find((v) => v.name === options.voice) ??
    voices.find((v) => v.lang === 'en-US') ??
    voices[0]
  if (voice) {
    utterance.voice = voice
    utterance.lang = voice.lang
  } else {
    utterance.lang = 'en-US'
  }
  utterance.rate = options.speechRate
  synth.speak(utterance)
}
