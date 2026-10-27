import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

it('queues only agency leads and meetings while retaining tenant proposals and payments', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create table leads(id int primary key, tenant_id int);
      create table meetings(id int primary key, tenant_id int);
      create table proposals(id int primary key, tenant_id int);
      create table payments(id int primary key, tenant_id int);
      create table sheet_outbox(entity text, entity_id int);
      create function enqueue_sheet_sync() returns trigger language plpgsql as $$
      begin insert into sheet_outbox values(tg_argv[0], new.id); return new; end $$;
      create trigger leads_to_sheet after insert or update on leads for each row execute function enqueue_sheet_sync('lead');
      create trigger meetings_to_sheet after insert or update on meetings for each row execute function enqueue_sheet_sync('meeting');
      create trigger proposals_to_sheet after insert or update on proposals for each row execute function enqueue_sheet_sync('proposal');
      create trigger payments_to_sheet after insert or update on payments for each row execute function enqueue_sheet_sync('payment');`);
    await db.exec(readFileSync(new URL('../supabase/migrations/20261027000000_scope_sheet_outbox.sql', import.meta.url), 'utf8'));
    await db.exec(`insert into leads values (1,null),(2,1); update leads set tenant_id=1 where id=2;
      insert into meetings values (3,null),(4,1); update meetings set tenant_id=1 where id=4;
      insert into proposals values (5,1); insert into payments values (6,1);`);
    expect((await db.query('select entity, entity_id from sheet_outbox order by entity_id')).rows).toEqual([
      {entity:'lead',entity_id:1}, {entity:'meeting',entity_id:3},
      {entity:'proposal',entity_id:5}, {entity:'payment',entity_id:6},
    ]);
  } finally { await db.close(); }
});
