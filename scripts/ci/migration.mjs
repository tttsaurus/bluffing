// Exercises the real PostgreSQL V4 -> current backfill in a rolled-back, isolated schema.
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
const database = process.env.QA_DATABASE
if (!database || !/^blufftable_.*qa$/.test(database)) throw new Error('Set QA_DATABASE to an explicit disposable blufftable_*qa database')
const directory = new URL('../../server/src/main/resources/db/migration/', import.meta.url)
const read = file => readFileSync(new URL(file, directory),'utf8')
const schema = `migration_qa_${Date.now()}`
const sql = `BEGIN; CREATE SCHEMA ${schema}; SET LOCAL search_path TO ${schema};
${['V1__initial_schema.sql','V2__bind_players_to_device_tokens.sql','V3__room_presence_and_root_accounts.sql','V4__room_skins.sql'].map(read).join('\n')}
INSERT INTO players (id,display_name,created_at) VALUES ('00000000-0000-0000-0000-000000000001','One',now()),('00000000-0000-0000-0000-000000000002','Two',now());
INSERT INTO rooms (id,name,game_type,status,host_id,created_at,equipped_skin) VALUES ('00000000-0000-0000-0000-000000000003','Legacy','LIARS_DECK','LOBBY','00000000-0000-0000-0000-000000000001',now(),'AURORA');
INSERT INTO room_memberships (id,room_id,player_id,seat_index,balance,active,joined_at) VALUES
('00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000001',0,140,true,now()),
('00000000-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000002',1,140,false,now());
INSERT INTO room_skins (room_id,skin_id) VALUES ('00000000-0000-0000-0000-000000000003','AURORA');
${read('V5__player_skins_and_room_records.sql')}
${read('V6__game_balance_snapshots.sql')}
${read('V7__player_avatars.sql')}
${read('V8__avatar_purchases.sql')}
${read('V9__root_debug_identity.sql')}
DO $$ BEGIN
  IF (SELECT count(*) FROM member_skins WHERE skin_id='AURORA') <> 2 THEN RAISE EXCEPTION 'Missing migrated ownership'; END IF;
  IF (SELECT count(*) FROM room_memberships WHERE equipped_skin='AURORA' AND balance=140 AND wins=0 AND best_streak=0) <> 2 THEN RAISE EXCEPTION 'Migration changed balances or equipment'; END IF;
  IF (SELECT count(*) FROM room_memberships WHERE active=false) <> 1 THEN RAISE EXCEPTION 'Inactive seat changed'; END IF;
  IF (SELECT count(*) FROM room_memberships WHERE game_start_balance IS NOT NULL) <> 0 THEN RAISE EXCEPTION 'Migration created a live game checkpoint'; END IF;
  IF (SELECT count(*) FROM room_memberships WHERE equipped_avatar='DEFAULT' AND balance=140) <> 2 THEN RAISE EXCEPTION 'Avatar migration changed existing memberships'; END IF;
  IF (SELECT count(*) FROM member_avatars) <> 0 THEN RAISE EXCEPTION 'Avatar migration invented purchases'; END IF;
END $$;
INSERT INTO member_avatars (membership_id,avatar_id) VALUES ('00000000-0000-0000-0000-000000000004','PORTRAIT');
DELETE FROM rooms WHERE id='00000000-0000-0000-0000-000000000003';
DO $$ BEGIN
  IF (SELECT count(*) FROM room_memberships) <> 0 OR (SELECT count(*) FROM member_avatars) <> 0 OR (SELECT count(*) FROM member_skins) <> 0 THEN RAISE EXCEPTION 'Room deletion left orphan memberships or purchases'; END IF;
END $$;
ROLLBACK;`
const args = ['-X', '-v', 'ON_ERROR_STOP=1', '-U', process.env.PGUSER || 'blufftable', '-d', database]
const local = process.env.QA_RUNTIME === 'local'
execFileSync(local ? 'psql' : process.env.QA_RUNTIME || 'podman',
  local ? args : ['exec', '-i', process.env.QA_CONTAINER || 'blufftable-db', 'psql', ...args],
  { input: sql, stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000 })
console.log('PASS: V4–V9 preserve balances and ownership, add default avatars and debug identities, and cascade room deletion through purchases; all test schema changes rolled back.')
