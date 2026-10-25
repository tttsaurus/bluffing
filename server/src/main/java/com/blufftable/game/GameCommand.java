package com.blufftable.game;

import java.util.List;
import java.util.UUID;

public record GameCommand(
        UUID roomId,
        GameAction action,
        List<UUID> cardIds,
        String declaredRank,
        UUID spellingId,
        String answer
) {
    public GameCommand(UUID roomId, GameAction action, List<UUID> cardIds, String declaredRank) {
        this(roomId, action, cardIds, declaredRank, null, null);
    }
    public GameCommand {
        cardIds = cardIds == null ? List.of() : List.copyOf(cardIds);
    }
}

