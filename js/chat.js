import { CHAT } from './config.js';

// Pure chat rules (testable in Node). DOM/scene wiring lives in main.js.

export function canSend(lastSentAt, now) {
  return now - lastSentAt >= CHAT.minGapMs;
}

export function formatChat(name, text) {
  return {
    name: name.trim(),
    text: text.trim().replace(/[<>]/g, '').slice(0, CHAT.maxChars),
  };
}

// Renders an incoming chat message. hooks: { findGroup(id), showFloating(group, text), appendLine(text) }.
// Panel is GLOBAL (M8 decision): the panel line is written even for
// players too far to have a visible group (>60 m interest radius),
// so distant chat is never silently lost. The floating bubble above
// a head still requires a visible group — a bubble needs a head to
// float over. Sanitization and empty-text rules are unchanged.
export function receiveChat(msg, hooks) {
  const clean = formatChat(msg.name || 'Petualang', msg.text || '');
  if (!clean.text) return;
  hooks.appendLine(`${clean.name}: ${clean.text}`);
  const group = hooks.findGroup(msg.id);
  if (group) hooks.showFloating(group, clean.text);
}
