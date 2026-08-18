// ROLLING TRANSCRIPT — the last few live-conversation turns, published by eve-home so sibling
// surfaces (EveDesign's ✦ Enhance) can fold Eve's own suggestions into what they build.
// Read-at-need; no subscriptions required.
export type TranscriptLine = { role: 'user' | 'assistant'; text: string };

let recent: TranscriptLine[] = [];

export function publishTranscript(lines: TranscriptLine[]): void {
  recent = lines.slice(-10);
}
export function recentTranscript(): TranscriptLine[] {
  return recent;
}
