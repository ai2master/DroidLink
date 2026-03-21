import { describe, it, expect } from 'vitest';
import en from './locales/en.json';
import zh from './locales/zh.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import de from './locales/de.json';
import ru from './locales/ru.json';
import ar from './locales/ar.json';

// Recursively extract all leaf keys from a nested object
function getLeafKeys(obj: Record<string, unknown>, prefix = ''): string[] {
  const keys: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(...getLeafKeys(value as Record<string, unknown>, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys.sort();
}

const locales: Record<string, Record<string, unknown>> = { en, zh, ja, ko, de, ru, ar };
const enKeys = getLeafKeys(en);

describe('i18n locale completeness', () => {
  it('english locale has keys', () => {
    expect(enKeys.length).toBeGreaterThan(10);
  });

  for (const [lang, data] of Object.entries(locales)) {
    if (lang === 'en') continue;

    it(`${lang} has all keys from en`, () => {
      const langKeys = getLeafKeys(data);
      const missing = enKeys.filter(k => !langKeys.includes(k));
      expect(missing).toEqual([]);
    });

    it(`${lang} has no extra keys not in en`, () => {
      const langKeys = getLeafKeys(data);
      const extra = langKeys.filter(k => !enKeys.includes(k));
      expect(extra).toEqual([]);
    });
  }

  it('no locale has empty string values', () => {
    for (const [lang, data] of Object.entries(locales)) {
      const keys = getLeafKeys(data);
      for (const key of keys) {
        const parts = key.split('.');
        let val: unknown = data;
        for (const part of parts) {
          val = (val as Record<string, unknown>)[part];
        }
        expect(val, `${lang}.${key} should not be empty`).not.toBe('');
      }
    }
  });
});
