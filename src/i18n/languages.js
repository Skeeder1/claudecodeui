export const languages = [
  {
    value: 'en',
    label: 'English',
    nativeName: 'English',
  },
  {
    value: 'ko',
    label: 'Korean',
    nativeName: '한국어',
  },
  {
    value: 'zh-CN',
    label: 'Simplified Chinese',
    nativeName: '简体中文',
  },
  {
    value: 'ja',
    label: 'Japanese',
    nativeName: '日本語',
  },
  {
    value: 'ru',
    label: 'Russian',
    nativeName: 'Русский',
  },
  {
    value: 'de',
    label: 'German',
    nativeName: 'Deutsch',
  },
  {
    value: 'tr',
    label: 'Turkish',
    nativeName: 'Türkçe',
  },
  {
    value: 'it',
    label: 'Italian',
    nativeName: 'Italiano',
  },
];

export const getLanguage = (value) => {
  return languages.find(lang => lang.value === value);
};

export const getLanguageValues = () => {
  return languages.map(lang => lang.value);
};

export const isLanguageSupported = (value) => {
  return languages.some(lang => lang.value === value);
};
