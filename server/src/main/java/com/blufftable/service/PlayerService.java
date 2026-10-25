package com.blufftable.service;

import com.blufftable.api.ApiModels.PlayerRequest;
import com.blufftable.api.ApiModels.PlayerView;
import com.blufftable.api.ApiModels.DebugIdentityView;
import com.blufftable.api.ApiModels.RenamePlayerRequest;
import com.blufftable.domain.Player;
import com.blufftable.repository.PlayerRepository;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

@Service
public class PlayerService {
    private final PlayerRepository players;

    public PlayerService(PlayerRepository players) { this.players = players; }

    @Transactional
    public PlayerView upsert(PlayerRequest request) {
        return upsert(request, false);
    }

    @Transactional
    public PlayerView upsert(PlayerRequest request, boolean grantRoot) {
        String name = request.displayName().trim();
        String tokenHash = DeviceTokens.hash(request.deviceToken());
        Player player = players.findByDeviceTokenHash(tokenHash).orElseGet(() -> claimLegacyOrCreate(request, name, tokenHash));
        if (grantRoot && player.getDebugOwnerId() == null) player.grantRootAccess();
        players.save(player);
        return view(player);
    }

    @Transactional
    public PlayerView rename(Player player, RenamePlayerRequest request) {
        player.setDisplayName(request.displayName().trim());
        return view(players.save(player));
    }

    /** Stable, domain-separated credential, obtainable only with the owner's root credential. */
    @Transactional
    public DebugIdentityView debugIdentity(Player owner) {
        if (!owner.isRootAccount() || owner.getDebugOwnerId() != null) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only root can use a debug identity");
        }
        // Serialize first creation across simultaneous tabs without rotating an existing bot's token.
        players.lockById(owner.getId()).orElseThrow();
        String token = DeviceTokens.hash("debug-identity-v1:" + owner.getDeviceTokenHash());
        String tokenHash = DeviceTokens.hash(token);
        Player bot = players.findByDeviceTokenHash(tokenHash).orElseGet(() -> {
            Player created = new Player(UUID.randomUUID(), "Debug bot", tokenHash);
            created.setDebugOwnerId(owner.getId());
            return players.save(created);
        });
        return new DebugIdentityView(view(bot), token);
    }

    private Player claimLegacyOrCreate(PlayerRequest request, String name, String tokenHash) {
        if (request.legacyPlayerId() != null) {
            var legacy = players.findById(request.legacyPlayerId());
            if (legacy.isPresent() && legacy.get().getDeviceTokenHash() == null) {
                legacy.get().bindDeviceTokenHash(tokenHash);
                return legacy.get();
            }
        }
        return new Player(UUID.randomUUID(), name, tokenHash);
    }

    private static PlayerView view(Player player) {
        return new PlayerView(player.getId(), player.getDisplayName(), player.identityTag(), player.isRootAccount());
    }
}
