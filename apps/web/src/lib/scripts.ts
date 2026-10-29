export function scriptClass(language: string): string {
  if (language === "he") {
    return "script-hebrew";
  }
  if (language === "grc") {
    return "script-greek";
  }
  return "script-latin";
}

export function transliterationLanguage(language: string): string {
  return `${language}-Latn`;
}
