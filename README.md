# DaoSense — Playwright e2e

Автотесты витрины DaoSense (Shopify, тема Horizon). Покрыты: смена языка и рынка, синхронизация
и блокировка корзины, CartMax-бандлы, главная, коллекции (PLP), страницы товара (PDP), поиск,
корзина и checkout, блог и формы, членство и цены участника, личный кабинет, переводы, вёрстка,
доступность и консоль.

- Шаги тест-кейсов — `../test-cases/DAO_Sense_Test_Cases.xlsx` (колонка «Autotest (file:line)» ссылается на спеки).
- Находки — `../test-cases/Findings.xlsx`, сверка с внешними кейсами — `../test-cases/DAO_comparison_2026-10-19.xlsx`.
- Очередь задач по автотестам — `../BACKLOG.md`.
- Что уже разобрано и как отработало — [REVIEW-STATUS.md](REVIEW-STATUS.md).

## Установка

```bash
npm install
npx playwright install
cp .env.example .env
```

## Запуск

| Команда | Что делает |
|---|---|
| `npm test` | все проекты: chromium, firefox, webkit, mobile-safari |
| `npx playwright test --project=chromium` | один браузер |
| `npm run test:smoke` | критический путь — тесты с тегом `@smoke` |
| `npm run test:market` | `tests/market` (рынки, язык, корзина, бандлы, попап) |
| `npm run test:membership` | цены глазами гостя + тесты участника |
| `npm run test:member` | только тесты участника, chromium |
| `npm run test:batched` | прогон по батчам с паузами — аргументы свои, см. ниже |
| `npm run test:pdp:batched` | PDP по 4 рынкам, 3 круга, с паузами |
| `npm run test:headed` | chromium с видимым окном |
| `npm run list` | список тестов без запуска |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run report` | открыть HTML-отчёт |
| `npm run auth:member`, `npm run auth:customer` | одноразовый ручной вход (см. «Сессии») |

### Батчевый прогон (`scripts/run-batched.mjs`)

Live-магазин ограничивает частоту запросов, поэтому длинные прогоны лучше гонять батчами с большими
паузами. Скрипт не обходит защиту: поймав Cloudflare или 429, он ждёт и повторяет батч **один** раз,
после чего останавливается.

```bash
node scripts/run-batched.mjs --repeat 3 tests/pages/pdp_DE.spec.ts "tests/pages/pdp.spec.ts::GB / en"
node scripts/run-batched.mjs --dry tests/pages/pdp_SV.spec.ts     # только список тестов, без запросов к магазину
```

Батч — это spec-файл, при желании с фильтром по названию теста после `::`.
Опции: `--repeat N` (кругов, по умолчанию 1), `--gap MIN` (пауза между батчами, 10),
`--challenge-wait M` (пауза после Cloudflare перед повтором, 45), `--project NAME` (chromium),
`--pause MS` (`TEST_PAUSE_MS`, 3000), `--dry`.

Результаты одного прогона (обе папки в git не попадают):

```
playwright-report/batches/<дата_время>/<батч>-r<круг>.log   # текстовый лог батча
playwright-report/batches/<дата_время>/<батч>-r<круг>/      # HTML-отчёт батча
playwright-report/batches/<дата_время>/summary.md           # таблица: passed / failed / challenge
test-results/batches/<дата_время>/<батч>-r<круг>/           # трейсы, скриншоты, видео
```

## Окружение (`.env`)

| Переменная | Назначение |
|---|---|
| `BASE_URL` | Витрина. По умолчанию `https://www.daosense.org` |
| `PREVIEW_THEME_ID` | ID неопубликованной темы — добавляется как `preview_theme_id` ко всем переходам |
| `STOREFRONT_PASSWORD` | Пароль витрины, если включена страница с паролем |
| `TEST_PAUSE_MS` | Пауза после каждого теста, мс (по умолчанию 3000). Увеличьте до 5000–10000, если часто ловите 429. `0` — выключить |
| `MARKET_POPUP_ENABLED` | `true`, если в теме включён попап выбора региона (иначе тесты попапа пропускаются) |
| `RUN_DATA_CHECK` | `true` — включить обход каталога MKT-019 (запускать отдельно) |
| `RUN_CHECKOUT` | `true` — CART-006 открывает Shopify checkout на 4 рынках (без оплаты) |
| `PROMO_CODE` | Действующий промокод. Без него CART-003 проверяет только неверный код |
| `MEMBER_EMAIL` | E-mail тестового участника — нужен для ACC-002 |

`MEMBER_LOGIN` и `CUSTOMER_LOGIN` выставляют сами скрипты `auth:member` / `auth:customer`, руками их задавать не нужно.

> Live-магазин ограничивает частоту запросов: при всплеске отвечает **HTTP 429** и показывает
> проверку «Your connection needs to be verified». Поэтому тесты идут в **1 поток**, делают паузу между тестами
> (`TEST_PAUSE_MS`), повторяют открытие страниц и запросы при 429 (ждут `Retry-After` или 3 → 6 → 12 с), а если ограничение не снимается — падают с ошибкой `RateLimitError`.
> В этом случае подождите несколько минут и запустите снова (лучше по одному файлу или через батчевый прогон).
>
> Если Cloudflare включил **проверку на бота** (ответ с заголовком `cf-mitigated: challenge`), тест сразу падает с
> `BotChallengeError` — повторы и паузы тут не помогают, а обходить проверку нельзя. Сделайте перерыв 30–60 минут
> или попросите владельца магазина добавить IP тестов в разрешённые / гоняйте тесты на dev- или превью-магазине.
>
> Тесты добавляют товары в корзину и переключают рынки, но **не доходят до оплаты**.
> Предпочтительно гонять на превью-теме (`PREVIEW_THEME_ID`), а не на опубликованной.

## Структура

```
helpers/fixtures.ts                 # test с фикстурой `store` + опции loadAssets / marketPopupSeen / closeNewsletterPopup
helpers/storefront.ts               # Page Object: выбор региона, чистые URL (/de|/sv), API корзины, локаторы
helpers/pdp-page.ts                 # общий набор проверок PDP (PDP-001…013), по прогону на рынок; здесь же тег @smoke
helpers/collection-page.ts  # общий набор проверок PLP (PLP-001…016), по прогону на рынок
helpers/auth.ts                     # пути к .auth/*.json и проверка наличия сессии
helpers/money.ts                    # parseMoney, memberPriceOf
test-data/store.ts                  # рынки, языковые группы товаров, коллекции, тексты уведомлений
scripts/run-batched.mjs             # прогон по батчам с паузами

tests/auth/member.setup.ts          # ручной вход участника → .auth/member.json
tests/auth/customer.setup.ts        # ручной вход клиента без членства → .auth/customer.json
tests/market/                       # MKT-*: рынки, язык, синхронизация и блокировка корзины, CartMax-бандлы, попап
tests/pages/                        # главная (homepage), коллекции ×3 (GB+US, DE, SV), PDP ×3 (GB+US, DE, SV)
tests/smoke/                        # SMK-*, CART-*: главная/шапка/футер, поиск, корзина и checkout, блог, формы, 404
tests/account/                      # MEM-*, ACC-*: гость, клиент без членства, участник
tests/ui_extra/                     # TRN-*, LAY-*, A11Y-*, CON-*: переводы, вёрстка, клавиатура, контраст, консоль
```

Какие файлы уже разобраны по шагам и как они отработали на последнем прогоне — в
[REVIEW-STATUS.md](REVIEW-STATUS.md). До 04.11.2026 это было видно по префиксу `CHECKED_` в имени файла;
префикс убран (BL-05), статус переехал в отдельный файл.

## Фикстуры и опции (`helpers/fixtures.ts`)

| Опция | По умолчанию | Что делает |
|---|---|---|
| `loadAssets` | `false` | Картинки, видео, шрифты и аналитика **режутся**: на витрине это ~90% запросов, и без них реже ловится 429. Включать точечно: `test.use({ loadAssets: true })` |
| `marketPopupSeen` | `true` | Подставляет `localStorage.market_selected`, чтобы попап первого визита не мешал |
| `closeNewsletterPopup` | `true` | Автоматически закрывает всплывающее окно подписки (Shopify Forms), как это сделал бы покупатель |

Отдельная фикстура `consoleErrors` собирает `pageerror` и `console.error` **только своего домена** —
пиксели и сторонние приложения (Pinterest, Google, Shop Pay) не учитываются.

Файлы, где картинки включены целиком: `tests/pages/homepage.spec.ts`, `tests/smoke/home-header-footer.spec.ts`,
`tests/smoke/content-forms.spec.ts`, `tests/ui_extra/a11y-console.spec.ts`, `tests/ui_extra/translations-layout.spec.ts`.
Точечно — PDP-003 (галерея) и PLP-006 (картинки карточек).

## ID тест-кейсов

21.10.2026 у ID убран префикс `TC-`. Сейчас используются префиксы по вкладкам `DAO_Sense_Test_Cases.xlsx`:

| Префикс | Вкладка | Про что |
|---|---|---|
| `MKT` | Lang+Market | рынки, язык, синхронизация корзины |
| `MEM` | Membership | членство и цены участника |
| `ACC` | Account | личный кабинет |
| `SMK` | Smoke | базовые проверки витрины |
| `CART` | Cart | корзина и checkout |
| `PLP` | PLP | страница коллекции |
| `PDP` | PDP | страница товара |
| `TRN` | Translations | переводы |
| `LAY` | Layout | вёрстка |
| `A11Y` | a11y | доступность |
| `CON` | Console | ошибки в консоли |

Расшифровка и соответствие старым ID — на вкладке Legend; внешние E-кейсы — в `DAO_comparison_2026-10-19.xlsx`.
`F-xx` в комментариях к тестам — находки из `Findings.xlsx`, `R-xx` — риски.

## Сессии: участник и клиент без членства

Вход на витрину — по одноразовому коду из письма, поэтому он делается **вручную один раз**.

**Участник** (`tests/account/active-member.spec.ts`) — нужен аккаунт с тегом `active_subscription`:

1. В `.env` укажите `MEMBER_EMAIL=<email участника>`.
2. Запустите `npm run auth:member` — откроется браузер со страницей входа.
3. Введите email и код из письма. Когда откроется кабинет, сессия сохранится в `.auth/member.json` (в git не попадает).
4. Запускайте `npm run test:member`. Если сессия истекла — повторите шаг 2.

**Клиент без членства** (`tests/account/customer.spec.ts`) — так же: один раз `npm run auth:customer`,
войти аккаунтом **без** тега `active_subscription` (сессия → `.auth/customer.json`).

Без файла сессии соответствующие тесты пропускаются. Корзина участника привязана к аккаунту — тесты очищают её
до и после; в checkout не переходят, подписку не трогают и из аккаунта не выходят.

## Что остаётся ручным

MKT-029, MEM-006, ACC-004, ACC-010…012, ACC-015, SMK-024, SMK-025, SMK-031, SMK-035 —
нужны особые аккаунты/данные, настройка в Theme Editor, код из письма, отправка формы с hCaptcha или пароль витрины.

## Цены участника — что проверяется

| Товар | Гость | Участник |
|---|---|---|
| «Free for members» (`foundations` и аналоги) | основная цена обычная; «💡 Member price: Free», «Regular price», ссылка «Buy now membership…» | основная цена «Free» + зачёркнутая; «💎 Member price: Free»; в корзине 0 |
| Обычный (`september-from-digestion-to-clarity` и аналоги) | основная цена обычная; «💡 Member price: <цена × 0.67>», «Regular price», ссылка | основная цена обычная; «💎 Member price: <цена × 0.67>», «Regular price»; в корзине = Member price |
| Членство `daosense-membership` | обычная цена, блока Member price нет | то же; участник может купить членство повторно (ожидаемо) |

Коэффициент — `MEMBER_PRICE_RATE = 0.67` в `test-data/store.ts`.

## Как переключается рынок

Каждый языковой товар ограничен своим рынком: DE/de/EUR, SE/sv/SEK, GB/en/GBP, US/en/USD.
Ссылки в тестах такие же, как у покупателей: `https://www.daosense.org/sv/products/mjalten-i-centrum` — без `?country=`.
Рынок выбирается так же, как в переключателе «Region and language» в шапке: `store.open(path, 'SE')` сначала
отправляет форму `POST /localization` (страна + язык), Shopify запоминает регион в cookie `localization`,
а затем открывается чистая ссылка `/sv{path}`. Если регион уже выбран, форма повторно не отправляется.
Без выбора региона Shopify определяет рынок по IP, и товары чужого рынка отдают 404.

**Проверка рынка перед действиями.** После каждого `store.open(path, market)` и после каждого редиректа при смене
языка (`store.waitForPath(path, market)`) тест сначала проверяет, что страница действительно открыта в нужном рынке,
и только потом что-то нажимает или меняет:
1. ссылка — языковой префикс в URL (`/de`, `/sv`, без префикса для английского);
2. шапка — в переключателе «Region and language» выбрана нужная страна (`li[aria-current="true"]`) и показана её валюта;
3. состояние Shopify — `window.Shopify.locale / country / currency`.

**Правило смены рынка на PDP.** Если на странице товара сменить страну или язык в шапке, магазин переводит на
**главную выбранного рынка** (`/de`, `/sv`, `/`) — это ожидаемое поведение (MKT-031/032, `header-market-switch.spec.ts`).
Смена языка через селектор на самой PDP + «Add to cart» — другой сценарий: там открывается товар-аналог (MKT-010…).

Так ловится, например, ситуация, когда открылась `https://www.daosense.org/`, а в шапке выбрана Швеция (SEK).
Сообщение об ошибке показывает, какая именно часть не совпала.
Корзина читается через `/cart.js` изнутри страницы, поэтому cookies и рынок совпадают с браузером.

## Тесты, которые пропускаются

| Тест | Когда пропускается |
|---|---|
| MKT-015 | `fixme` — ожидаемое поведение для US + en не подтверждено (код уводит в GB, риск R-05) |
| MKT-001…005, A11Y-005, TRN-004 (попап) | без `MARKET_POPUP_ENABLED=true` — попап выключен в теме. MKT-008 идёт всегда: он проверяет, что при выключенном попапе его и нет |
| MKT-017 | без `PREVIEW_THEME_ID` — проверяет только превью-тему |
| MKT-019 | без `RUN_DATA_CHECK=true`; только chromium — обход каталога (~100+ запросов), запускать отдельно |
| CART-006 | без `RUN_CHECKOUT=true` — открывает Shopify checkout |
| CART-001 | если в корзине нет степпера количества (`quantity-selector` закомментирован в `snippets/cart-products.liquid`) |
| CART-004 | если в корзине нет поля заметки к заказу |
| MEM-003…005, MEM-008, MEM-010, ACC-001…008, ACC-018/019, TRN-005 | без `.auth/member.json` — сначала `npm run auth:member` |
| MEM-007, ACC-009, ACC-013 | без `.auth/customer.json` — сначала `npm run auth:customer` |
| ACC-002 | без `MEMBER_EMAIL` в `.env` |
| ACC-003 | если у участника нет заказов — «Member since» не рендерится (ACC-004) |
| SMK-002, SMK-022, ACC-017, MKT-031/032, TRN-001 (шапка), A11Y-001/002 | на проекте mobile-safari — десктопные шапка, поиск и клавиатура |

## Тесты, которые ожидаемо падают

Это дефекты витрины, а не ошибки тестов.

| Тест | Находка / риск |
|---|---|
| PDP-011 на `/de` и `/sv` | F-13 — ссылка «Buy now membership…» теряет языковой префикс |
| PLP-015 на US, DE, SE | F-23 — фасет «Price» рендерится только в GB |
| PLP-008 на DE | F-24 (сортировка по названию) и F-25 (по цене); проверка soft — один прогон показывает все сломанные опции сразу |
| TRN-005 на DE и SE | R-12 — «Hello» и «Workbooks» захардкожены по-английски в `users-section.liquid` |
| MKT-030 | R-07 — при сбое добавления старая строка уже удалена, товар теряется |
| MKT-026, шаг re-add | R-08 — ссылка re-add без языкового префикса |

По прежней версии README среди падающих числились также контраст (A11Y-004) и футер/вёрстка (LAY-*,
риски R-15 и R-17). В коде этих тестов пометок о заведомом падении нет — статус подтвердить на ближайшем прогоне.

## Тест-данные

Handle товаров и языковые группы сняты с live 16.10.2026 (`data-language-product-map` на PDP и `/products.json`).
При изменении каталога обновите `test-data/store.ts`. Эталонные группы: `blood`, `foundations`, `september`, `october2025`;
товар без языковых аналогов — `january-2026`; членство — `daosense-membership` (один handle во всех рынках).
Источник правды по настройкам темы — ветка `live` (`config/settings_data.json`), `develop` может отставать.
