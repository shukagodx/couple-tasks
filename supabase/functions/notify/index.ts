// Edge Function: рассылает пуши по вебхукам базы данных
//  - INSERT в tasks      -> пуш тому, кому поставили задание
//  - INSERT/UPDATE в task_logs -> пуш тому, кто поставил задание
import { createClient } from 'jsr:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

webpush.setVapidDetails(
  Deno.env.get('VAPID_SUBJECT')!,
  Deno.env.get('VAPID_PUBLIC_KEY')!,
  Deno.env.get('VAPID_PRIVATE_KEY')!,
);

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

async function nameOf(id: string): Promise<string> {
  const { data } = await sb.from('profiles').select('name').eq('id', id).maybeSingle();
  return data?.name ?? 'Кто-то';
}

async function push(userId: string, payload: { title: string; body: string; tag?: string }) {
  const { data: subs } = await sb.from('push_subscriptions').select('*').eq('user_id', userId);
  await Promise.all((subs ?? []).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
      );
    } catch (err) {
      const code = (err as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await sb.from('push_subscriptions').delete().eq('id', s.id);
      else console.error('push failed', code, err);
    }
  }));
}

Deno.serve(async (req) => {
  if (req.headers.get('x-webhook-secret') !== Deno.env.get('WEBHOOK_SECRET')) {
    return new Response('forbidden', { status: 403 });
  }
  const { table, type, record } = await req.json();

  if (table === 'tasks' && type === 'INSERT') {
    const from = await nameOf(record.created_by);
    await push(record.assigned_to, { title: `Новое задание от ${from}`, body: record.title, tag: `task-${record.id}` });
  }

  if (table === 'task_logs' && (type === 'INSERT' || type === 'UPDATE')) {
    const { data: task } = await sb.from('tasks').select('title, created_by').eq('id', record.task_id).maybeSingle();
    if (task && task.created_by !== record.by) {
      const who = await nameOf(record.by);
      const verdict = record.status === 'done' ? 'выполнено ✓' : 'не выполнено ✕';
      await push(task.created_by, { title: `${who}: ${verdict}`, body: task.title, tag: `log-${record.id}` });
    }
  }

  return new Response('ok');
});
