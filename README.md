# BibleOL

Aplicación de lectura bíblica en lenguas originales. El texto se sirve como HTML
desde Astro SSR y se lee directamente de los corpus Emdros mediante SQLite de
solo lectura. La interfaz está en español y funciona sin JavaScript en la
versión SSR. La edición publicada en GitHub Pages es una instantánea estática
que carga los paneles y la gramática bajo demanda con JavaScript.

Este primer corte cubre la lectura de corpus, libros y capítulos: hebreo con
transliteración, griego y latín, con la forma en el texto, el lexema, la
morfología, las glosas y la estructura gramatical (frases, cláusulas y
oraciones) de cada palabra.

## Requisitos

- Node.js >= 22.23.4
- pnpm 12
- Python 3.12 (solo para los scripts de datos)

## Puesta en marcha

```sh
pnpm install
pnpm data:sync
pnpm dev
```

La aplicación queda en <http://localhost:4321>.

`pnpm data:sync` descarga los corpus declarados en el catálogo versionado. Si
quiere regenerar el catálogo desde el proyecto legacy:

```sh
pnpm data:import --legacy ../BibleOL
pnpm data:lexicons --legacy ../BibleOL
pnpm data:verify
```

Las glosas se generan a partir de los lexicones CSV del proyecto legacy y se
guardan como JSON en `data/lexicon/` para que un clon limpio las tenga sin
necesidad de MySQL.

## Rutas

- `/`: selección de corpus, libro y capítulo.
- `/read/:corpus/:book/:chapter`: lectura del capítulo.
- `/read?corpus=...&book=...&chapter=...`: redirección a la URL canónica.
- `?translit=1`: muestra la transliteración cuando el corpus la ofrece.
- `?grammar=1`: muestra la estructura gramatical por versículo.
- `?gloss=1`: muestra la glosa española debajo de cada palabra.
- `?from=5`: limita la lectura al versículo 5.
- `?from=5&to=10`: limita la lectura del versículo 5 al 10.
- `?to=10`: limita la lectura del versículo 1 al 10.

Los valores de `from` y `to` se intercambian si vienen al revés y se ajustan al
último versículo real del capítulo. La selección de versículos está disponible
en el formulario de la portada y en el selector superior de cada capítulo, y se
conserva al activar o desactivar la transliteración, la glosa o la gramática. Al
cambiar de capítulo, de libro o de corpus se vuelve a mostrar el capítulo
completo; dejar los dos campos vacíos también muestra todo el capítulo.

Las URL de lectura conservan `translit=1`, `grammar=1`, `gloss=1`, `from` y
`to` al cambiar de vista.

## Publicación en GitHub Pages

El flujo `.github/workflows/pages.yml` compila y publica la aplicación en
<https://yojananyosef.github.io/bibleol-astro/> al hacer push a `main` (o al
ejecutarlo manualmente). Como Pages solo sirve archivos estáticos, el flujo:

1. descarga los corpus,
2. compila la aplicación SSR,
3. arranca el servidor y genera una instantánea de todos los capítulos,
4. separa los paneles de palabra y la vista gramatical en archivos `.gz` que se
   cargan bajo demanda.

La instantánea final ocupa unos 263 MiB, por debajo del límite de 1 GB de Pages.
El HTML contiene los versículos y las glosas; los paneles, la gramática, los
cambios de vista y el filtro de versículos necesitan JavaScript en esta
edición. El filtro se aplica sobre el HTML ya exportado y sobre el fragmento
gramatical cuando se carga, sin generar una página por cada rango posible.

Para generarla localmente:

```sh
pnpm build
node scripts/export-static.mjs --start-server --base /bibleol-astro
```

El resultado queda en `dist-static/`. En máquinas con varios núcleos conviene
repartir las peticiones entre varios servidores SSR (`--servers 2`) y, para
repetir una exportación interrumpida sin rehacer todo el trabajo, usar
`--resume`. La publicación en GitHub Pages guarda `dist-static` en la caché de
Actions y solo vuelve a generar las páginas cuando cambia el marcado o los
datos; los cambios puramente visuales reutilizan el HTML y sustituyen el CSS
estable `_astro/app.css`.

En la vista gramatical, cada nivel (frase, cláusula y oración) aparece con el
color del proyecto original. Las palabras se agrupan bajo el objeto gramatical
más profundo que las contiene y siguen siendo desplegables para consultar todos
sus datos.

## Scripts

| Comando              | Descripción                                             |
| -------------------- | ------------------------------------------------------- |
| `pnpm dev`           | Servidor de desarrollo en el puerto 4321.               |
| `pnpm build`         | Comprobación de tipos y compilación de producción.      |
| `pnpm start`         | Servidor de producción (requiere `pnpm build`).         |
| `pnpm check`         | Comprobación de tipos de todos los paquetes.            |
| `pnpm test`          | Pruebas de integración del lector de corpus.            |
| `pnpm test:e2e`      | Pruebas end-to-end sin JavaScript sobre la compilación. |
| `pnpm export:static` | Genera la instantánea estática para GitHub Pages.       |
| `pnpm data:sync`     | Descarga y verifica los corpus Emdros.                  |
| `pnpm data:import`   | Regenera `data/metadata/corpora.json` desde el legacy.  |
| `pnpm data:lexicons` | Regenera las glosas de `data/lexicon/` desde el legacy. |
| `pnpm data:verify`   | Verifica archivos, checksums y metadatos.               |

## Datos

- `data/corpora/`: archivos Emdros (no se versionan).
- `data/metadata/corpora.json`: catálogo normalizado (se versiona).
- `data/lexicon/`: glosas en JSON generadas desde los CSV del legacy (se
  versionan).
- Los corpus actuales son ETCBC4 (hebreo), Nestlé 1904 (griego) y JVulgate
  (latín).

El catálogo incluye los rasgos que muestra cada palabra, sus etiquetas en
español, los grupos del panel de palabra, los niveles gramaticales con sus
colores y la configuración de glosas de cada corpus.

Las glosas hebreas y arameas se eligen por la columna del tallo verbal; las
griegas usan el lexicón español con respaldo en inglés, y las latinas proceden
del lexicón inglés disponible.

El lector usa `better-sqlite3` en modo de solo lectura y SQL explícito. No hay
ORM ni una capa de repositorios genérica.

## Pruebas

`pnpm test` ejecuta las pruebas del paquete `@bibleol/corpus` contra los datos
locales. Se omiten si los corpus no están descargados.

`pnpm test:e2e` compila la aplicación, arranca el servidor de producción en el
puerto 4323 y ejecuta Playwright con JavaScript desactivado en el navegador. Las
pruebas cubren selección, rangos de versículos, lectura hebrea/griega/latina,
transliteración, paneles de palabra con glosas, glosa bajo la palabra, vista
gramatical, navegación, redirecciones, 404 y vista móvil.

Las pruebas usan Chromium. En macOS 12 el WebKit empaquetado por Playwright está
congelado y no es compatible con la versión actual; en macOS 13 o superior se
puede activar el proyecto WebKit con:

```sh
PLAYWRIGHT_WEBKIT=1 pnpm test:e2e
```

## Estructura

- `apps/web`: Astro SSR, rutas, componentes e i18n.
- `packages/contracts`: tipos compartidos.
- `packages/corpus`: catálogo y lector Emdros de solo lectura.
- `apps/web/e2e`: pruebas end-to-end.
- `scripts`: importación, glosas, descarga y verificación de datos.

Los componentes viven junto a la funcionalidad que los usa
(`features/reading`, `features/navigation`). No hay un paquete de UI separado.

## Principios

- La versión SSR funciona sin JavaScript; la instantánea de Pages usa
  JavaScript solo para los paneles, la gramática y los conmutadores de vista.
- Cero dependencias de navegador: sin framework cliente, CDN, fuentes externas
  ni librerías de iconos.
- Fuentes locales (Ezra SIL, Gentium Plus, Galatia SIL y Doulos SIL).
- Soporte previsto: Safari 17 y Chrome actual en Android 8 o superior.
- SQLite se consulta con SQL explícito y sentencias preparadas.
