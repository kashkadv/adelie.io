import type messages from '../../messages/en.json';
import type { Locale } from './config';

// English is the source of truth: using a missing key is a type error.
declare module 'next-intl' {
  interface AppConfig {
    Locale: Locale;
    Messages: typeof messages;
  }
}
