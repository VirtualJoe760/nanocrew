// The selectable AI consultants. One source of truth: the client renders the roster and
// the voice route allowlists TTS against it (arbitrary voice ids would be a cost hole).

export type AiVoice = {
  id: string; // ElevenLabs voice id
  name: string; // the AI's Nano Crew identity
  vibe: string; // one-line character for the selection card
};

export const AI_VOICES: AiVoice[] = [
  { id: 'pFZP5JQG7iQjIQuC4Bku', name: 'Venus', vibe: 'warm · british · believes in you' },
  { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Jarvis', vibe: 'precise · british · mission control' },
  { id: '1cuDPO8sIMatoOE4Z2Zv', name: 'Nova', vibe: 'bright · electric · first light' },
  { id: '1SM7GgM6IMuvQlz2BwM3', name: 'Sol', vibe: 'calm · steady · golden hour' },
  { id: 'uYXf8XasLslADfZ2MB4u', name: 'Lyra', vibe: 'smooth · cosmic · night signal' },
];

export const DEFAULT_VOICE = AI_VOICES[0];

export function resolveVoice(id?: string | null): AiVoice {
  return AI_VOICES.find((v) => v.id === id) ?? DEFAULT_VOICE;
}
