import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import ro from "./locales/ro.json";

// To add a new language:
// 1. Create src/locales/<code>.json (copy en.json and translate)
// 2. Import it here
// 3. Add it to `resources` below
// 4. Add it to LANGUAGES in src/views/SettingsView.tsx

export const LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "ro", label: "Română" },
];

const saved = localStorage.getItem("lang") ?? "en";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ro: { translation: ro },
  },
  lng: saved,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
