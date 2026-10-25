create table players (
    id uuid primary key,
    display_name varchar(24) not null,
    created_at timestamp with time zone not null
);

create table rooms (
    id uuid primary key,
    name varchar(40) not null,
    game_type varchar(32) not null,
    status varchar(20) not null,
    host_id uuid not null references players(id),
    created_at timestamp with time zone not null,
    version bigint not null default 0
);

create table room_memberships (
    id uuid primary key,
    room_id uuid not null references rooms(id) on delete cascade,
    player_id uuid not null references players(id),
    seat_index integer not null,
    balance bigint not null default 0,
    joined_at timestamp with time zone not null,
    unique(room_id, player_id),
    unique(room_id, seat_index)
);

create index room_memberships_room_idx on room_memberships(room_id);

