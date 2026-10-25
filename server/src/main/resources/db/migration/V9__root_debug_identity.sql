ALTER TABLE players ADD COLUMN debug_owner_id UUID UNIQUE REFERENCES players(id);
