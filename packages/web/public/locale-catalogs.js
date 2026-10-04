import en from './locales/en.js';
import ja from './locales/ja.js';

// Register another catalog here; the selector and preference matching use this list.
export const localeCatalogs = [
  { id: 'en', name: 'English', messages: en },
  { id: 'ja', name: '日本語', messages: ja },
];
