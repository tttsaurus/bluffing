package com.blufftable.game;

import com.blufftable.domain.Player;
import com.blufftable.domain.RoomMembership;
import com.blufftable.service.RewardService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;
import java.io.*;
import java.nio.charset.StandardCharsets;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class SpellingChallengeTest {
    private final UUID room = UUID.randomUUID();
    private final List<UUID> players = List.of(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID());
    private final AtomicLong now = new AtomicLong(1000);
    private LiarsDeck4FunEngine engine;
    private Map<String, String> vocabulary;

    @BeforeEach void setup() throws Exception {
        engine = new LiarsDeck4FunEngine(mock(RewardService.class), now::get);
        engine.start(room, players.stream().map(id -> {
            RoomMembership member = mock(RoomMembership.class);
            when(member.getPlayer()).thenReturn(new Player(id, "Player")); return member;
        }).toList(), new GameStartSettings(1, 3));
        vocabulary = new HashMap<>();
        try (var reader = new BufferedReader(new InputStreamReader(getClass().getResourceAsStream("/spelling/words.tsv"), StandardCharsets.UTF_8))) {
            reader.lines().forEach(line -> { var cols = line.split("\t"); vocabulary.put(cols[0], cols[1]); });
        }
    }
    private GameView view(UUID id) { return engine.view(room, id).orElseThrow(); }
    private void play(UUID id, List<Card> cards, String rank) {
        engine.command(id, new GameCommand(room, GameAction.PLAY, cards.stream().map(Card::id).toList(), rank));
    }
    private void action(UUID id, GameAction action) { engine.command(id, new GameCommand(room, action, List.of(), null)); }
    private void spell(UUID id, GameAction action, String answer) {
        engine.command(id, new GameCommand(room, action, List.of(), null, view(id).spelling().id(), answer));
    }
    private String answer(UUID id) {
        String url = view(id).spelling().audioUrl(); return vocabulary.get(url.substring(url.lastIndexOf('/') + 1));
    }
    private UUID trigger() {
        UUID opener = view(players.getFirst()).currentPlayerId();
        play(opener, view(opener).hand().stream().filter(c -> !c.isSpell()).limit(2).toList(), "A");
        UUID defender = view(opener).currentPlayerId();
        play(defender, view(defender).hand().stream().filter(Card::isSpell).toList(), null);
        action(view(opener).currentPlayerId(), GameAction.CHALLENGE);
        return defender;
    }
    @SuppressWarnings("unchecked") private List<Card> hand(UUID id) {
        Map<UUID, ?> games = (Map<UUID, ?>) ReflectionTestUtils.getField(engine, "games");
        Map<UUID, List<Card>> hands = (Map<UUID, List<Card>>) ReflectionTestUtils.getField(games.get(room), "hands");
        return hands.get(id);
    }

    @Test void eachPlayerGetsExactlyOneExtraSpecialCard() {
        for (UUID id : players) {
            assertThat(view(id).hand()).hasSize(4);
            assertThat(view(id).hand().stream().filter(Card::isSpell)).hasSize(1);
        }
        assertThat(vocabulary).hasSize(2000);
    }
    @Test void singleSpecialStartsImmediatelyWithTheSameWordForEveryone() {
        UUID defender = trigger();
        assertThat(view(defender).spelling().penalty()).isEqualTo(3);
        assertThat(view(defender).poolSize()).isZero();
        assertThat(view(defender).currentPlayerId()).isEqualTo(defender);
        assertThat(view(defender).hands()).extracting(GameView.HandCount::cardCount).containsExactlyInAnyOrder(2,3,7);
        assertThat(view(defender).spelling().stage()).isEqualTo("ACTIVE");
        assertThat(players.stream().map(id -> view(id).spelling().audioUrl()).distinct()).hasSize(1);
        assertThat(view(UUID.randomUUID()).spelling().audioUrl()).isNull();
        assertThatThrownBy(() -> action(defender, GameAction.FOLD)).isInstanceOf(GameRuleException.class);
        long deadline = view(defender).spelling().deadline();
        assertThat(deadline).isEqualTo(now.get() + 15000);
        now.addAndGet(1000);
        assertThat(view(defender).spelling().deadline()).isEqualTo(deadline);
    }
    @Test void correctWrongAndTimeoutResolveTogetherOnceWithFixedPoolPenalty() {
        trigger();
        UUID correct = players.get(0), wrong = players.get(1), late = players.get(2);
        Map<UUID,Integer> before = new HashMap<>(); players.forEach(id -> before.put(id,view(id).hand().size()));
        long specialBefore = view(wrong).hand().stream().filter(Card::isSpell).count();
        spell(correct,GameAction.SPELL_ANSWER,"  " + answer(correct).toUpperCase(Locale.ROOT) + "  ");
        spell(wrong,GameAction.SPELL_ANSWER,"wrong");
        assertThat(view(correct).spelling().results()).isEmpty();
        assertThatThrownBy(() -> spell(wrong,GameAction.SPELL_ANSWER,answer(wrong))).isInstanceOf(GameRuleException.class);
        now.addAndGet(15000);
        assertThat(engine.dueRooms()).containsExactly(room);
        assertThat(engine.tick(room)).isTrue();
        assertThat(engine.tick(room)).isFalse();
        assertThat(view(correct).hand()).hasSize(before.get(correct));
        assertThat(view(wrong).hand()).hasSize(before.get(wrong)+3);
        assertThat(view(late).hand()).hasSize(before.get(late)+3);
        assertThat(view(late).spelling().results()).hasSize(3);
        assertThat(view(late).spelling().stage()).isEqualTo("COMPLETE");
        assertThat(view(wrong).hand().stream().filter(Card::isSpell).count()).isEqualTo(specialBefore);
    }
    @Test void lateAnswerCannotBeatServerDeadlineAndStaleRoundsAreRejected() {
        trigger();  UUID player = players.getFirst();
        assertThatThrownBy(() -> engine.command(player,new GameCommand(room,GameAction.SPELL_ANSWER,List.of(),null,UUID.randomUUID(),answer(player))))
                .isInstanceOf(GameRuleException.class);
        assertThatThrownBy(() -> spell(UUID.randomUUID(),GameAction.SPELL_ANSWER,"x")).isInstanceOf(GameRuleException.class);
        now.addAndGet(15000); spell(player,GameAction.SPELL_ANSWER,answer(player));
        assertThat(view(player).spelling().results()).allMatch(r -> !r.correct());
        assertThatThrownBy(() -> spell(player,GameAction.SPELL_ANSWER,"x")).isInstanceOf(GameRuleException.class);
    }
    @Test void deadlineSubmitsLatestDraftWithoutLockingItEarly() {
        trigger();
        UUID player = players.getFirst();
        spell(player, GameAction.SPELL_DRAFT, "wrong");
        spell(player, GameAction.SPELL_DRAFT, answer(player));
        assertThat(view(player).spelling().submitted()).isFalse();
        assertThat(view(player).spelling().submittedCount()).isZero();
        assertThat(view(player).spelling().results()).isEmpty();
        now.addAndGet(15000);
        engine.tick(room);
        assertThat(view(player).spelling().results()).filteredOn(r -> r.playerId().equals(player))
                .allMatch(GameView.SpellingResult::correct);
    }
    @Test void clearedDraftIsEmptyAndManualSubmissionOverridesDraft() {
        trigger();
        UUID cleared = players.get(0), manual = players.get(1);
        spell(cleared, GameAction.SPELL_DRAFT, answer(cleared));
        spell(cleared, GameAction.SPELL_DRAFT, "");
        spell(manual, GameAction.SPELL_DRAFT, "wrong");
        spell(manual, GameAction.SPELL_ANSWER, answer(manual));
        assertThatThrownBy(() -> spell(manual, GameAction.SPELL_DRAFT, "changed"))
                .isInstanceOf(GameRuleException.class);
        now.addAndGet(15000);
        engine.tick(room);
        assertThat(view(cleared).spelling().results()).filteredOn(r -> r.playerId().equals(cleared))
                .allMatch(r -> !r.correct() && r.answer().isEmpty());
        assertThat(view(manual).spelling().results()).filteredOn(r -> r.playerId().equals(manual))
                .allMatch(GameView.SpellingResult::correct);
    }
    @Test void draftArrivingAtDeadlineCannotReplaceSavedAnswer() {
        trigger(); UUID player = players.getFirst();
        spell(player, GameAction.SPELL_DRAFT, "wrong");
        now.addAndGet(15000);
        spell(player, GameAction.SPELL_DRAFT, answer(player));
        assertThat(view(player).spelling().results()).filteredOn(r -> r.playerId().equals(player))
                .allMatch(r -> !r.correct() && r.answer().equals("wrong"));
    }
    @Test void mixedSpecialIsWildcardButDoesNotStartContest() {
        UUID first = view(players.getFirst()).currentPlayerId();
        Card normal = view(first).hand().getFirst(); Card special = view(first).hand().getLast();
        play(first,List.of(normal,special),normal.rank());
        action(view(first).currentPlayerId(),GameAction.CHALLENGE);
        assertThat(view(first).spelling()).isNull();
        assertThat(view(first).plays().getLast().status()).isEqualTo("TRUTH");
    }
    @Test void mixedSpecialDoesNotProtectALyingOrdinaryCard() {
        UUID first = view(players.getFirst()).currentPlayerId(); Card normal = view(first).hand().getFirst();
        play(first,List.of(normal,view(first).hand().getLast()),normal.rank().equals("A")?"K":"A");
        action(view(first).currentPlayerId(),GameAction.CHALLENGE);
        assertThat(view(first).spelling()).isNull();
        assertThat(view(first).plays().getLast().status()).isEqualTo("LIE");
        assertThat(view(first).hand()).hasSize(4);
    }
    @Test void unchallengedSingleSpecialHasNoContest() {
        UUID first=view(players.getFirst()).currentPlayerId();play(first,List.of(view(first).hand().getLast()),"A");
        UUID second=view(first).currentPlayerId();play(second,List.of(view(second).hand().getFirst()),null);
        assertThat(view(first).spelling()).isNull();
    }
    @Test void emptyHandDoesNotWinBeforeContestAndWrongAnswerRestoresCards() {
        UUID first=view(players.getFirst()).currentPlayerId();hand(first).removeIf(c -> !c.isSpell());
        play(first,List.copyOf(hand(first)),"A");action(view(first).currentPlayerId(),GameAction.CHALLENGE);
        assertThat(view(first).winnerId()).isNull();
        players.forEach(id -> spell(id,GameAction.SPELL_ANSWER,"wrong"));
        assertThat(view(first).winnerId()).isNull();assertThat(view(first).hand()).hasSize(1);
    }
    @Test void correctFinalSpecialWinsAfterEveryoneSettles() {
        UUID first=view(players.getFirst()).currentPlayerId();hand(first).removeIf(c -> !c.isSpell());
        play(first,List.copyOf(hand(first)),"A");action(view(first).currentPlayerId(),GameAction.CHALLENGE);
        for(UUID id:players)spell(id,GameAction.SPELL_ANSWER,answer(id));
        assertThat(view(first).winnerId()).isEqualTo(first);assertThat(view(first).phase()).isEqualTo("FINISHED");
        assertThat(view(first).spelling().results()).allMatch(GameView.SpellingResult::correct);
    }
    @Test void unansweredContestAutomaticallySettlesFifteenSecondsAfterTrigger() {
        trigger(); now.addAndGet(14999);
        assertThat(engine.tick(room)).isFalse();
        now.incrementAndGet();
        assertThat(engine.tick(room)).isTrue();
        assertThat(view(players.getFirst()).spelling().stage()).isEqualTo("COMPLETE");
        assertThat(view(players.getFirst()).spelling().results()).allMatch(r -> r.drawn() == 3);
    }
    @Test void departingParticipantDoesNotReceiveNewCards() {
        trigger();
        engine.depart(room,players.get(2));
        assertThat(view(players.getFirst()).spelling().stage()).isEqualTo("ACTIVE");
        now.addAndGet(15000);engine.tick(room);
        assertThat(view(players.getFirst()).spelling().results()).hasSize(2);
        assertThat(view(players.get(2)).hand()).isEmpty();
    }
    @Test void depletedReserveRefillsWithUniqueOrdinaryCards() {
        engine.start(room,players.stream().map(id -> {var m=mock(RoomMembership.class);when(m.getPlayer()).thenReturn(new Player(id,"P"));return m;}).toList(),new GameStartSettings(1,null));
        trigger();now.addAndGet(15000);engine.tick(room);
        var all=players.stream().flatMap(id->view(id).hand().stream()).toList();
        assertThat(all.stream().map(Card::id).distinct().count()).isEqualTo(all.size());
        assertThat(all.stream().filter(Card::isSpell)).hasSize(3);
    }
}
