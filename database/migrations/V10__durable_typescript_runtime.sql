-- One-time recovery of legacy Java games, whose hands existed only in RAM.
UPDATE room_memberships SET balance = COALESCE(game_start_balance, balance), game_start_balance = NULL;
UPDATE rooms SET status = 'LOBBY', last_notice = 'Backend upgraded. Any unfinished deal was cancelled and room wallets restored.' WHERE status = 'IN_GAME';
ALTER TABLE rooms ADD COLUMN game_state JSONB;

CREATE TABLE live_sessions (
    id UUID PRIMARY KEY,
    connection_id UUID NOT NULL,
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    room_id UUID REFERENCES rooms(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX live_sessions_player_idx ON live_sessions(player_id, expires_at);
CREATE INDEX live_sessions_room_idx ON live_sessions(room_id, expires_at);
CREATE INDEX live_sessions_expiry_idx ON live_sessions(expires_at);

CREATE TABLE game_commands (
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    player_id UUID NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    request_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY(room_id, player_id, request_id)
);
