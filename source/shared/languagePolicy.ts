export const PALI_LANGUAGE_OPTIONS = Object.freeze([
  { name: 'English', nativeName: 'English', value: 'en', flag: '🇺🇸' },
  { name: 'Spanish', nativeName: 'Español', value: 'es', flag: '🇪🇸' },
  { name: 'Portuguese', nativeName: 'Português', value: 'pt', flag: '🇧🇷' },
  { name: 'French', nativeName: 'Français', value: 'fr', flag: '🇫🇷' },
  { name: 'German', nativeName: 'Deutsch', value: 'de', flag: '🇩🇪' },
  { name: 'Chinese', nativeName: '中文', value: 'zh', flag: '🇨🇳' },
  { name: 'Japanese', nativeName: '日本語', value: 'ja', flag: '🇯🇵' },
  { name: 'Korean', nativeName: '한국어', value: 'ko', flag: '🇰🇷' },
  { name: 'Russian', nativeName: 'Русский', value: 'ru', flag: '🇷🇺' },
] as const);
export type PaliLanguage = (typeof PALI_LANGUAGE_OPTIONS)[number]['value'];
export const DEFAULT_PALI_LANGUAGE: PaliLanguage = 'en';
export const isPaliLanguage = (value: unknown): value is PaliLanguage =>
  PALI_LANGUAGE_OPTIONS.some((language) => language.value === value);
