export const es = {
  appName: "BibleOL",
  tagline: "Lectura bíblica en lenguas originales",
  homeTitle: "Lea la Biblia en sus lenguas originales",
  homeIntro:
    "Elija un corpus, un libro y un capítulo. El texto se lee directamente de los corpus lingüísticos, sin JavaScript y sin servicios externos.",
  corpusLabel: "Corpus",
  bookLabel: "Libro",
  chapterLabel: "Capítulo",
  chapterNavigation: "Navegación por capítulos",
  readButton: "Leer",
  goButton: "Ir",
  previous: "Anterior",
  next: "Siguiente",
  chapterShort: "cap.",
  showTransliteration: "Mostrar transliteración",
  hideTransliteration: "Ocultar transliteración",
  grammarHint: "Pulse una palabra para ver su lema y sus rasgos gramaticales.",
  lemma: "Lema",
  grammar: "Gramática",
  noFeatures: "Sin rasgos gramaticales anotados.",
  allBooks: "Todos los libros",
  directionRtl: "de derecha a izquierda",
  directionLtr: "de izquierda a derecha",
  corporaIntro: "Tres tradiciones textuales, una misma lectura.",
  openSample: "Abrir",
  booksCount: "libros",
  versesCount: "versículos",
  edition: "Edición",
  backToSelection: "Volver a la selección",
  notFoundTitle: "No encontramos ese pasaje",
  notFoundText:
    "El corpus, el libro o el capítulo no existe. Compruebe la dirección o vuelva a la selección.",
  footer:
    "Textos leídos localmente de los corpus ETCBC4, Nestlé 1904 y Vulgata. Interfaz en español.",
  skipToText: "Saltar al contenido",
  verse: "Versículo",
  siteTitle: "BibleOL · Lectura bíblica",
  readingLabel: "Texto",
} as const;

export type MessageKey = keyof typeof es;
export type Messages = Record<MessageKey, string>;
