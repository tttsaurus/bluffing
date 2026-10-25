package com.blufftable.api;

import com.blufftable.domain.GameType;
import com.blufftable.domain.RoomStatus;
import com.blufftable.game.GameView;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

public final class ApiModels {
    private ApiModels() {}

    public record PlayerRequest(UUID legacyPlayerId, @NotBlank @Size(max = 24) String displayName,
                                @NotBlank @Size(min = 32, max = 200) String deviceToken) {}
    public record RenamePlayerRequest(@NotBlank @Size(max = 24) String displayName) {}
    public record PlayerView(UUID id, String displayName, String identityTag, boolean root) {}
    public record DebugIdentityView(PlayerView player, String deviceToken) {}
    public record CreateRoomRequest(@Size(max = 40) String name, @NotNull GameType gameType) {}
    public record StartGameRequest(int deckCount, Integer cardsPerPlayer, boolean randomDeckCount) {
        public StartGameRequest(int deckCount, Integer cardsPerPlayer) { this(deckCount, cardsPerPlayer, false); }
    }
    public record StopGameRequest(UUID gameId) {}
    public record AvatarView(String id, String name, long price, boolean owned) {}
    public record AvatarRequest(@NotNull com.blufftable.domain.Avatar avatarId) {}
    public record SkinRequest(@NotNull com.blufftable.domain.CardSkin skinId) {}
    public record SkinView(String id, String name, String effect, long price, boolean owned) {}
    public record MemberView(UUID id, String displayName, String identityTag, int seatIndex, long balance,
                             boolean host, String presence, String equippedSkin, String equippedAvatar) {}
    public record PlayerRecord(UUID playerId, String displayName, String identityTag,
                               long wins, long currentStreak, long bestStreak) {}
    public record RoomSummary(UUID id, String name, GameType gameType, RoomStatus status, UUID hostId,
                              int playerCount, int maxPlayers, int activePlayerCount,
                              Instant createdAt, boolean joined) {}
    public record RoomView(UUID id, String name, GameType gameType, RoomStatus status, UUID hostId,
                           List<MemberView> players, GameView game, List<SkinView> skins,
                           List<PlayerRecord> records, String notice, List<AvatarView> avatars) {}
    public record ErrorView(String message) {}
}
