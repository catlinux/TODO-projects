/// <reference types="vite/client" />

/*
 * La Web Speech API solo está a medias en `lib.dom`: faltan el objeto de
 * reconocimiento y sus eventos. Se declaran aquí los mínimos que necesita el
 * dictado por voz (`src/voz.ts`).
 */

interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
  readonly message: string;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((evento: SpeechRecognitionEvent) => void) | null;
  onerror: ((evento: SpeechRecognitionErrorEvent) => void) | null;
  onend: ((evento: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

interface Window {
  SpeechRecognition?: new () => SpeechRecognition;
  webkitSpeechRecognition?: new () => SpeechRecognition;
}
