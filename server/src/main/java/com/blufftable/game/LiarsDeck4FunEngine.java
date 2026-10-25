package com.blufftable.game;

import com.blufftable.domain.GameType;
import com.blufftable.service.RewardService;
import java.util.List;
import java.util.function.LongSupplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/** Liar's Deck with its own room state and the spelling-trap card rule. */
@Component
public class LiarsDeck4FunEngine extends AbstractLiarsDeckEngine {
    @Autowired
    public LiarsDeck4FunEngine(RewardService rewards) { super(rewards); }
    LiarsDeck4FunEngine(RewardService rewards, LongSupplier clock) { super(rewards, clock); }

    @Override public GameType type() { return GameType.LIARS_DECK_4_FUN; }
    @Override protected boolean spellingTrapsEnabled() { return true; }
    @Override protected boolean isTruthful(List<Card> cards, String rank) {
        return cards.stream().allMatch(card -> card.isSpell() || card.rank().equals(rank));
    }
}
