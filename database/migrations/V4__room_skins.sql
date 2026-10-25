ALTER TABLE rooms ADD COLUMN equipped_skin VARCHAR(32) NOT NULL DEFAULT 'CLASSIC';
CREATE TABLE room_skins (
    room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    skin_id VARCHAR(32) NOT NULL,
    PRIMARY KEY (room_id, skin_id)
);
