import { createPrivacyServiceSettings } from '../../shared/privacyServiceOrigin.ts';
import { chromeStorage } from 'utils/storageAPI';

export {
  DEFAULT_PRIVACY_SERVICE_ORIGIN,
  normalizePrivacyServiceOrigin,
} from '../../shared/privacyServiceOrigin.ts';

const settings = createPrivacyServiceSettings({
  read: async (key) => (await chromeStorage.getItems([key]))[key],
  write: (key, origin) => chromeStorage.setItem(key, origin),
});

export const privacyServiceRevision = settings.getRevision;
export const assertPrivacyServiceStable = settings.assertStable;
export const getPrivacyServiceOrigin = settings.getOrigin;
export const changePrivacyServiceOrigin = settings.changeOrigin;
export const capturePrivacyService = settings.capture;
