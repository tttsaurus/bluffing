package com.blufftable.game;

import java.util.List;
import java.util.UUID;

public record GameView(
        UUID gameId,
        String phase,
        int deckCount,
        Integer cardsPerPlayer,
        UUID currentPlayerId,
        UUID initializerId,
        String targetRank,
        int poolSize,
        int generation,
        int consecutiveFolds,
        ClaimView lastClaim,
        List<Card> hand,
        List<HandCount> hands,
        List<String> events,
        UUID winnerId,
        List<UUID> participants,
        ClaimView pendingClaim,
        List<Earnings> earnings,
        List<Outcome> outcomes,
        List<PlayView> plays,
        SpellingView spelling,
        UUID lastNonFoldedPlayerId
) {
    public record SpellingView(UUID id, String stage, long serverNow, long deadline, int penalty,
                               String audioUrl, boolean submitted, List<SpellingResult> results,
                               int submittedCount, int playerCount) {}
    public record SpellingResult(UUID playerId, String word, String answer, boolean correct, int drawn) {}
    public record PlayView(long id, UUID playerId, String declaredRank, int cardCount,
                           String status, UUID challengerId, List<Card> revealedCards) {
        public PlayView forViewer(UUID viewerId) {
            return new PlayView(id, playerId, declaredRank, cardCount, status, challengerId,
                    viewerId != null && viewerId.equals(challengerId) ? revealedCards : List.of());
        }
    }
    public record ClaimView(UUID playerId, int cardCount, int generation, long risk) {}
    public record HandCount(UUID playerId, int cardCount) {}
    public record Earnings(UUID playerId, long amount) {}
    // Receipts share the verdict; only the initiating challenger receives checked card faces.
    public record Outcome(long id, String type, UUID playerId, UUID challengerId,
                          UUID rewardPlayerId, long amount, int poolSize, String declaredRank, List<Card> revealedCards) {
        public Outcome forViewer(UUID viewerId) {
            return new Outcome(id, type, playerId, challengerId, rewardPlayerId, amount, poolSize, declaredRank,
                    viewerId != null && viewerId.equals(challengerId) ? revealedCards : List.of());
        }
    }
}
