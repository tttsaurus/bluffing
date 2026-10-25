package com.blufftable.service;

import com.blufftable.api.ApiModels.*;
import com.blufftable.domain.*;
import com.blufftable.repository.*;
import com.blufftable.game.*;
import com.blufftable.websocket.PresenceRegistry;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.web.server.ResponseStatusException;
import static org.assertj.core.api.Assertions.*;

@SpringBootTest
class RoomLifecycleTest {
    @Autowired RoomService service;
    @Autowired PlayerRepository players;
    @Autowired RoomMembershipRepository memberships;
    @Autowired RoomRepository rooms;
    @Autowired PresenceRegistry presence;
    @Autowired RewardService rewards;
    @Autowired RoomRecovery recovery;
    @Autowired GameEngineRegistry engines;
    @Autowired ObjectMapper json;
    UUID room, host, guest;
    String hostSession, guestSession;

    @BeforeEach void setup() {
        host = players.save(new Player(UUID.randomUUID(), "Host")).getId();
        guest = players.save(new Player(UUID.randomUUID(), "Guest")).getId();
        hostSession = UUID.randomUUID().toString(); guestSession = UUID.randomUUID().toString();
        room = service.create(host, new CreateRoomRequest("Lifecycle test", GameType.LIARS_DECK)).id();
        service.join(room, guest);
        presence.authenticate(hostSession, host); presence.authenticate(guestSession, guest);
        service.enter(room, host, hostSession);
    }

    @Test void twoActivePlayersAreRequiredAndAnActiveDealCannotBeRestarted() {
        assertThatThrownBy(() -> service.start(room, host, new StartGameRequest(1, 5)))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("At least two players");
        service.enter(room, guest, guestSession);
        var started = service.start(room, host, new StartGameRequest(1, 5));
        assertThat(started.game().hands()).hasSize(2);
        assertThatThrownBy(() -> service.start(room, host, new StartGameRequest(1, 5)))
            .hasMessageContaining("already running");
    }

    @Test void timerIgnoresRoomsDeletedAfterTheSchedulerSnapshot() {
        assertThat(service.advanceTimedGame(UUID.randomUUID())).isFalse();
    }

    @Test void avatarPurchasesArePersonalPersistentAndBlockedDuringDeals() {
        rewards.credit(room, host, 1000);
        service.avatar(room, host, new AvatarRequest(Avatar.PORTRAIT), true);
        service.avatar(room, host, new AvatarRequest(Avatar.PORTRAIT), true);
        var owned = service.view(room, host);
        assertThat(owned.players()).filteredOn(member -> member.id().equals(host))
            .allMatch(member -> member.balance() == 500 && member.equippedAvatar().equals("PORTRAIT"));
        assertThat(service.view(room, guest).avatars()).filteredOn(avatar -> avatar.id().equals("PORTRAIT"))
            .allMatch(avatar -> !avatar.owned());
        assertThatThrownBy(() -> service.avatar(room, guest, new AvatarRequest(Avatar.PORTRAIT)))
            .hasMessageContaining("Unlock this avatar first");
        service.enter(room, guest, guestSession);
        service.start(room, host, new StartGameRequest(1, 3));
        rewards.credit(room, guest, 1000);
        assertThatThrownBy(() -> service.avatar(room, guest, new AvatarRequest(Avatar.PORTRAIT), true))
            .hasMessageContaining("between deals");
        service.avatar(room, host, new AvatarRequest(Avatar.BOXING_CAT));
        service.avatar(room, host, new AvatarRequest(Avatar.PORTRAIT));
        service.kick(room, host, guest);
        service.join(room, guest);
        assertThat(service.view(room, host).players()).filteredOn(member -> member.id().equals(host))
            .allMatch(member -> member.balance() == 500 && member.equippedAvatar().equals("PORTRAIT"));
    }

    @ParameterizedTest @EnumSource(GameType.class)
    void awayAndOfflineSeatsSitOutWithoutLosingBalancesOrWinStreaks(GameType type) {
        UUID table = type == GameType.LIARS_DECK ? room
            : service.create(host, new CreateRoomRequest("Online players only", type)).id();
        if (!table.equals(room)) service.join(table, guest);
        service.enter(table, host, hostSession);
        service.enter(table, guest, guestSession);
        UUID away = players.save(new Player(UUID.randomUUID(), "Away")).getId();
        UUID offline = players.save(new Player(UUID.randomUUID(), "Offline")).getId();
        service.join(table, away); service.join(table, offline);
        String awaySession = UUID.randomUUID().toString();
        presence.authenticate(awaySession, away); // Online, but not inside this room.
        rewards.credit(table, away, 321); rewards.credit(table, offline, 432);
        var awaySeat = memberships.findByRoomIdAndPlayerId(table, away).orElseThrow();
        awaySeat.recordResult(true); awaySeat.recordResult(true); memberships.save(awaySeat);

        var started = service.start(table, host, type == GameType.LIARS_DECK_PLUS
            ? new StartGameRequest(0, null, true) : new StartGameRequest(1, null));
        assertThat(started.players()).hasSize(4);
        assertThat(started.players()).filteredOn(player -> player.id().equals(away))
            .extracting(MemberView::presence).containsExactly("AWAY");
        assertThat(started.players()).filteredOn(player -> player.id().equals(offline))
            .extracting(MemberView::presence).containsExactly("OFFLINE");
        assertThat(started.game().participants()).containsExactlyInAnyOrder(host, guest);
        assertThat(started.game().hands()).extracting(GameView.HandCount::playerId).containsExactlyInAnyOrder(host, guest);
        assertThat(started.game().deckCount()).isBetween(1, 2);
        assertThat(started.game().cardsPerPlayer()).isEqualTo(started.game().deckCount() * (type == GameType.LIARS_DECK_PLUS ? 27 : 26));
        assertThat(memberships.findByRoomIdAndPlayerId(table, away).orElseThrow().getGameStartBalance()).isNull();
        assertThat(memberships.findByRoomIdAndPlayerId(table, offline).orElseThrow().getGameStartBalance()).isNull();
        assertThatThrownBy(() -> service.enter(table, away, awaySession)).hasMessageContaining("not in this deal");
        service.departed(table, away); // A sitting-out account disconnecting cannot alter the deal.
        assertThat(service.view(table, host).game().hands()).hasSize(2);

        UUID winner = started.game().currentPlayerId();
        var hand = service.view(table, winner).game().hand();
        service.command(winner, new GameCommand(table, GameAction.PLAY, hand.stream().map(Card::id).toList(), "A"));
        UUID responder = service.view(table, host).game().currentPlayerId();
        service.command(responder, new GameCommand(table, GameAction.FOLD, java.util.List.of(), null));
        var finished = service.view(table, host);
        assertThat(finished.game().winnerId()).isEqualTo(winner);
        var awayRecord = finished.records().stream().filter(record -> record.playerId().equals(away)).findFirst().orElseThrow();
        assertThat(awayRecord.wins()).isEqualTo(2);
        assertThat(awayRecord.currentStreak()).isEqualTo(2);
        assertThat(awayRecord.bestStreak()).isEqualTo(2);
        assertThat(memberships.findByRoomIdAndPlayerId(table, away).orElseThrow().getBalance()).isEqualTo(321);
        assertThat(memberships.findByRoomIdAndPlayerId(table, offline).orElseThrow().getBalance()).isEqualTo(432);

        // Custom hand capacity, too, is calculated against the two present players, not four seats.
        var next = service.start(table, host, new StartGameRequest(1, 20));
        int expectedHandSize = 20 + (type == GameType.LIARS_DECK_4_FUN ? 1 : 0);
        assertThat(next.game().hands()).allMatch(count -> count.cardCount() == expectedHandSize);
        long before = memberships.findByRoomIdAndPlayerId(table, host).orElseThrow().getBalance();
        rewards.credit(table, host, 100);
        service.stop(table, host, new StopGameRequest(next.game().gameId()));
        assertThat(memberships.findByRoomIdAndPlayerId(table, host).orElseThrow().getBalance()).isEqualTo(before);
        assertThat(memberships.findByRoomIdAndPlayerId(table, away).orElseThrow().getBalance()).isEqualTo(321);
        assertThat(memberships.findByRoomIdAndPlayerId(table, offline).orElseThrow().getBalance()).isEqualTo(432);
    }

    @Test void multipleTabsFromOnePlayerDoNotMeetTheTwoPlayerMinimum() {
        String otherTab = UUID.randomUUID().toString();
        presence.authenticate(otherTab, host);
        service.enter(room, host, otherTab);
        assertThatThrownBy(() -> service.start(room, host, new StartGameRequest(1, null)))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("At least two players");
    }

    @Test void plusRoomPersistsItsTypeAndRoutesRandomDecksToItsOwnEngine() {
        UUID plus = service.create(host, new CreateRoomRequest("Plus room", GameType.LIARS_DECK_PLUS)).id();
        service.join(plus, guest);
        service.enter(plus, host, hostSession);
        service.enter(plus, guest, guestSession);
        assertThat(rooms.findById(plus).orElseThrow().getGameType()).isEqualTo(GameType.LIARS_DECK_PLUS);
        var started = service.start(plus, host, new StartGameRequest(0, null, true));
        assertThat(started.gameType()).isEqualTo(GameType.LIARS_DECK_PLUS);
        assertThat(started.game().deckCount()).isBetween(1, 2);
        assertThat(started.game().hand()).hasSize(started.game().deckCount() * 27);
        assertThat(engines.require(GameType.LIARS_DECK).view(plus, host)).isEmpty();
        assertThatThrownBy(() -> service.start(plus, guest, new StartGameRequest(0, null, true)))
            .isInstanceOf(ResponseStatusException.class);
    }

    @Test void classicRoomRejectsRandomDecksWithoutChangingPersistentState() {
        service.enter(room, guest, guestSession);
        assertThatThrownBy(() -> service.start(room, host, new StartGameRequest(1, null, true)))
            .isInstanceOf(GameRuleException.class);
        assertThat(service.view(room, host).status()).isEqualTo(RoomStatus.LOBBY);
        assertThat(memberships.findByRoomIdAndPlayerId(room, host).orElseThrow().getGameStartBalance()).isNull();
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void truthCheckCardFacesArePrivateEvenFromHostAndRoot(boolean truthful) throws Exception {
        UUID third = players.save(new Player(UUID.randomUUID(), "Observer")).getId();
        String thirdSession = UUID.randomUUID().toString();
        service.join(room, third);
        presence.authenticate(thirdSession, third);
        service.enter(room, third, thirdSession);
        service.enter(room, guest, guestSession);
        Player root = new Player(UUID.randomUUID(), "Root spectator");
        root.grantRootAccess();
        players.save(root);
        var started = service.start(room, host, new StartGameRequest(1, 5)).game();
        UUID defender = started.currentPlayerId();
        Card checked = service.view(room, defender).game().hand().getFirst();
        String rank = truthful ? checked.rank() : checked.rank().equals("A") ? "K" : "A";
        service.command(defender, new GameCommand(room, GameAction.PLAY, java.util.List.of(checked.id()), rank));
        UUID challenger = service.view(room, host).game().currentPlayerId();
        service.command(challenger, new GameCommand(room, GameAction.CHALLENGE, java.util.List.of(), null));
        for (UUID viewer : java.util.List.of(host, guest, third, root.getId())) {
            var snapshot = service.view(room, viewer).game();
            var play = snapshot.plays().getLast();
            var outcome = snapshot.outcomes().getLast();
            assertThat(play.challengerId()).isEqualTo(challenger);
            assertThat(play.status()).isEqualTo(truthful ? "TRUTH" : "LIE");
            if (viewer.equals(challenger)) {
                assertThat(play.revealedCards()).containsExactly(checked);
                assertThat(outcome.revealedCards()).containsExactly(checked);
            } else {
                assertThat(play.revealedCards()).isEmpty();
                assertThat(outcome.revealedCards()).isEmpty();
            }
        }
        // Root's full serialized snapshot cannot contain the checked card's ID anywhere.
        assertThat(json.writeValueAsString(service.view(room, root.getId())))
            .doesNotContain(checked.id().toString());
    }

    @Test void lastSocketDepartureEndsGameButKeepsSeatAndBalance() {
        service.enter(room, guest, guestSession);
        String otherTab = UUID.randomUUID().toString();
        presence.authenticate(otherTab, guest); service.enter(room, guest, otherTab);
        rewards.credit(room, guest, 100);
        service.start(room, host, new StartGameRequest(1, 5));
        presence.leaveRoom(guestSession); service.departed(room, guest);
        assertThat(service.view(room, host).status()).isEqualTo(RoomStatus.IN_GAME);
        presence.disconnect(otherTab); service.departed(room, guest);
        var ended = service.view(room, host);
        assertThat(ended.status()).isEqualTo(RoomStatus.LOBBY);
        assertThat(ended.game().phase()).isEqualTo("FINISHED");
        assertThat(ended.game().hands()).hasSize(1);
        assertThat(memberships.findByRoomIdAndPlayerId(room, guest).orElseThrow().getBalance()).isEqualTo(100);
        assertThat(ended.players()).hasSize(2);
    }

    @Test void removedPlayerCannotEnterOngoingDealAndKickDoesNotCancelOtherPlayers() {
        UUID third = players.save(new Player(UUID.randomUUID(), "Third")).getId();
        String thirdSession = UUID.randomUUID().toString();
        service.join(room, third); presence.authenticate(thirdSession, third); service.enter(room, third, thirdSession);
        service.enter(room, guest, guestSession);
        service.start(room, host, new StartGameRequest(1, 5));
        presence.leaveRoom(guestSession); service.departed(room, guest);
        assertThat(service.view(room, host).game().hands()).hasSize(2);
        assertThatThrownBy(() -> service.enter(room, guest, guestSession)).hasMessageContaining("not in this deal");
        service.kick(room, host, third);
        assertThat(service.view(room, host).status()).isEqualTo(RoomStatus.LOBBY);
        assertThat(memberships.findByRoomIdAndPlayerId(room, third).orElseThrow().isActive()).isFalse();
    }

    @Test void cosmeticsBelongToBuyerAndChargeExactlyOnce() throws Exception {
        rewards.credit(room, host, 1_000);
        assertThatThrownBy(() -> service.skin(room, host, new SkinRequest(CardSkin.PRISM), true))
            .hasMessageContaining("Not enough room coins");
        assertThatThrownBy(() -> service.skin(room, host, new SkinRequest(CardSkin.AURORA), false))
            .hasMessageContaining("Unlock");
        var first = CompletableFuture.runAsync(() -> service.skin(room, host, new SkinRequest(CardSkin.AURORA), true));
        var second = CompletableFuture.runAsync(() -> service.skin(room, host, new SkinRequest(CardSkin.AURORA), true));
        CompletableFuture.allOf(first, second).get(10, TimeUnit.SECONDS);
        assertThat(memberships.findByRoomIdAndPlayerId(room, host).orElseThrow().getBalance()).isEqualTo(250);
        assertThat(service.view(room, guest).players()).anyMatch(p -> p.id().equals(host) && p.equippedSkin().equals("AURORA"));
        assertThat(service.view(room, guest).skins()).anyMatch(s -> s.id().equals("AURORA") && !s.owned());
        service.skin(room, guest, new SkinRequest(CardSkin.CLASSIC), false);
        assertThatThrownBy(() -> service.skin(room, guest, new SkinRequest(CardSkin.AURORA), false)).hasMessageContaining("Unlock");
        Player root = new Player(UUID.randomUUID(), "Root"); root.grantRootAccess(); players.save(root);
        service.kick(room, root.getId(), host);
        service.join(room, host);
        assertThat(service.view(room, host).skins()).anyMatch(s -> s.id().equals("AURORA") && s.owned());
        assertThat(service.view(room, guest).players()).anyMatch(p -> p.id().equals(host) && p.equippedSkin().equals("AURORA"));
    }

    @Test void newCosmeticsCannotBePurchasedDuringADealButOwnedDecksCanBeEquipped() {
        rewards.credit(room, host, 1_000);
        service.skin(room, host, new SkinRequest(CardSkin.AURORA), true);
        service.enter(room, guest, guestSession);
        var started = service.start(room, host, new StartGameRequest(1, 3));
        assertThatThrownBy(() -> service.skin(room, host, new SkinRequest(CardSkin.SUPERNOVA), true))
            .hasMessageContaining("between deals");
        assertThat(service.skin(room, host, new SkinRequest(CardSkin.CLASSIC), false).players())
            .anyMatch(member -> member.id().equals(host) && member.equippedSkin().equals("CLASSIC"));
        service.stop(room, host, new StopGameRequest(started.game().gameId()));
        assertThat(memberships.findByRoomIdAndPlayerId(room, host).orElseThrow().getBalance()).isEqualTo(250);
    }

    @Test void nonMembersCannotUseSnapshotOrPresenceToBypassJoining() {
        UUID stranger = players.save(new Player(UUID.randomUUID(), "Stranger")).getId();
        String session = UUID.randomUUID().toString(); presence.authenticate(session, stranger);
        assertThatThrownBy(() -> service.enter(room, stranger, session)).hasMessageContaining("Join this room");
        assertThat(presence.isInRoom(stranger, room)).isFalse();
        assertThatThrownBy(() -> service.view(room, stranger)).hasMessageContaining("Join this room");
    }

    @Test void rootSpectatesWithoutInflatingPlayerCountAndHostKickTransfersOwnership() {
        Player root = new Player(UUID.randomUUID(), "Root"); root.grantRootAccess(); players.save(root);
        String session = UUID.randomUUID().toString(); presence.authenticate(session, root.getId());
        service.enter(room, root.getId(), session);
        var summary = service.list(host).stream().filter(r -> r.id().equals(room)).findFirst().orElseThrow();
        assertThat(summary.activePlayerCount()).isEqualTo(1);
        service.kick(room, root.getId(), host);
        assertThat(service.view(room, guest).hostId()).isEqualTo(guest);
    }

    @Test void completedWinsAccumulateAndLossResetsOnlyCurrentStreak() {
        service.enter(room, guest, guestSession);
        win(host); win(host);
        var champion = record(host);
        assertThat(champion.wins()).isEqualTo(2);
        assertThat(champion.currentStreak()).isEqualTo(2);
        assertThat(champion.bestStreak()).isEqualTo(2);
        win(guest);
        assertThat(record(host).wins()).isEqualTo(2);
        assertThat(record(host).currentStreak()).isZero();
        assertThat(record(host).bestStreak()).isEqualTo(2);
        assertThat(record(guest).wins()).isEqualTo(1);
        // Repeated close/status handling must never settle a finished game twice.
        presence.leaveRoom(guestSession); service.departed(room, guest); service.departed(room, guest);
        assertThat(record(guest).wins()).isEqualTo(1);
        service.kick(room, host, guest);
        assertThat(record(guest).wins()).isEqualTo(1);
        service.join(room, guest);
        assertThat(record(guest).bestStreak()).isEqualTo(1);
    }

    @Test void hostCanAbortWithNoCheckoutOrRankChanges() {
        service.enter(room, guest, guestSession);
        win(host);
        long hostBefore = memberships.findByRoomIdAndPlayerId(room, host).orElseThrow().getBalance();
        long guestBefore = memberships.findByRoomIdAndPlayerId(room, guest).orElseThrow().getBalance();
        var started = service.start(room, host, new StartGameRequest(1, 3));
        rewards.credit(room, host, 90);
        rewards.credit(room, guest, 70);
        UUID current = started.game().currentPlayerId();
        var hand = service.view(room, current).game().hand();
        service.command(current, new GameCommand(room, GameAction.PLAY, java.util.List.of(hand.getFirst().id()), "A"));
        var stopped = service.stop(room, host, new StopGameRequest(started.game().gameId()));
        assertThat(stopped.game()).isNull();
        assertThat(stopped.status()).isEqualTo(RoomStatus.LOBBY);
        assertThat(stopped.notice()).contains("restored to its pre-deal balance");
        assertThat(record(host).wins()).isEqualTo(1);
        assertThat(record(host).currentStreak()).isEqualTo(1);
        assertThat(memberships.findByRoomIdAndPlayerId(room, host).orElseThrow().getBalance()).isEqualTo(hostBefore);
        assertThat(memberships.findByRoomIdAndPlayerId(room, guest).orElseThrow().getBalance()).isEqualTo(guestBefore);
        assertThat(memberships.findByRoomIdAndPlayerId(room, host).orElseThrow().getGameStartBalance()).isNull();
        assertThatThrownBy(() -> service.command(current, new GameCommand(room, GameAction.FOLD, java.util.List.of(), null)))
            .hasMessageContaining("No active game");
    }

    @Test void onlyHostOrRootCanAbortAndStaleStopCannotKillNewDeal() {
        service.enter(room, guest, guestSession);
        var first = service.start(room, host, new StartGameRequest(1, 3));
        assertThatThrownBy(() -> service.stop(room, guest, new StopGameRequest(first.game().gameId())))
            .hasMessageContaining("host or root");
        Player root = new Player(UUID.randomUUID(), "Root"); root.grantRootAccess(); players.save(root);
        service.stop(room, root.getId(), new StopGameRequest(first.game().gameId()));
        var second = service.start(room, host, new StartGameRequest(1, 3));
        assertThatThrownBy(() -> service.stop(room, host, new StopGameRequest(first.game().gameId())))
            .hasMessageContaining("deal changed");
        assertThat(service.view(room, host).game().gameId()).isEqualTo(second.game().gameId());
    }

    @Test void rootCanRecoverInGameRoomWithoutEngineState() {
        service.enter(room, guest, guestSession);
        service.start(room, host, new StartGameRequest(1, 3));
        rewards.credit(room, host, 80);
        rewards.credit(room, guest, 60);
        engines.require(GameType.LIARS_DECK).remove(room);
        Player root = new Player(UUID.randomUUID(), "Root"); root.grantRootAccess(); players.save(root);
        assertThat(service.stop(room, root.getId(), new StopGameRequest(null)).status()).isEqualTo(RoomStatus.LOBBY);
        assertThat(record(host).wins()).isZero();
        assertThat(memberships.findByRoomIdAndPlayerId(room, host).orElseThrow().getBalance()).isZero();
        assertThat(memberships.findByRoomIdAndPlayerId(room, guest).orElseThrow().getBalance()).isZero();
    }

    @Test void startupRecoveryRestoresPersistedWalletCheckpoints() {
        service.enter(room, guest, guestSession);
        service.start(room, host, new StartGameRequest(1, 3));
        rewards.credit(room, host, 110);
        rewards.credit(room, guest, 45);
        engines.require(GameType.LIARS_DECK).remove(room);
        recovery.releaseRoomsFromInterruptedGames();
        assertThat(rooms.findById(room).orElseThrow().getStatus()).isEqualTo(RoomStatus.LOBBY);
        assertThat(memberships.findByRoomIdAndPlayerId(room, host).orElseThrow().getBalance()).isZero();
        assertThat(memberships.findByRoomIdAndPlayerId(room, guest).orElseThrow().getBalance()).isZero();
        assertThat(rooms.findById(room).orElseThrow().getLastNotice()).contains("restored to its pre-deal balance");
    }

    @Test void departedHostCanInspectAndStopWithoutRejoiningTheDeal() {
        UUID third = players.save(new Player(UUID.randomUUID(), "Third")).getId();
        String session = UUID.randomUUID().toString();
        service.join(room, third); presence.authenticate(session, third); service.enter(room, third, session);
        service.enter(room, guest, guestSession);
        var started = service.start(room, host, new StartGameRequest(1, 3));
        presence.leaveRoom(hostSession); service.departed(room, host);
        service.enter(room, host, hostSession);
        var spectator = service.view(room, host);
        assertThat(spectator.game().hand()).isEmpty();
        assertThat(spectator.game().hands()).hasSize(2);
        assertThat(service.stop(room, host, new StopGameRequest(started.game().gameId())).game()).isNull();
    }

    @Test void autoTerminationDoesNotAwardWinsOrBreakExistingStreak() {
        service.enter(room, guest, guestSession); win(host);
        long hostBefore = memberships.findByRoomIdAndPlayerId(room, host).orElseThrow().getBalance();
        long guestBefore = memberships.findByRoomIdAndPlayerId(room, guest).orElseThrow().getBalance();
        service.start(room, host, new StartGameRequest(1, 3));
        rewards.credit(room, host, 120);
        rewards.credit(room, guest, 40);
        presence.leaveRoom(guestSession); service.departed(room, guest);
        assertThat(record(host).wins()).isEqualTo(1);
        assertThat(record(host).currentStreak()).isEqualTo(1);
        assertThat(memberships.findByRoomIdAndPlayerId(room, host).orElseThrow().getBalance()).isEqualTo(hostBefore);
        assertThat(memberships.findByRoomIdAndPlayerId(room, guest).orElseThrow().getBalance()).isEqualTo(guestBefore);
        assertThat(service.view(room, host).notice()).contains("restored to its pre-deal balance");
    }

    @Test void departedParticipantLosesStreakWhenRemainingPlayerWins() {
        service.enter(room, guest, guestSession); win(guest);
        UUID third = players.save(new Player(UUID.randomUUID(), "Third")).getId();
        String session = UUID.randomUUID().toString();
        service.join(room, third); presence.authenticate(session, third); service.enter(room, third, session);
        service.start(room, host, new StartGameRequest(1, 3));
        presence.leaveRoom(guestSession); service.departed(room, guest);
        UUID winner = service.view(room, host).game().currentPlayerId();
        var hand = service.view(room, winner).game().hand();
        service.command(winner, new GameCommand(room, GameAction.PLAY, hand.stream().map(Card::id).toList(), "A"));
        UUID responder = service.view(room, host).game().currentPlayerId();
        service.command(responder, new GameCommand(room, GameAction.FOLD, java.util.List.of(), null));
        assertThat(record(guest).wins()).isEqualTo(1);
        assertThat(record(guest).currentStreak()).isZero();
        assertThat(record(guest).bestStreak()).isEqualTo(1);
    }

    private PlayerRecord record(UUID id) {
        return service.view(room, host).records().stream().filter(r -> r.playerId().equals(id)).findFirst().orElseThrow();
    }

    private void win(UUID winner) {
        var game = service.start(room, host, new StartGameRequest(1, 3)).game();
        if (!game.currentPlayerId().equals(winner)) {
            UUID other = game.currentPlayerId();
            Card card = service.view(room, other).game().hand().getFirst();
            service.command(other, new GameCommand(room, GameAction.PLAY, java.util.List.of(card.id()), "A"));
        }
        var hand = service.view(room, winner).game().hand();
        service.command(winner, new GameCommand(room, GameAction.PLAY, hand.stream().map(Card::id).toList(), "A"));
        UUID responder = service.view(room, host).game().currentPlayerId();
        service.command(responder, new GameCommand(room, GameAction.FOLD, java.util.List.of(), null));
    }
}
