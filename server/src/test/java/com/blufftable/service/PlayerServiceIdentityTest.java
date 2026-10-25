package com.blufftable.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.blufftable.api.ApiModels.PlayerRequest;
import com.blufftable.api.ApiModels.RenamePlayerRequest;
import com.blufftable.domain.Player;
import com.blufftable.repository.PlayerRepository;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class PlayerServiceIdentityTest {
    private static final String TOKEN_ONE = "device-token-one-with-at-least-thirty-two-characters";
    private static final String TOKEN_TWO = "device-token-two-with-at-least-thirty-two-characters";
    private final Map<UUID, Player> stored = new HashMap<>();
    private PlayerService service;

    @BeforeEach
    void setUp() {
        PlayerRepository repository = mock(PlayerRepository.class);
        when(repository.findById(any())).thenAnswer(invocation -> Optional.ofNullable(stored.get(invocation.getArgument(0))));
        lenient().when(repository.lockById(any())).thenAnswer(invocation -> Optional.ofNullable(stored.get(invocation.getArgument(0))));
        when(repository.findByDeviceTokenHash(any())).thenAnswer(invocation -> stored.values().stream()
                .filter(player -> invocation.getArgument(0).equals(player.getDeviceTokenHash())).findFirst());
        when(repository.save(any())).thenAnswer(invocation -> {
            Player player = invocation.getArgument(0);
            stored.put(player.getId(), player);
            return player;
        });
        service = new PlayerService(repository);
    }

    @Test
    void sameDeviceTokenRestoresTheSamePlayer() {
        var first = service.upsert(new PlayerRequest(null, "Ada", TOKEN_ONE));
        var restored = service.upsert(new PlayerRequest(null, "Ada Lovelace", TOKEN_ONE));

        assertThat(restored.id()).isEqualTo(first.id());
        assertThat(restored.displayName()).isEqualTo("Ada"); // A stale tab must not rename the account on reconnect.
    }

    @Test
    void differentDeviceTokensCreateDifferentPlayers() {
        var first = service.upsert(new PlayerRequest(null, "Ada", TOKEN_ONE));
        var second = service.upsert(new PlayerRequest(null, "Ada", TOKEN_TWO));

        assertThat(second.id()).isNotEqualTo(first.id());
        assertThat(second.displayName()).isEqualTo(first.displayName());
        assertThat(second.identityTag()).isNotEqualTo(first.identityTag());
    }

    @Test
    void rootGetsOnePersistentNonRootDebugIdentityWithIndependentCredentials() {
        var root = service.upsert(new PlayerRequest(null, "Dealer", TOKEN_ONE), true);
        var debug = service.debugIdentity(stored.get(root.id()));
        var again = service.debugIdentity(stored.get(root.id()));
        assertThat(again).isEqualTo(debug);
        assertThat(debug.player().id()).isNotEqualTo(root.id());
        assertThat(debug.player().root()).isFalse();
        assertThat(debug.deviceToken()).isNotEqualTo(TOKEN_ONE);
        assertThat(stored.get(debug.player().id()).getDebugOwnerId()).isEqualTo(root.id());
        var restored = service.upsert(new PlayerRequest(null, "Bot", debug.deviceToken()), true);
        assertThat(restored.root()).isFalse();
        assertThat(restored.id()).isEqualTo(debug.player().id());
        assertThatThrownBy(() -> service.debugIdentity(stored.get(debug.player().id())))
                .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    }

    @Test
    void ordinaryAccountsCannotProvisionDebugIdentities() {
        var account = service.upsert(new PlayerRequest(null, "Player", TOKEN_ONE));
        assertThatThrownBy(() -> service.debugIdentity(stored.get(account.id())))
                .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        assertThat(stored).hasSize(1);
    }

    @Test
    void differentRootsHaveSeparatePersistentDebugBots() {
        var first = service.upsert(new PlayerRequest(null, "First", TOKEN_ONE), true);
        var second = service.upsert(new PlayerRequest(null, "Second", TOKEN_TWO), true);
        var firstBot = service.debugIdentity(stored.get(first.id()));
        var secondBot = service.debugIdentity(stored.get(second.id()));
        assertThat(firstBot.player().id()).isNotEqualTo(secondBot.player().id());
        assertThat(firstBot.deviceToken()).isNotEqualTo(secondBot.deviceToken());
    }

    @Test
    void serverRunnerGrantPersistsAndNicknameCanChange() {
        var root = service.upsert(new PlayerRequest(null, "Dealer", TOKEN_ONE), true);
        Player storedRoot = stored.get(root.id());
        var renamed = service.rename(storedRoot, new RenamePlayerRequest("House"));

        assertThat(renamed.root()).isTrue();
        assertThat(renamed.displayName()).isEqualTo("House");
        assertThat(renamed.identityTag()).isEqualTo(root.identityTag());
    }

    @Test
    void legacyPlayerCanBeBoundOnceWithoutLosingItsId() {
        UUID legacyId = UUID.randomUUID();
        stored.put(legacyId, new Player(legacyId, "Ada"));

        var migrated = service.upsert(new PlayerRequest(legacyId, "Ada", TOKEN_ONE));

        assertThat(migrated.id()).isEqualTo(legacyId);
        assertThat(stored.get(legacyId).getDeviceTokenHash()).isEqualTo(DeviceTokens.hash(TOKEN_ONE));
    }
}
