alter table players add column root_account boolean not null default false;

alter table room_memberships add column active boolean not null default true;

alter table room_memberships drop constraint if exists room_memberships_room_id_seat_index_key;

create index room_memberships_active_room_idx
    on room_memberships(room_id, active);
