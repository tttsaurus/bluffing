package com.blufftable.service;

import com.blufftable.api.ApiModels.*;
import com.blufftable.domain.*;
import com.blufftable.game.*;
import com.blufftable.repository.*;
import java.util.Comparator;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.stream.IntStream;
import com.blufftable.websocket.PresenceRegistry;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class RoomService {
    private static final int MAX_PLAYERS = 8;
    private final RoomRepository rooms;
    private final PlayerRepository players;
    private final RoomMembershipRepository memberships;
    private final GameEngineRegistry engines;
    private final PresenceRegistry presence;
    private final RoomNameGenerator names;

    public RoomService(RoomRepository rooms, PlayerRepository players, RoomMembershipRepository memberships,
                       GameEngineRegistry engines, PresenceRegistry presence, RoomNameGenerator names) {
        this.rooms = rooms;
        this.players = players;
        this.memberships = memberships;
        this.engines = engines;
        this.presence = presence;
        this.names = names;
    }

    @Transactional(readOnly = true)
    public List<RoomSummary> list(UUID playerId) {
        return rooms.findAll().stream()
                .sorted(Comparator.comparing(Room::getCreatedAt).reversed())
                .map(room -> new RoomSummary(room.getId(), room.getName(), room.getGameType(), room.getStatus(),
                        room.getHost().getId(), (int) memberships.countByRoomIdAndActiveTrue(room.getId()),
                        MAX_PLAYERS, (int) memberships.findByRoomIdAndActiveTrueOrderBySeatIndex(room.getId()).stream()
                            .filter(m -> presence.isInRoom(m.getPlayer().getId(), room.getId())).count(), room.getCreatedAt(),
                        playerId != null && memberships.existsByRoomIdAndPlayerIdAndActiveTrue(room.getId(), playerId)))
                .toList();
    }

    @Transactional
    public RoomView create(UUID playerId, CreateRoomRequest request) {
        Player host = players.findById(playerId).orElseThrow(() -> notFound("Player not found"));
        String requestedName = request.name() == null ? "" : request.name().trim();
        Room room = rooms.save(new Room(UUID.randomUUID(), requestedName.isBlank() ? names.next() : requestedName,
                request.gameType(), host));
        memberships.save(new RoomMembership(room, host, 0));
        return viewInternal(room, playerId);
    }

    @Transactional
    public RoomView join(UUID roomId, UUID playerId) {
        Room room = lockRoom(roomId);
        if (room.getStatus() != RoomStatus.LOBBY) throw conflict("A game is already running");
        var existing = memberships.findByRoomIdAndPlayerId(roomId, playerId);
        if (existing.filter(RoomMembership::isActive).isPresent()) return viewInternal(room, playerId);
        if (memberships.countByRoomIdAndActiveTrue(roomId) >= MAX_PLAYERS) throw conflict("This room is full");
        Player player = players.findById(playerId).orElseThrow(() -> notFound("Player not found"));
        int seat = nextSeat(roomId);
        if (existing.isPresent()) {
            existing.get().activate(seat);
            memberships.save(existing.get());
        } else {
            memberships.save(new RoomMembership(room, player, seat));
        }
        if (!memberships.existsByRoomIdAndPlayerIdAndActiveTrue(roomId, room.getHost().getId())) {
            room.setHost(player);
        }
        return viewInternal(room, playerId);
    }

    @Transactional
    public void delete(UUID roomId, UUID playerId) {
        Room room = lockRoom(roomId);
        Player actor = players.findById(playerId).orElseThrow(() -> notFound("Player not found"));
        requireHostOrRoot(room, actor);
        engines.require(room.getGameType()).remove(roomId);
        rooms.delete(room);
    }

    @Transactional
    public RoomView kick(UUID roomId, UUID actorId, UUID targetId) {
        Room room = lockRoom(roomId);
        Player actor = players.findById(actorId).orElseThrow(() -> notFound("Player not found"));
        requireHostOrRoot(room, actor);
        if (actorId.equals(targetId) && !actor.isRootAccount()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "The host cannot kick themselves");
        }
        RoomMembership target = memberships.findByRoomIdAndPlayerId(roomId, targetId)
                .filter(RoomMembership::isActive).orElseThrow(() -> notFound("Active player not found"));
        target.deactivate();
        if (room.getStatus() == RoomStatus.IN_GAME) {
            engines.require(room.getGameType()).depart(roomId, targetId);
            updateFinishedStatus(room, actorId);
        }
        if (room.getHost().getId().equals(targetId)) {
            memberships.findByRoomIdAndActiveTrueOrderBySeatIndex(roomId).stream()
                .findFirst().ifPresent(member -> room.setHost(member.getPlayer()));
        }
        return viewInternal(room, actorId);
    }

    @Transactional
    public RoomView start(UUID roomId, UUID playerId, StartGameRequest request) {
        Room room = lockRoom(roomId);
        requireHost(room, playerId);
        if (room.getStatus() == RoomStatus.IN_GAME) throw conflict("A game is already running");
        // Durable room seats are not the game roster: away/offline members sit this deal out.
        List<RoomMembership> members = memberships.findByRoomIdAndActiveTrueOrderBySeatIndex(roomId).stream()
                .filter(member -> presence.isInRoom(member.getPlayer().getId(), roomId)).toList();
        if (members.size() < 2) throw conflict("At least two players must be online inside this room before dealing");
        GameStartSettings settings = new GameStartSettings(request.deckCount(), request.cardsPerPlayer(), request.randomDeckCount());
        // Persist the pre-deal wallet checkpoint before any game reward can settle.
        memberships.findByRoomId(roomId).forEach(RoomMembership::commitGameBalance);
        members.forEach(RoomMembership::snapshotGameBalance);
        engines.require(room.getGameType()).start(roomId, members, settings);
        room.setStatus(RoomStatus.IN_GAME);
        room.setLastNotice(null);
        return viewInternal(room, playerId);
    }

    @Transactional
    public boolean advanceTimedGame(UUID roomId) {
        // Each room settles in its own transaction. A deleted room or a failure in
        // another table must not roll back rewards from an already settled timer.
        Room room = rooms.findWithLockById(roomId).orElse(null);
        if (room == null || room.getStatus() != RoomStatus.IN_GAME) return false;
        GameEngine engine = engines.require(room.getGameType());
        if (!engine.tick(roomId)) return false;
        updateFinishedStatus(room, room.getHost().getId());
        return true;
    }

    @Transactional
    public void command(UUID playerId, GameCommand command) {
        Room room = lockRoom(command.roomId());
        if (!presence.isInRoom(playerId, room.getId())) throw conflict("Enter the room before playing");
        if (!memberships.existsByRoomIdAndPlayerIdAndActiveTrue(room.getId(), playerId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Join the room before playing");
        }
        GameEngine engine = engines.require(room.getGameType());
        engine.command(playerId, command);
        updateFinishedStatus(room, playerId);
    }

    @Transactional
    public RoomView stop(UUID roomId, UUID actorId, StopGameRequest request) {
        Room room = lockRoom(roomId);
        Player actor = players.findById(actorId).orElseThrow(() -> notFound("Player not found"));
        requireHostOrRoot(room, actor);
        GameEngine engine = engines.require(room.getGameType());
        var game = engine.view(roomId, actorId);
        if (game.isPresent() && !java.util.Objects.equals(request.gameId(), game.get().gameId())) {
            throw conflict("The deal changed. Review the current table before stopping it");
        }
        restoreGameBalances(roomId);
        // Recovery must work even when the room says IN_GAME but its engine has no state.
        engine.remove(roomId);
        room.setStatus(RoomStatus.LOBBY);
        room.setLastNotice("Deal stopped by " + actor.getDisplayName() + " #" + actor.identityTag()
            + ". Every room wallet was restored to its pre-deal balance. Rankings unchanged.");
        return viewInternal(room, actorId);
    }

    @Transactional(readOnly = true)
    public RoomView view(UUID roomId, UUID viewerId) {
        Room room = requireRoom(roomId);
        requireAccess(room, viewerId);
        return viewInternal(room, viewerId);
    }

    @Transactional
    public UUID enter(UUID roomId, UUID playerId, String sessionId) {
        Room room = lockRoom(roomId);
        requireAccess(room, playerId);
        return presence.enterRoom(sessionId, roomId).orElse(null);
    }

    @Transactional
    public void departed(UUID roomId, UUID playerId) {
        Room room = rooms.findWithLockById(roomId).orElse(null);
        if (room == null || presence.isInRoom(playerId, roomId)) return;
        engines.require(room.getGameType()).depart(roomId, playerId);
        updateFinishedStatus(room, playerId);
    }

    @Transactional
    public RoomView skin(UUID roomId, UUID playerId, SkinRequest request, boolean purchase) {
        Room room = lockRoom(roomId);
        if (purchase && room.getStatus() == RoomStatus.IN_GAME) {
            throw conflict("Unlock new decks between deals; owned decks can still be equipped now");
        }
        RoomMembership buyer = memberships.findWithLockByRoomIdAndPlayerId(roomId, playerId)
            .filter(RoomMembership::isActive).orElseThrow(() -> conflict("Join this room to use its deck shop"));
        CardSkin skin = request.skinId();
        boolean owned = skin == CardSkin.CLASSIC || buyer.getUnlockedSkins().contains(skin.name());
        if (!owned) {
            if (!purchase) throw conflict("Unlock this skin first");
            if (buyer.getBalance() < skin.price) throw conflict("Not enough room coins");
            buyer.debit(skin.price);
            buyer.getUnlockedSkins().add(skin.name());
        }
        buyer.equipSkin(skin.name());
        return viewInternal(room, playerId);
    }

    @Transactional
    public RoomView avatar(UUID roomId, UUID playerId, AvatarRequest request) {
        return avatar(roomId, playerId, request, false);
    }

    @Transactional
    public RoomView avatar(UUID roomId, UUID playerId, AvatarRequest request, boolean purchase) {
        Room room = lockRoom(roomId);
        RoomMembership member = memberships.findWithLockByRoomIdAndPlayerId(roomId, playerId)
            .filter(RoomMembership::isActive).orElseThrow(() -> conflict("Join this room to equip an avatar"));
        Avatar avatar = request.avatarId();
        boolean owned = avatar.price == 0 || member.getUnlockedAvatars().contains(avatar.name());
        if (!owned) {
            if (!purchase) throw conflict("Unlock this avatar first");
            if (room.getStatus() == RoomStatus.IN_GAME) throw conflict("Unlock new avatars between deals");
            if (member.getBalance() < avatar.price) throw conflict("Not enough room coins");
            member.debit(avatar.price);
            member.getUnlockedAvatars().add(avatar.name());
        }
        member.equipAvatar(avatar);
        return viewInternal(room, playerId);
    }

    private void requireAccess(Room room, UUID playerId) {
        Player viewer = players.findById(playerId).orElseThrow(() -> notFound("Player not found"));
        // Moderators may inspect/recover a deal after leaving, but never regain a removed hand.
        if (viewer.isRootAccount() || room.getHost().getId().equals(playerId)) return;
        if (!memberships.existsByRoomIdAndPlayerIdAndActiveTrue(room.getId(), playerId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Join this room first");
        }
        var game = engines.require(room.getGameType()).view(room.getId(), playerId);
        if (game.filter(g -> "ACTIVE".equals(g.phase()) && g.hands().stream()
            .noneMatch(h -> h.playerId().equals(playerId))).isPresent()) {
            throw conflict("You are not in this deal. Wait for the next game to enter");
        }
    }

    private void updateFinishedStatus(Room room, UUID playerId) {
        engines.require(room.getGameType()).view(room.getId(), playerId)
            .filter(g -> "FINISHED".equals(g.phase())).ifPresent(game -> {
                room.setStatus(RoomStatus.LOBBY);
                if (game.winnerId() == null) {
                    restoreGameBalances(room.getId());
                    room.setLastNotice("Deal ended with one or fewer players. Every room wallet was restored to its pre-deal balance.");
                    return;
                }
                if (game.gameId().equals(room.getLastRecordedGameId())) {
                    commitGameBalances(room.getId());
                    return;
                }
                // Include departed/kicked participants, but never spectators or players who sat out.
                memberships.findByRoomId(room.getId()).stream()
                    .filter(member -> game.participants().contains(member.getPlayer().getId()))
                    .forEach(member -> member.recordResult(member.getPlayer().getId().equals(game.winnerId())));
                room.setLastRecordedGameId(game.gameId());
                commitGameBalances(room.getId());
            });
    }

    private void restoreGameBalances(UUID roomId) {
        memberships.findByRoomId(roomId).forEach(RoomMembership::restoreGameBalance);
    }

    private void commitGameBalances(UUID roomId) {
        memberships.findByRoomId(roomId).forEach(RoomMembership::commitGameBalance);
    }

    @Transactional(readOnly = true)
    public List<UUID> roomIdsForPlayer(UUID playerId) {
        return memberships.findActiveRoomIdsByPlayerId(playerId);
    }

    private RoomView viewInternal(Room room, UUID viewerId) {
        List<MemberView> memberViews = memberships.findByRoomIdAndActiveTrueOrderBySeatIndex(room.getId()).stream()
                .map(member -> new MemberView(member.getPlayer().getId(), member.getPlayer().getDisplayName(),
                        member.getPlayer().identityTag(), member.getSeatIndex(), member.getBalance(),
                        member.getPlayer().getId().equals(room.getHost().getId()), presenceOf(member, room), member.getEquippedSkin(), member.getEquippedAvatar()))
                .toList();
        GameView game = engines.require(room.getGameType()).view(room.getId(), viewerId).orElse(null);
        var owned = memberships.findByRoomIdAndPlayerId(room.getId(), viewerId)
            .map(RoomMembership::getUnlockedSkins).orElse(Set.of());
        List<PlayerRecord> records = memberships.findByRoomId(room.getId()).stream()
            .map(member -> new PlayerRecord(member.getPlayer().getId(), member.getPlayer().getDisplayName(),
                member.getPlayer().identityTag(), member.getWins(), member.getCurrentStreak(), member.getBestStreak()))
            .sorted(Comparator.comparingLong(PlayerRecord::wins).reversed().thenComparing(PlayerRecord::playerId)).toList();
        return new RoomView(room.getId(), room.getName(), room.getGameType(), room.getStatus(),
                room.getHost().getId(), memberViews, game,
                java.util.Arrays.stream(CardSkin.values()).map(skin -> new SkinView(skin.name(), skin.label,
                    skin.effect, skin.price, skin == CardSkin.CLASSIC || owned.contains(skin.name()))).toList(),
                records, room.getLastNotice(),
                java.util.Arrays.stream(Avatar.values()).map(avatar -> new AvatarView(avatar.name(), avatar.label,
                    avatar.price, avatar.price == 0 || memberships.findByRoomIdAndPlayerId(room.getId(), viewerId)
                        .map(member -> member.getUnlockedAvatars().contains(avatar.name())).orElse(false))).toList());
    }

    private Room lockRoom(UUID id) {
        return rooms.findWithLockById(id).orElseThrow(() -> notFound("Room not found"));
    }

    private Room requireRoom(UUID id) {
        return rooms.findById(id).orElseThrow(() -> notFound("Room not found"));
    }

    private int nextSeat(UUID roomId) {
        Set<Integer> used = memberships.findByRoomIdAndActiveTrueOrderBySeatIndex(roomId).stream()
                .map(RoomMembership::getSeatIndex).collect(java.util.stream.Collectors.toSet());
        return IntStream.range(0, MAX_PLAYERS).filter(index -> !used.contains(index)).findFirst()
                .orElseThrow(() -> conflict("This room is full"));
    }

    private String presenceOf(RoomMembership member, Room room) {
        UUID playerId = member.getPlayer().getId();
        if (presence.isInRoom(playerId, room.getId())) return "ACTIVE";
        return presence.isOnline(playerId) ? "AWAY" : "OFFLINE";
    }

    private static void requireHost(Room room, UUID playerId) {
        if (!room.getHost().getId().equals(playerId)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only the host can do that");
        }
    }

    private static void requireHostOrRoot(Room room, Player actor) {
        if (!actor.isRootAccount() && !room.getHost().getId().equals(actor.getId())) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Only the host or root can do that");
        }
    }

    private static ResponseStatusException notFound(String message) {
        return new ResponseStatusException(HttpStatus.NOT_FOUND, message);
    }

    private static ResponseStatusException conflict(String message) {
        return new ResponseStatusException(HttpStatus.CONFLICT, message);
    }
}
