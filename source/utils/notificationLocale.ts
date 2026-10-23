import de from 'assets/locales/de.json?notificationMessages';
import en from 'assets/locales/en.json?notificationMessages';
import es from 'assets/locales/es.json?notificationMessages';
import fr from 'assets/locales/fr.json?notificationMessages';
import ja from 'assets/locales/ja.json?notificationMessages';
import ko from 'assets/locales/ko.json?notificationMessages';
import pt from 'assets/locales/pt.json?notificationMessages';
import ru from 'assets/locales/ru.json?notificationMessages';
import zh from 'assets/locales/zh.json?notificationMessages';
import { chromeStorage } from 'utils/storageAPI';

const catalogs: Record<string, typeof en> = {
  en,
  es,
  pt,
  fr,
  de,
  zh,
  ja,
  ko,
  ru,
};

// Plain-text OS notifications have no React/document and no HTML interpolation.
// Read the saved wallet preference without writing or caching a stale choice.
export const getNotificationTranslator = async () => {
  let language: unknown;
  try {
    language = await chromeStorage.getItem('language');
  } catch {
    // Failure to read preferences must not suppress an otherwise valid notice.
  }
  const catalog =
    typeof language === 'string' &&
    Object.prototype.hasOwnProperty.call(catalogs, language)
      ? catalogs[language]
      : en;
  return (key: string, values: Record<string, unknown> = {}): string => {
    const field = key.replace(/^notifications\./, '');
    const text = Object.prototype.hasOwnProperty.call(
      catalog.notifications,
      field
    )
      ? catalog.notifications[field]
      : Object.prototype.hasOwnProperty.call(en.notifications, field)
      ? en.notifications[field]
      : key;
    return text.replace(/{{(\w+)}}/g, (placeholder, name) =>
      Object.prototype.hasOwnProperty.call(values, name)
        ? String(values[name])
        : placeholder
    );
  };
};
