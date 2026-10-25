CREATE TABLE member_avatars (
    membership_id UUID NOT NULL REFERENCES room_memberships(id) ON DELETE CASCADE,
    avatar_id VARCHAR(32) NOT NULL,
    PRIMARY KEY (membership_id, avatar_id)
);
