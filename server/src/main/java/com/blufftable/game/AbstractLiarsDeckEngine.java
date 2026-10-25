package com.blufftable.game;

import com.blufftable.domain.RoomMembership;
import com.blufftable.service.RewardService;
import java.security.SecureRandom;
import java.util.*;
import java.util.function.LongSupplier;
import java.util.concurrent.ConcurrentHashMap;

/** Shared session lifecycle; each concrete game type owns its own room-state map. */
public abstract class AbstractLiarsDeckEngine implements GameEngine {
    private static final long RISK_UNIT = 10L;
    private final Map<UUID, State> games = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();
    private final RewardService rewards;
    private final SpellingWords spellingWords = new SpellingWords();
    private final LongSupplier clock;

    protected AbstractLiarsDeckEngine(RewardService rewards) {
        this(rewards, System::currentTimeMillis);
    }

    protected AbstractLiarsDeckEngine(RewardService rewards, LongSupplier clock) {
        this.rewards = rewards;
        this.clock = clock;
    }

    protected int cardsPerDeck() { return 52; }
    protected boolean allowsRandomDecks() { return false; }
    protected boolean spellingTrapsEnabled() { return false; }
    protected long now() { return clock.getAsLong(); }
    protected boolean isTruthful(List<Card> cards, String rank) {
        return cards.stream().allMatch(card -> card.rank().equals(rank));
    }
    protected void shuffleDeck(List<Card> deck) { Collections.shuffle(deck, random); }
    protected int randomDeckCount(int players) { return 1 + random.nextInt(players); }

    @Override
    public void start(UUID roomId, List<RoomMembership> members, GameStartSettings settings) {
        if (members.size() < 2 || members.size() > 8) throw new GameRuleException("Between two and eight players are required");
        if (settings.randomDeckCount() && !allowsRandomDecks()) {
            throw new GameRuleException("Random deck counts are only available in Liar's Deck Plus");
        }
        if (!settings.randomDeckCount() && (settings.deckCount() < 1 || settings.deckCount() > 8)) {
            throw new GameRuleException("Deck count must be between 1 and 8");
        }
        // Custom hands must fit every possible random draw, not fail intermittently.
        if (settings.randomDeckCount() && settings.cardsPerPlayer() != null
                && (long) settings.cardsPerPlayer() * members.size() > cardsPerDeck()) {
            throw new GameRuleException("With random decks, custom hands must fit in one deck");
        }
        int deckCount = settings.randomDeckCount() ? randomDeckCount(members.size()) : settings.deckCount();
        int available = deckCount * cardsPerDeck();
        int handSize = settings.cardsPerPlayer() == null ? available / members.size() : settings.cardsPerPlayer();
        if (handSize < 1 || (long) handSize * members.size() > available) {
            throw new GameRuleException("That hand size needs more cards than the selected decks provide");
        }

        List<Card> deck = buildDeck(deckCount);
        shuffleDeck(deck);
        List<UUID> order = new ArrayList<>(members.stream().map(m -> m.getPlayer().getId()).toList());
        Collections.shuffle(order, random);
        Map<UUID, List<Card>> hands = new LinkedHashMap<>();
        order.forEach(id -> hands.put(id, new ArrayList<>()));
        int cursor = 0;
        for (int round = 0; round < handSize; round++) {
            for (UUID playerId : order) hands.get(playerId).add(deck.get(cursor++));
        }
        if (spellingTrapsEnabled()) {
            hands.values().forEach(hand -> hand.add(new Card(UUID.randomUUID(), Card.SPELL, "SPADES")));
        }
        hands.values().forEach(hand -> hand.sort(Comparator.comparingInt(c -> rankIndex(c.rank()))));

        int first = random.nextInt(order.size());
        State state = new State(UUID.randomUUID(), roomId, deckCount, handSize, order, hands, first);
        state.reserve.addAll(deck.subList(cursor, deck.size()));
        state.event("New game · " + deckCount + (deckCount == 1 ? " deck" : " decks")
                + " · " + handSize + " cards each");
        games.put(roomId, state);
    }

    @Override
    public void command(UUID playerId, GameCommand command) {
        State state = games.get(command.roomId());
        if (state == null) throw new GameRuleException("No active game in this room");
        synchronized (state) {
            if (command.action() == GameAction.SPELL_ANSWER || command.action() == GameAction.SPELL_DRAFT) {
                spellingCommand(state, playerId, command);
                return;
            }
            if (spellingRunning(state)) throw new GameRuleException("Finish the spelling challenge first");
            requireActiveTurn(state, playerId);
            switch (command.action()) {
                case PLAY -> play(state, playerId, command.cardIds(), command.declaredRank());
                case FOLD -> fold(state, playerId);
                case CHALLENGE -> challenge(state, playerId);
            }
        }
    }

    private void play(State state, UUID playerId, List<UUID> cardIds, String declaredRank) {
        if (cardIds.isEmpty()) throw new GameRuleException("Select at least one card");
        if (new HashSet<>(cardIds).size() != cardIds.size()) throw new GameRuleException("A card can only be played once");
        List<Card> hand = state.hands.get(playerId);
        List<Card> played = cardIds.stream().map(id -> hand.stream()
                        .filter(card -> card.id().equals(id)).findFirst()
                        .orElseThrow(() -> new GameRuleException("One of those cards is not in your hand")))
                .toList();

        if (state.targetRank == null) {
            String normalized = normalizeRank(declaredRank);
            state.targetRank = normalized;
            state.initializerIndex = state.currentIndex;
        } else if (declaredRank != null && !declaredRank.isBlank()
                && !state.targetRank.equalsIgnoreCase(declaredRank.trim())) {
            throw new GameRuleException("This pool is already declared as " + state.targetRank + "s");
        }

        // Only the latest play can be checked. Replacing it secures that play now,
        // even if the replacement is later caught. A fold alone does not secure it.
        UUID previousPlayer = state.pendingClaim == null ? null : state.pendingClaim.playerId;
        securePending(state, "PLAY_PASSED");
        if (previousPlayer != null && finishIfEmpty(state, previousPlayer)) return;
        hand.removeAll(played);
        int generation = state.claims.size() + 1;
        long risk = Math.multiplyExact(RISK_UNIT, Math.multiplyExact((long) generation, played.size()));
        state.pendingClaim = new Claim(playerId, played, generation, risk);
        state.claims.add(state.pendingClaim);
        state.plays.add(new GameView.PlayView(++state.playSequence, playerId, state.targetRank, played.size(), "PENDING", null, List.of()));
        state.lastNonFoldedPlayerId = playerId;
        if (state.plays.size() > 50) state.plays.removeFirst();
        state.pool.addAll(played);
        state.consecutiveFolds = 0;
        state.event("A player claimed " + played.size() + " × " + state.targetRank + " · risk " + risk);

        state.currentIndex = next(state, state.currentIndex);
    }

    private void fold(State state, UUID playerId) {
        if (state.pool.isEmpty()) throw new GameRuleException("The pool initializer must play at least one card");
        state.consecutiveFolds++;
        state.event("A player folded");
        if (state.pendingClaim != null && state.hands.get(state.pendingClaim.playerId).isEmpty()
                && state.consecutiveFolds >= state.order.size() - 1) {
            UUID candidate = state.pendingClaim.playerId;
            securePending(state, "POOL_PASSED");
            finishIfEmpty(state, candidate);
            clearPool(state);
            state.plays.clear();
            return;
        }
        if (state.consecutiveFolds >= state.order.size()) {
            securePending(state, "POOL_PASSED");
            state.event("Everyone folded · pool vanished · final pending play paid");
            clearPool(state);
            state.plays.clear();
            state.initializerIndex = state.currentIndex;
        } else {
            state.currentIndex = next(state, state.currentIndex);
        }
    }

    private void challenge(State state, UUID challengerId) {
        if (state.claims.isEmpty()) throw new GameRuleException("There is no claim to challenge");
        Claim challenged = state.claims.getLast();
        if (challenged.playerId.equals(challengerId)) throw new GameRuleException("You cannot challenge your own claim");
        boolean truthful = isTruthful(challenged.cards, state.targetRank);
        boolean spellingTrap = spellingTrapsEnabled() && challenged.cards.size() == 1 && challenged.cards.getFirst().isSpell();
        int spellingPenalty = state.pool.size();
        UUID recipient;
        UUID nextInitializer;
        if (truthful) {
            recipient = challengerId;
            nextInitializer = challenged.playerId;
            pay(state, challenged.playerId, challenged.risk * 2);
            state.event("Truth! Challenger takes " + state.pool.size() + " cards · defender earned "
                    + (challenged.risk * 2));
        } else {
            recipient = challenged.playerId;
            nextInitializer = challengerId;
            pay(state, challengerId, challenged.risk * 2);
            state.event("Lie caught! Bluffer takes " + state.pool.size() + " cards · challenger earned "
                    + (challenged.risk * 2));
        }
        state.outcome(truthful ? "CHECK_FAILED" : "CHECK_SUCCEEDED", challenged.playerId,
                challengerId, truthful ? challenged.playerId : challengerId, challenged.risk * 2, challenged.cards);
        resolvePlay(state, truthful ? "TRUTH" : "LIE", challengerId, challenged.cards);
        state.hands.get(recipient).addAll(state.pool);
        state.hands.get(recipient).sort(Comparator.comparingInt(c -> rankIndex(c.rank())));
        clearPool(state);
        state.currentIndex = state.order.indexOf(nextInitializer);
        state.initializerIndex = state.currentIndex;
        if (spellingTrap) startSpelling(state, challenged.playerId, spellingPenalty);
        else if (truthful) finishIfEmpty(state, challenged.playerId);
        else state.lastNonFoldedPlayerId = challengerId;
    }

    private boolean spellingRunning(State state) {
        return state.spelling != null && "ACTIVE".equals(state.spelling.stage);
    }

    private void startSpelling(State state, UUID defender, int penalty) {
        SpellingRound round = new SpellingRound(UUID.randomUUID(), defender, penalty, now() + 15_000);
        SpellingWords.Word word = spellingWords.pick(1, random, state.usedWords).getFirst();
        state.order.forEach(id -> round.questions.put(id, word));
        state.spelling = round;
        state.event("SPELL trap · everyone spells a word · wrong or timeout draws " + penalty);
    }

    private void spellingCommand(State state, UUID playerId, GameCommand command) {
        SpellingRound round = state.spelling;
        if (!spellingTrapsEnabled() || !"ACTIVE".equals(state.phase) || !spellingRunning(state)
                || !round.id.equals(command.spellingId()) || !round.questions.containsKey(playerId)) {
            throw new GameRuleException("This spelling challenge is no longer available");
        }
        if (now() >= round.deadline) { advanceSpelling(state); return; }
        if (round.answers.containsKey(playerId)) throw new GameRuleException("Only one answer per challenge");
        if (command.answer() == null || command.answer().length() > 64) {
            throw new GameRuleException("Enter a word of at most 64 characters");
        }
        String answer = command.answer().trim().toLowerCase(Locale.ROOT);
        if (command.action() == GameAction.SPELL_DRAFT) {
            round.drafts.put(playerId, answer);
            return;
        }
        round.answers.put(playerId, answer);
        advanceSpelling(state);
    }

    private void advanceSpelling(State state) {
        if (!spellingRunning(state)) return;
        SpellingRound round = state.spelling;
        if (now() < round.deadline && !round.answers.keySet().containsAll(round.questions.keySet())) return;
        for (var entry : round.questions.entrySet()) {
            String answer = round.answers.getOrDefault(entry.getKey(), round.drafts.getOrDefault(entry.getKey(), ""));
            boolean correct = entry.getValue().accepts(answer);
            if (!correct) {
                for (int i = 0; i < round.penalty; i++) {
                    if (state.reserve.isEmpty()) {
                        List<Card> refill = buildDeck(state.deckCount);
                        shuffleDeck(refill);
                        state.reserve.addAll(refill);
                    }
                    state.hands.get(entry.getKey()).add(state.reserve.removeFirst());
                }
                state.hands.get(entry.getKey()).sort(Comparator.comparingInt(card -> rankIndex(card.rank())));
            }
            round.results.add(new GameView.SpellingResult(entry.getKey(), entry.getValue().text(), answer,
                    correct, correct ? 0 : round.penalty));
        }
        round.stage = "COMPLETE";
        state.event("Spelling complete · challenge resolved");
        if (state.hands.containsKey(round.defender)) finishIfEmpty(state, round.defender);
    }

    private GameView.SpellingView spellingView(State state, UUID viewerId) {
        SpellingRound round = state.spelling;
        if (round == null) return null;
        SpellingWords.Word word = round.questions.get(viewerId);
        return new GameView.SpellingView(round.id, round.stage, now(), round.deadline, round.penalty,
                word == null ? null : "/api/spelling/audio/" + word.id(), round.answers.containsKey(viewerId),
                List.copyOf(round.results), round.answers.size(), round.questions.size());
    }

    @Override public List<UUID> dueRooms() {
        return games.entrySet().stream().filter(entry -> {
            synchronized (entry.getValue()) {
                return spellingRunning(entry.getValue()) && now() >= entry.getValue().spelling.deadline;
            }
        }).map(Map.Entry::getKey).toList();
    }

    @Override public boolean tick(UUID roomId) {
        State state = games.get(roomId);
        if (state == null) return false;
        synchronized (state) {
            if (!spellingRunning(state) || now() < state.spelling.deadline) return false;
            advanceSpelling(state);
            return true;
        }
    }

    private boolean finishIfEmpty(State state, UUID playerId) {
        if (!state.hands.get(playerId).isEmpty()) return false;
        state.winnerId = playerId;
        state.phase = "FINISHED";
        long bonus = 100L + state.deckCount * 25L;
        pay(state, playerId, bonus);
        state.outcome("GAME_WON", playerId, null, playerId, bonus, List.of());
        state.event("Final play accepted · winner bonus " + bonus);
        return true;
    }

    private void resolvePlay(State state, String status, UUID challengerId, List<Card> revealed) {
        if (state.plays.isEmpty()) return;
        var play = state.plays.getLast();
        state.plays.set(state.plays.size() - 1, new GameView.PlayView(play.id(), play.playerId(),
                play.declaredRank(), play.cardCount(), status, challengerId, List.copyOf(revealed)));
    }

    private void clearPool(State state) {
        state.pool.clear();
        state.claims.clear();
        state.targetRank = null;
        state.consecutiveFolds = 0;
        state.pendingClaim = null;
    }

    private void pay(State state, UUID playerId, long amount) {
        rewards.credit(state.roomId, playerId, amount);
        state.earnings.merge(playerId, amount, Long::sum);
    }

    private void securePending(State state, String reason) {
        Claim pending = state.pendingClaim;
        if (pending == null) return;
        resolvePlay(state, "PASSED", null, List.of());
        pay(state, pending.playerId, pending.risk);
        state.outcome(reason, pending.playerId, null, pending.playerId, pending.risk, List.of());
        state.event("Play passed · " + pending.risk + " coins secured");
        state.pendingClaim = null;
    }

    @Override
    public Optional<GameView> view(UUID roomId, UUID viewerId) {
        State state = games.get(roomId);
        if (state == null) return Optional.empty();
        synchronized (state) {
            Claim claim = state.claims.isEmpty() ? null : state.claims.getLast();
            GameView.ClaimView claimView = claim == null ? null
                    : new GameView.ClaimView(claim.playerId, claim.cards.size(), claim.generation, claim.risk);
            List<GameView.HandCount> counts = state.order.stream()
                    .map(id -> new GameView.HandCount(id, state.hands.get(id).size())).toList();
            return Optional.of(new GameView(state.gameId, state.phase, state.deckCount, state.cardsPerPlayer,
                    state.order.isEmpty() ? null : state.order.get(state.currentIndex),
                    state.order.isEmpty() ? null : state.order.get(state.initializerIndex), state.targetRank,
                    state.pool.size(), state.claims.size() + 1, state.consecutiveFolds, claimView,
                    List.copyOf(state.hands.getOrDefault(viewerId, List.of())), counts,
                    List.copyOf(state.events), state.winnerId, state.participants,
                    state.pendingClaim == null ? null : new GameView.ClaimView(state.pendingClaim.playerId,
                            state.pendingClaim.cards.size(), state.pendingClaim.generation, state.pendingClaim.risk),
                    state.participants.stream().map(id -> new GameView.Earnings(id, state.earnings.getOrDefault(id, 0L))).toList(),
                    state.outcomes.stream().map(outcome -> outcome.forViewer(viewerId)).toList(),
                    state.plays.stream().map(play -> play.forViewer(viewerId)).toList(),
                    spellingView(state, viewerId), state.lastNonFoldedPlayerId));
        }
    }

    @Override public void remove(UUID roomId) { games.remove(roomId); }

    @Override
    public void depart(UUID roomId, UUID playerId) {
        State state = games.get(roomId);
        if (state == null) return;
        synchronized (state) {
            if (!"ACTIVE".equals(state.phase) || !state.order.contains(playerId)) return;
            UUID nextPlayer = state.order.get(state.currentIndex);
            if (nextPlayer.equals(playerId)) nextPlayer = state.order.get(next(state, state.currentIndex));
            state.order.remove(playerId);
            state.hands.remove(playerId);
            if (spellingRunning(state)) {
                state.spelling.questions.remove(playerId);
                state.spelling.answers.remove(playerId);
                state.spelling.drafts.remove(playerId);
                if (state.order.size() <= 1) state.spelling.stage = "CANCELLED";
                else advanceSpelling(state);
            }
            // A departed player cannot receive or defend an unresolved claim. Discard, never pay it.
            if (state.pendingClaim != null) {
                resolvePlay(state, "VOIDED", null, List.of());
                // Restore an unverified final hand so a remaining player can continue.
                var pendingHand = state.hands.get(state.pendingClaim.playerId);
                if (pendingHand != null && pendingHand.isEmpty()) pendingHand.addAll(state.pendingClaim.cards);
                state.outcome("PLAY_VOIDED", state.pendingClaim.playerId, null, null, 0, List.of());
            }
            clearPool(state);
            state.currentIndex = Math.max(0, state.order.indexOf(nextPlayer));
            state.initializerIndex = state.currentIndex;
            state.event("Player left the deal · unresolved pool discarded without payout");
            if (state.order.size() <= 1) {
                state.phase = "FINISHED";
                state.event("Deal ended · fewer than two players remain · no winner bonus");
            }
        }
    }

    private void requireActiveTurn(State state, UUID playerId) {
        if (!"ACTIVE".equals(state.phase)) throw new GameRuleException("This game has finished");
        if (!state.order.get(state.currentIndex).equals(playerId)) throw new GameRuleException("It is not your turn");
    }

    private static int next(State state, int index) { return (index + 1) % state.order.size(); }

    private static String normalizeRank(String rank) {
        if (rank == null) throw new GameRuleException("Choose a rank for the new pool");
        String normalized = rank.trim().toUpperCase(Locale.ROOT);
        if (Arrays.stream(Card.RANKS).noneMatch(normalized::equals)) {
            throw new GameRuleException("Unknown card rank");
        }
        return normalized;
    }

    private static int rankIndex(String rank) {
        for (int i = 0; i < Card.RANKS.length; i++) if (Card.RANKS[i].equals(rank)) return i;
        return Integer.MAX_VALUE;
    }

    protected List<Card> buildDeck(int deckCount) {
        List<Card> deck = new ArrayList<>(deckCount * 52);
        for (int d = 0; d < deckCount; d++) {
            for (String suit : Card.SUITS) for (String rank : Card.RANKS) {
                deck.add(new Card(UUID.randomUUID(), rank, suit));
            }
        }
        return deck;
    }

    private record Claim(UUID playerId, List<Card> cards, int generation, long risk) {}

    private static final class SpellingRound {
        final UUID id;
        final UUID defender;
        final int penalty;
        final Map<UUID, SpellingWords.Word> questions = new LinkedHashMap<>();
        final Map<UUID, String> answers = new HashMap<>();
        final Map<UUID, String> drafts = new HashMap<>();
        final List<GameView.SpellingResult> results = new ArrayList<>();
        final long deadline;
        String stage = "ACTIVE";
        SpellingRound(UUID id, UUID defender, int penalty, long deadline) {
            this.id = id; this.defender = defender; this.penalty = penalty; this.deadline = deadline;
        }
    }

    private static final class State {
        final UUID gameId;
        final UUID roomId;
        final int deckCount;
        final int cardsPerPlayer;
        final List<UUID> order;
        final List<UUID> participants;
        final Map<UUID, List<Card>> hands;
        final List<Card> pool = new ArrayList<>();
        final Deque<Card> reserve = new ArrayDeque<>();
        final Set<String> usedWords = new HashSet<>();
        final List<Claim> claims = new ArrayList<>();
        final Deque<String> events = new ArrayDeque<>();
        final Map<UUID, Long> earnings = new HashMap<>();
        final Deque<GameView.Outcome> outcomes = new ArrayDeque<>();
        final List<GameView.PlayView> plays = new ArrayList<>();
        long playSequence;
        long outcomeSequence;
        Claim pendingClaim;
        int currentIndex;
        int initializerIndex;
        int consecutiveFolds;
        String targetRank;
        String phase = "ACTIVE";
        UUID winnerId;
        UUID lastNonFoldedPlayerId;
        SpellingRound spelling;

        State(UUID gameId, UUID roomId, int deckCount, int cardsPerPlayer, List<UUID> order,
              Map<UUID, List<Card>> hands, int first) {
            this.gameId = gameId;
            this.roomId = roomId;
            this.deckCount = deckCount;
            this.cardsPerPlayer = cardsPerPlayer;
            this.order = order;
            this.participants = List.copyOf(order);
            this.hands = hands;
            this.currentIndex = first;
            this.initializerIndex = first;
        }

        void event(String value) {
            events.addFirst(value);
            while (events.size() > 8) events.removeLast();
        }

        void outcome(String type, UUID playerId, UUID challengerId, UUID rewardPlayerId, long amount, List<Card> cards) {
            outcomes.addLast(new GameView.Outcome(++outcomeSequence, type, playerId, challengerId,
                    rewardPlayerId, amount, pool.size(), targetRank, List.copyOf(cards)));
            while (outcomes.size() > 32) outcomes.removeFirst();
        }
    }
}
