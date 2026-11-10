# BibleOL

Aplicación de lectura bíblica en lenguas originales. El texto se sirve como HTML
desde Astro SSR y se lee directamente de los corpus Emdros mediante SQLite de
solo lectura. La interfaz está en español y funciona sin JavaScript en la
versión SSR. El despliegue principal es un contenedor SSR en Vercel que incluye
los corpus; la exportación estática queda como respaldo.

La versión SSR incluye además un asistente de estudio con IA, opcional y
desactivado por defecto, que genera resúmenes, explicaciones y análisis
gramaticales a partir del mismo texto y de la morfología del corpus. Para
usarlo hace falta una cuenta: cada análisis se guarda en el historial del
usuario y la cuota se aplica por cuenta, no por dirección IP. La exportación
estática no incluye esta función porque no tiene backend.

Este primer corte cubre la lectura de corpus, libros y capítulos: hebreo con
transliteración, griego y latín, con la forma en el texto, el lexema, la
morfología, las glosas y la estructura gramatical (frases, cláusulas y
oraciones) de cada palabra.

## Requisitos

- Node.js >= 26
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
- `/read/:corpus/:book/:chapter/explain`: asistente de estudio con IA (solo SSR).
- `/entrar` y `/crear-cuenta`: acceso y registro de cuentas.
- `/cuenta`: resumen de la cuenta.
- `/cuenta/historial` y `/cuenta/historial/:id`: análisis guardados.
- `/cuenta/contrasena` y `/cuenta/eliminar`: gestión de la cuenta.
- `/privacidad`: qué datos se guardan y cómo eliminarlos.
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

## Despliegue en Vercel

Producción: <https://bibleol-astro.vercel.app>

El despliegue principal es un contenedor SSR en Vercel. El `Dockerfile` de la
raíz:

1. instala pnpm y las dependencias,
2. descarga los corpus con `pnpm data:sync`,
3. compila Astro con el adaptador Node,
4. poda las dependencias de desarrollo,
5. arranca `apps/web/dist/server/entry.mjs` en el puerto 80.

`vercel.json` fija el framework `container` y la región `gru1`. El CLI crea o
vincula el proyecto y despliega:

```sh
vercel link --yes --project bibleol-astro
pnpm deploy:vercel
```

`pnpm deploy:vercel` copia el proyecto a un directorio temporal sin `.git` y
lanza el despliegue desde allí. Así Vercel no aplica la comprobación de autor
del commit local, que puede bloquear los despliegues por CLI aunque el proyecto
esté vinculado correctamente.

Para activar el asistente de IA hay que añadir la clave como secreto y volver a
desplegar:

```sh
printf '%s' 'sk-or-v1-...' | vercel env add OPENROUTER_API_KEY --environment production --sensitive --yes
pnpm deploy:vercel
```

Variables recomendadas en Vercel (Production):

- `OPENROUTER_API_KEY`: activa el asistente de IA.
- `AI_ENABLED=1`.
- `AI_SITE_URL=https://bibleol-astro.vercel.app`.
- `AI_IP_SALT=<secreto-largo>`.
- `AI_TRUST_PROXY=1`: Vercel reescribe `X-Forwarded-For`.
- `AI_REQUIRE_ACCOUNT=1`: exige una cuenta para generar análisis.
- `VERCEL_SUPPORT_LARGE_FUNCTIONS=1`: necesario si la imagen supera el límite
  estándar de funciones.
- `BIBLEOL_AI_DB=/tmp/ai.sqlite`: respaldo local si no hay Redis.
- `KV_REST_API_URL` y `KV_REST_API_TOKEN`: los añade la integración de Upstash
  Redis y permiten compartir caché y cuotas entre instancias.
- `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY` y
  `SUPABASE_SERVICE_ROLE_KEY`: los añade la integración de Supabase. La clave
  de servicio es solo para el servidor.
- `PUBLIC_SITE_URL`: URL pública usada en los enlaces de confirmación.
- `AUTH_SIGNUP_ENABLED=1` y `AUTH_REQUIRE_EMAIL_CONFIRMATION=0`: controlan el
  registro y la confirmación por correo.
- `AUTH_CSRF_SECRET` y `AUTH_RATE_SALT`: secretos independientes recomendados
  para los formularios y los límites de intentos.

La integración de Redis se puede provisionar desde el CLI:

```sh
vercel integration add upstash/upstash-kv --name bibleol-ai -e production -e preview
```

El contenedor incluye los tres corpus, por lo que no depende de un hosting
estático ni de un servidor aparte. La primera compilación descarga unos 240 MB
de corpus y puede tardar varios minutos. En Vercel, Redis guarda el caché y los
contadores compartidos; sin Redis, la app cae a SQLite en `/tmp` y cada
instancia mantiene su propio estado.

Las páginas de lectura y la portada se cachean en el CDN de Vercel
(`s-maxage=3600`, `stale-while-revalidate=86400`). La página del asistente usa
`Cache-Control: no-store` para no reutilizar respuestas generadas.

### Exportación estática opcional

La instantánea estática sigue disponible como respaldo, pero ya no es el
despliegue principal. El script:

1. descarga los corpus,
2. compila la aplicación SSR,
3. arranca el servidor y genera una instantánea de todos los capítulos,
4. separa los paneles de palabra y la vista gramatical en archivos `.gz` que se
   cargan bajo demanda.

La instantánea final ocupa unos 263 MiB. El HTML contiene los versículos y las
glosas; los paneles, la gramática, los cambios de vista y el filtro de
versículos necesitan JavaScript en esta edición. El filtro se aplica sobre el
HTML ya exportado y sobre el fragmento gramatical cuando se carga, sin generar
una página por cada rango posible. No incluye el asistente de IA.

Para generarla localmente:

```sh
pnpm build
node scripts/export-static.mjs --start-server
```

El resultado queda en `dist-static/`. En máquinas con varios núcleos conviene
repartir las peticiones entre varios servidores SSR (`--servers 2`) y, para
repetir una exportación interrumpida sin rehacer todo el trabajo, usar
`--resume`. Los cambios puramente visuales reutilizan el HTML y sustituyen el
CSS estable `_astro/app.css`.

En la vista gramatical, cada nivel (frase, cláusula y oración) aparece con el
color del proyecto original. Las palabras se agrupan bajo el objeto gramatical
más profundo que las contiene y siguen siendo desplegables para consultar todos
sus datos.

## Cuentas e historial

Las cuentas usan Supabase Auth y el historial se guarda en Postgres. La
integración de Supabase en Vercel escribe las variables `SUPABASE_*`,
`PUBLIC_SUPABASE_*` y `POSTGRES_*`; en local se descargan con:

```sh
vercel env pull .env.local
```

La tabla `public.analyses` se crea con las migraciones versionadas de
`supabase/migrations`. El ejecutor usa la conexión agrupada de Postgres y lleva
su propio registro en `public.app_migrations`:

```sh
pnpm db:status
pnpm db:migrate
```

Cada fila pertenece a un usuario y las políticas RLS impiden que una cuenta lea
o modifique el historial de otra. Al eliminar la cuenta, la clave foránea borra
también todos sus análisis. El registro crea la cuenta ya confirmada mediante
la API de administración; para exigir confirmación por correo, configure el
SMTP y la URL pública en Supabase y active
`AUTH_REQUIRE_EMAIL_CONFIRMATION=1`.

Los formularios funcionan sin JavaScript y llevan un token CSRF firmado. Los
intentos de acceso, registro y cambio de contraseña se limitan por IP y por
cuenta con Upstash Redis cuando está disponible.

## Asistente de IA (opcional)

La versión SSR puede generar resúmenes, explicaciones y análisis gramaticales
del pasaje visible. La función está desactivada por defecto y solo aparece
cuando el servidor tiene `OPENROUTER_API_KEY` (o `AI_ENABLED=1` y una clave).
Con `AI_REQUIRE_ACCOUNT=1` (valor por defecto), los visitantes anónimos ven un
aviso para entrar o crear una cuenta. La exportación estática no la incluye: el
panel se oculta con `STATIC_EXPORT=1` y la ruta `/explain` no se exporta.

### Configuración

1. Defina `OPENROUTER_API_KEY` en el entorno del servidor (o en el `.env` que
   cargue su plataforma). `.env.example` documenta todas las variables.
2. Ajuste `AI_MODEL` y `AI_FALLBACK_MODELS` si quiere otros modelos.
3. Para un despliegue público, defina `AI_SITE_URL`, `AI_IP_SALT` y, si hay un
   proxy inverso de confianza que reescribe `X-Forwarded-For`, active
   `AI_TRUST_PROXY=1`. No lo active si el servidor recibe tráfico directo.
4. Configure Supabase y aplique las migraciones (véase «Cuentas e historial»).
5. Arranque `pnpm dev` o `pnpm build && pnpm start`.

Valores por defecto:

| Variable             | Valor                                                                          |
| -------------------- | ------------------------------------------------------------------------------ |
| `AI_MODEL`           | `google/gemma-4-26b-a4b-it:free`                                               |
| `AI_FALLBACK_MODELS` | `nvidia/nemotron-3.5-lightning:free`, `nvidia/nemotron-3-ultra-550b-a55b:free` |
| `AI_PER_USER_DAILY`  | 15 análisis por cuenta y día                                                   |
| `AI_PER_USER_BURST`  | 3 análisis por cuenta y minuto                                                 |
| `AI_GLOBAL_DAILY`    | 120 análisis por día en todo el servidor                                       |
| `AI_MAX_VERSES`      | 80 versículos por análisis                                                     |
| `AI_MAX_CONCURRENT`  | 3 peticiones simultáneas                                                       |
| `AI_CACHE_TTL_DAYS`  | 30 días                                                                        |

Use `AI_FALLBACK_MODELS=-` para desactivar el modelo de respaldo.

### Modelos y límites de OpenRouter

Los modelos gratuitos recomendados existen en OpenRouter y se comprobaron
contra su catálogo:

- `google/gemma-4-26b-a4b-it:free`: variante de mezcla de expertos, más rápida
  que el modelo denso, gratuita y con razonamiento. Es el modelo principal.
- `nvidia/nemotron-3.5-lightning:free`: respaldo rápido y ligero.
- `nvidia/nemotron-3-ultra-550b-a55b:free`: 1.000.000 de tokens de contexto,
  gratuito y solo texto. Es el segundo respaldo.

Los límites de la plataforma son independientes de los de BibleOL. Según la
documentación de OpenRouter, los modelos `:free` permiten 20 solicitudes por
minuto y:

- 50 solicitudes por día si la cuenta ha comprado menos de 10 créditos;
- 1.000 solicitudes por día si ha comprado al menos 10 créditos.

Por eso `AI_GLOBAL_DAILY` vale 120 por defecto: deja margen bajo el límite
diario de 1.000 y sigue protegiendo el servicio. Si su cuenta usa el plan
gratuito de 50, bájelo a 40. Los límites por cuenta y el límite global se
aplican en Redis (o SQLite) antes de llamar al proveedor. Una respuesta ya
guardada en caché no consume cuota.

También puede usar modelos de pago: el coste lo asume el operador. El caché
exacto y los límites protegen la factura. `AI_REASONING=0` desactiva el
razonamiento para responder antes y consumir menos tokens.

### Funcionamiento

- La generación no usa streaming: una petición no streaming, una respuesta
  completa y renderizado como texto plano. La primera generación puede tardar
  entre uno y dos minutos según el modelo; el mismo pasaje se sirve después
  desde caché.
- El máximo es un capítulo por petición. Con 80 versículos por defecto, los
  capítulos largos (por ejemplo, Salmos 119) requieren elegir un rango.
- El prompt incluye el texto original, la transliteración, el lexema, la
  morfología, las glosas y la estructura gramatical del pasaje.
- El caché es exacto por pasaje, rango, modo y modelo. El modelo de respaldo se
  gestiona con el parámetro `models` de OpenRouter. En local se guarda en
  SQLite; en Vercel se comparte por Redis si la integración está disponible.
- La página de confirmación usa un formulario GET sin JavaScript. La generación
  solo se ejecuta con `generate=1`, lo que evita llamadas accidentales desde
  enlaces compartidos o rastreadores.
- El texto del pasaje se envía a OpenRouter. No se envían datos de cuenta ni
  datos personales. La IP solo se usa para el límite anónimo y se guarda como
  hash SHA-256 con `AI_IP_SALT`; no se registra en los logs. El contenido
  generado se guarda en SQLite local o en Redis (si está configurado) durante
  `AI_CACHE_TTL_DAYS`.

La ruta acepta `?mode=resumen|explicacion|gramatica`, `?from=`, `?to=` y
`?generate=1`. Sin `generate=1` solo muestra el formulario y la información de
uso.

El estado de cuota y caché vive en SQLite local por defecto. Si existen
`KV_REST_API_URL` y `KV_REST_API_TOKEN` (Upstash Redis), la aplicación usa Redis
para compartir caché y contadores entre instancias. Sin Redis, cada proceso
mantiene su propio contador y su propia caché; para cuotas globales exactas en
varias réplicas conviene Redis o Postgres. La instancia necesita un directorio
de datos escribible si usa SQLite.

## Scripts

| Comando              | Descripción                                             |
| -------------------- | ------------------------------------------------------- |
| `pnpm dev`           | Servidor de desarrollo en el puerto 4321.               |
| `pnpm build`         | Comprobación de tipos y compilación de producción.      |
| `pnpm start`         | Servidor de producción (requiere `pnpm build`).         |
| `pnpm check`         | Comprobación de tipos de todos los paquetes.            |
| `pnpm test`          | Pruebas del lector, la IA y sus límites (vitest).       |
| `pnpm test:e2e`      | Pruebas end-to-end sin JavaScript sobre la compilación. |
| `pnpm export:static` | Genera la instantánea estática opcional.                |
| `pnpm deploy:vercel` | Despliega el contenedor SSR en Vercel.                  |
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
locales y las pruebas unitarias de `apps/web` (limpieza de texto, prompt, caché,
límites y URLs). Las pruebas del lector se omiten si los corpus no están
descargados.

`pnpm test:e2e` compila la aplicación, arranca el servidor de producción en el
puerto 4323 y ejecuta Playwright con JavaScript desactivado en el navegador. Las
pruebas cubren selección, rangos de versículos, lectura hebrea/griega/latina,
transliteración, paneles de palabra con glosas, glosa bajo la palabra, vista
gramatical, navegación, redirecciones, 404 y vista móvil. También comprueban que
sin clave de OpenRouter el panel de IA no aparece y `/explain` responde 404.

El flujo `.github/workflows/ci.yml` ejecuta la comprobación de tipos, las
pruebas unitarias, el lint, la compilación y las pruebas end-to-end en cada push
a `main` y en cada pull request.

Las pruebas usan Chromium. En macOS 12 el WebKit empaquetado por Playwright está
congelado y no es compatible con la versión actual; en macOS 13 o superior se
puede activar el proyecto WebKit con:

```sh
PLAYWRIGHT_WEBKIT=1 pnpm test:e2e
```

## Estructura

- `apps/web`: Astro SSR, rutas, componentes e i18n.
- `apps/web/src/lib/ai`: configuración, prompt, OpenRouter, caché y límites.
- `apps/web/src/features/ai`: panel del capítulo y formulario de generación.
- `Dockerfile`, `vercel.json`: despliegue del contenedor SSR en Vercel.
- `scripts/deploy-vercel.sh`: despliegue desde una copia sin metadatos de Git.
- `packages/contracts`: tipos compartidos.
- `packages/corpus`: catálogo y lector Emdros de solo lectura.
- `apps/web/e2e`: pruebas end-to-end.
- `scripts`: importación, glosas, descarga y verificación de datos.

Los componentes viven junto a la funcionalidad que los usa
(`features/reading`, `features/navigation`). No hay un paquete de UI separado.

## Principios

- La versión SSR funciona sin JavaScript; la exportación estática usa
  JavaScript solo para los paneles, la gramática y los conmutadores de vista.
- El asistente de IA es opcional y solo existe en el servidor. No se usa en la
  instantánea estática y el texto se envía a OpenRouter únicamente cuando el
  usuario confirma la generación.
- Cero dependencias de navegador: sin framework cliente, CDN, fuentes externas
  ni librerías de iconos.
- Fuentes locales (Ezra SIL, Gentium Plus, Galatia SIL y Doulos SIL).
- Soporte previsto: Safari 17 y Chrome actual en Android 8 o superior.
- SQLite se consulta con SQL explícito y sentencias preparadas.
