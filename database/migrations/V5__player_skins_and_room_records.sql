ALTER TABLE room_memberships ADD COLUMN equipped_skin VARCHAR(32) NOT NULL DEFAULT 'CLASSIC';
ALTER TABLE room_memberships ADD COLUMN wins BIGINT NOT NULL DEFAULT 0;
ALTER TABLE room_memberships ADD COLUMN current_streak BIGINT NOT NULL DEFAULT 0;
ALTER TABLE room_memberships ADD COLUMN best_streak BIGINT NOT NULL DEFAULT 0;
ALTER TABLE rooms ADD COLUMN last_recorded_game_id UUID;
ALTER TABLE rooms ADD COLUMN last_notice VARCHAR(160);

CREATE TABLE member_skins (
    membership_id UUID NOT NULL REFERENCES room_memberships(id) ON DELETE CASCADE,
    skin_id VARCHAR(32) NOT NULL,
    PRIMARY KEY (membership_id, skin_id)
);

-- V4 did not record a buyer. Preserve existing entitlements for every existing
-- membership, including deactivated seats, instead of guessing who paid.
INSERT INTO member_skins (membership_id, skin_id)
SELECT m.id, s.skin_id FROM room_memberships m JOIN room_skins s ON s.room_id = m.room_id;
UPDATE room_memberships m SET equipped_skin = r.equipped_skin
FROM rooms r WHERE r.id = m.room_id;
-- Retain the legacy columns/table as migration history; the application no longer uses them.
