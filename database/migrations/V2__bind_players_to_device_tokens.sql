alter table players add column device_token_hash varchar(64);

create unique index players_device_token_hash_uq
    on players(device_token_hash)
    where device_token_hash is not null;

