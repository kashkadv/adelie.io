# Flipper — швидкий старт

Повний гайд із прикладами коду — в застосунку: **Сайт → Flipper → «Як підключити й налаштувати події»**.
Рішення — [ADR-0022](../decisions/0022-flipper-tracker.md), вимоги — [specs/tracker.md](../specs/tracker.md).

## 1. Увімкнути й встановити

1. «Підключення» → підключити сайт (фід), якщо ще ні.
2. «Flipper» → «Увімкнути» для сайту → скопіювати код встановлення в `head` усіх сторінок:

```html
<script>window.flipper=window.flipper||function(){(window.flipper.q=window.flipper.q||[]).push(arguments)}</script>
<script async src="https://dev-api.adelie.space/flipper.js" data-site-id="fl_…"></script>
```

3. Відкрити сайт: у «Подіях наживо» має з'явитись `PageView`. Діагностика — `?flipper_debug=1` (події в консолі).

## 2. Події магазину

```js
flipper('viewCategory', { id: 'runners', name: 'Доріжки' });
flipper('productView', { id: '00022502', name: 'Килим', price: 29000, currency: 'UAH' });
flipper('addToCart', { id: '00022502', price: 29000, currency: 'UAH' }, 1);
flipper('beginCheckout', { currency: 'UAH', items: [{ id: '00022502', price: 29000, quantity: 1 }] });
```

`id` — **артикул** (той самий, що `g:id` у фіді й SKU в Etsy): за ним товар з події зіставляється з каталогом.
Без JS: `data-flipper-event="AddToCart" data-flipper-item-id="…" data-flipper-price="…"` на кнопці.

## 3. Згода

```js
flipper('consent', 'granted'); // відвідувач погодився (з постійним ідентифікатором, сеансами, воронкою)
flipper('consent', 'denied');  // відмовився: Flipper мовчить
```

Без виклику — анонімний режим: без cookie, перегляди й унікальні за добу.

## 4. Два домени

Окремий `data-site-id` на кожен домен; `data-link-domains="gushka.world"` переносить відвідувача між доменами.

## 5. Джерела

`?utm_source=pinterest&utm_medium=organic_social&utm_campaign=…&utm_content=pin_123` — малими літерами, без пробілів,
однаково для одного джерела. Канали: Organic/Paid Search, Organic/Paid Social, Email, Affiliate, Display, Referral,
Direct, Other.
