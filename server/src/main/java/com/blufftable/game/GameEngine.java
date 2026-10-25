package com.blufftable.game;

import com.blufftable.domain.GameType;
import com.blufftable.domain.RoomMembership;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface GameEngine {
    GameType type();
    void start(UUID roomId, List<RoomMembership> members, GameStartSettings settings);
    void command(UUID playerId, GameCommand command);
    Optional<GameView> view(UUID roomId, UUID viewerId);
    void depart(UUID roomId, UUID playerId);
    void remove(UUID roomId);
    default List<UUID> dueRooms() { return List.of(); }
    default boolean tick(UUID roomId) { return false; }
}
