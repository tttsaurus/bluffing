package com.blufftable.game;

import java.util.UUID;

public record Card(UUID id, String rank, String suit) {
    public static final String JOKER = "JOKER";
    public static final String SPELL = "SPELL";
    public boolean isSpell() { return SPELL.equals(rank); }
    public static final String[] RANKS = {"A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"};
    public static final String[] SUITS = {"SPADES", "HEARTS", "DIAMONDS", "CLUBS"};
}

