# Задания — запуск (всё бесплатно)

Нужны: аккаунты на supabase.com и github.com, Node.js (для генерации ключей и CLI).

## 1. Supabase: база
1. supabase.com → New project (регион поближе, пароль БД запишите).
2. **SQL Editor → New query** → вставить содержимое `supabase.sql` → Run.
3. **Authentication → Providers → Email** → выключить **Confirm email**.
4. **Project Settings → API** → скопировать `Project URL` и `anon public key` в `config.js`.

## 2. Ключи для пушей
```bash
npx web-push generate-vapid-keys
```
Публичный ключ → `vapidPublicKey` в `config.js`. Приватный пригодится на шаге 3.

## 3. Edge Function (отправка пушей)
```bash
npx supabase login
npx supabase link --project-ref <ID проекта из URL>
npx supabase secrets set VAPID_PUBLIC_KEY=... VAPID_PRIVATE_KEY=... VAPID_SUBJECT=mailto:вашапочта WEBHOOK_SECRET=придумайте-длинную-строку
npx supabase functions deploy notify --no-verify-jwt
```

## 4. Вебхуки (когда слать пуш)
**Database → Webhooks → Create a new hook**, дважды:

| Имя | Таблица | События | Тип |
|---|---|---|---|
| notify_task | `tasks` | Insert | Supabase Edge Functions → `notify` |
| notify_log | `task_logs` | Insert, Update | Supabase Edge Functions → `notify` |

В обоих добавить HTTP-заголовок `x-webhook-secret` со значением из `WEBHOOK_SECRET`.

## 5. Хостинг
Залить папку на GitHub и включить Pages (Settings → Pages → Deploy from branch), либо перетащить папку на Cloudflare Pages. Получится адрес вида `https://имя.github.io/репо/`.

## 6. На iPhone (у обоих)
1. Открыть адрес в **Safari**.
2. Поделиться → **На экран «Домой»**.
3. Открыть приложение с иконки, создать аккаунт, нажать **Включить уведомления** и разрешить.

## 7. После регистрации обоих
**Authentication → Sign In / Providers → отключить «Allow new users to sign up»**, чтобы никто третий не зарегистрировался.
