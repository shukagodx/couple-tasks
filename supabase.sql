-- Выполнить один раз в Supabase: SQL Editor -> New query -> Run

create table profiles (
  id uuid primary key references auth.users on delete cascade,
  name text not null
);

create table tasks (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users on delete cascade,
  assigned_to uuid not null references auth.users on delete cascade,
  title text not null,
  note text,
  photo_path text,
  due_date date not null,           -- дата (для повторяющихся: с какой даты)
  due_time time,                    -- время, может быть пустым
  days int[] not null default '{}', -- дни недели 1=Пн..7=Вс; пусто = разовое задание
  created_at timestamptz not null default now()
);

create table task_logs (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks on delete cascade,
  date date not null,
  status text not null check (status in ('done', 'failed')),
  by uuid not null references auth.users,
  created_at timestamptz not null default now(),
  unique (task_id, date)
);

create table comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references tasks on delete cascade,
  author uuid not null references auth.users,
  body text not null,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;
alter table tasks enable row level security;
alter table task_logs enable row level security;
alter table comments enable row level security;

create policy "profiles read" on profiles for select to authenticated using (true);
create policy "profiles insert" on profiles for insert to authenticated with check (id = auth.uid());
create policy "profiles update" on profiles for update to authenticated using (id = auth.uid());

create policy "tasks read" on tasks for select to authenticated
  using (auth.uid() in (created_by, assigned_to));
create policy "tasks insert" on tasks for insert to authenticated
  with check (created_by = auth.uid());
create policy "tasks delete" on tasks for delete to authenticated
  using (created_by = auth.uid());

create policy "logs read" on task_logs for select to authenticated
  using (exists (select 1 from tasks t where t.id = task_id and auth.uid() in (t.created_by, t.assigned_to)));
create policy "logs insert" on task_logs for insert to authenticated
  with check (by = auth.uid() and exists (select 1 from tasks t where t.id = task_id and t.assigned_to = auth.uid()));
create policy "logs update" on task_logs for update to authenticated
  using (exists (select 1 from tasks t where t.id = task_id and t.assigned_to = auth.uid()));

create policy "comments read" on comments for select to authenticated
  using (exists (select 1 from tasks t where t.id = task_id and auth.uid() in (t.created_by, t.assigned_to)));
create policy "comments insert" on comments for insert to authenticated
  with check (author = auth.uid() and exists (select 1 from tasks t where t.id = task_id and auth.uid() in (t.created_by, t.assigned_to)));

-- Хранилище для фото (приватное)
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict do nothing;
create policy "photos read" on storage.objects for select to authenticated using (bucket_id = 'photos');
create policy "photos write" on storage.objects for insert to authenticated with check (bucket_id = 'photos');

-- Подписки на пуши
create table push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);
alter table push_subscriptions enable row level security;
create policy "subs select" on push_subscriptions for select to authenticated using (user_id = auth.uid());
create policy "subs insert" on push_subscriptions for insert to authenticated with check (user_id = auth.uid());
create policy "subs update" on push_subscriptions for update to authenticated using (user_id = auth.uid());
create policy "subs delete" on push_subscriptions for delete to authenticated using (user_id = auth.uid());

-- Живое обновление
alter publication supabase_realtime add table tasks, task_logs, comments;
