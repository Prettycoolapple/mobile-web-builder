/** Canonical list values stay in English for API/storage; UI label may differ by OS locale. */
const CHINESE_ENTRY_DISPLAY: Record<string, { nonZhOS: string; zhOS: string }> = {
  "Chinese (Cantonese)": { nonZhOS: "Chinese (Cantonese)", zhOS: "中文（粤语）" },
  "Chinese (Mandarin)": { nonZhOS: "Chinese (Mandarin)", zhOS: "中文（普通话）" },
  "Chinese (Traditional)": { nonZhOS: "Chinese (Traditional)", zhOS: "繁体中文" },
};

/**
 * Signup language pickers: show English "Chinese (…)" when the device OS is not Chinese,
 * and short Chinese script labels when the OS primary locale is Chinese.
 */
export function languageDisplayName(canonical: string, osIsChinese: boolean): string {
  const row = CHINESE_ENTRY_DISPLAY[canonical];
  if (!row) return canonical;
  return osIsChinese ? row.zhOS : row.nonZhOS;
}

export const WORLD_LANGUAGES = [
  "Afrikaans", "Albanian", "Amharic", "Arabic", "Armenian", "Azerbaijani",
  "Basque", "Belarusian", "Bengali", "Bosnian", "Bulgarian", "Catalan",
  "Cebuano", "Chinese (Cantonese)", "Chinese (Mandarin)", "Chinese (Traditional)",
  "Croatian", "Czech", "Danish", "Dutch", "English", "Esperanto",
  "Estonian", "Filipino / Tagalog", "Finnish", "French", "Galician",
  "Georgian", "German", "Greek", "Gujarati", "Haitian Creole", "Hausa",
  "Hebrew", "Hindi", "Hmong", "Hungarian", "Icelandic", "Igbo",
  "Indonesian", "Irish", "Italian", "Japanese", "Javanese", "Kannada",
  "Kazakh", "Khmer", "Korean", "Kurdish", "Kyrgyz", "Lao",
  "Latin", "Latvian", "Lithuanian", "Luxembourgish", "Macedonian",
  "Malagasy", "Malay", "Malayalam", "Maltese", "Māori", "Marathi",
  "Mongolian", "Myanmar (Burmese)", "Nepali", "Norwegian", "Odia",
  "Pashto", "Persian (Farsi)", "Polish", "Portuguese", "Punjabi",
  "Romanian", "Russian", "Samoan", "Serbian", "Sindhi", "Sinhala",
  "Slovak", "Slovenian", "Somali", "Spanish", "Sundanese", "Swahili",
  "Swedish", "Tajik", "Tamil", "Tatar", "Telugu", "Thai", "Tongan",
  "Turkish", "Turkmen", "Ukrainian", "Urdu", "Uyghur", "Uzbek",
  "Vietnamese", "Welsh", "Xhosa", "Yiddish", "Yoruba", "Zulu",
];
