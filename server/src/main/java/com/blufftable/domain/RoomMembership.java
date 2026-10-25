package com.blufftable.domain;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "room_memberships", uniqueConstraints = {
        @UniqueConstraint(columnNames = {"room_id", "player_id"})
})
public class RoomMembership {
    @Id private UUID id;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "room_id") private Room room;
    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "player_id") private Player player;
    @Column(name = "seat_index", nullable = false) private int seatIndex;
    @Column(nullable = false) private long balance;
    @Column(nullable = false) private boolean active;
    @Column(name = "joined_at", nullable = false) private Instant joinedAt;
    @Column(name = "equipped_skin", nullable = false, length = 32) private String equippedSkin = "CLASSIC";
    @Column(name = "equipped_avatar", nullable = false, length = 32) private String equippedAvatar = "DEFAULT";
    @ElementCollection
    @CollectionTable(name = "member_skins", joinColumns = @JoinColumn(name = "membership_id"))
    @Column(name = "skin_id", length = 32)
    private java.util.Set<String> unlockedSkins = new java.util.HashSet<>();
    @ElementCollection
    @CollectionTable(name = "member_avatars", joinColumns = @JoinColumn(name = "membership_id"))
    @Column(name = "avatar_id", length = 32)
    private java.util.Set<String> unlockedAvatars = new java.util.HashSet<>();
    public java.util.Set<String> getUnlockedAvatars() { return unlockedAvatars; }
    @Column(nullable = false) private long wins;
    @Column(name = "current_streak", nullable = false) private long currentStreak;
    @Column(name = "best_streak", nullable = false) private long bestStreak;
    @Column(name = "game_start_balance") private Long gameStartBalance;

    protected RoomMembership() {}

    public RoomMembership(Room room, Player player, int seatIndex) {
        this.id = UUID.randomUUID();
        this.room = room;
        this.player = player;
        this.seatIndex = seatIndex;
        this.balance = 0;
        this.active = true;
        this.joinedAt = Instant.now();
    }

    public UUID getId() { return id; }
    public Room getRoom() { return room; }
    public Player getPlayer() { return player; }
    public int getSeatIndex() { return seatIndex; }
    public long getBalance() { return balance; }
    public boolean isActive() { return active; }
    public String getEquippedAvatar() { return equippedAvatar; }
    public void equipAvatar(Avatar avatar) { equippedAvatar = avatar.name(); }
    public String getEquippedSkin() { return equippedSkin; }
    public java.util.Set<String> getUnlockedSkins() { return unlockedSkins; }
    public void equipSkin(String skin) { equippedSkin = skin; }
    public long getWins() { return wins; }
    public long getCurrentStreak() { return currentStreak; }
    public long getBestStreak() { return bestStreak; }
    public Long getGameStartBalance() { return gameStartBalance; }
    public void snapshotGameBalance() { gameStartBalance = balance; }
    public void restoreGameBalance() {
        if (gameStartBalance != null) balance = gameStartBalance;
        gameStartBalance = null;
    }
    public void commitGameBalance() { gameStartBalance = null; }
    public void recordResult(boolean won) {
        if (won) {
            wins = Math.addExact(wins, 1);
            currentStreak = Math.addExact(currentStreak, 1);
            bestStreak = Math.max(bestStreak, currentStreak);
        } else currentStreak = 0;
    }
    public void activate(int seatIndex) { this.seatIndex = seatIndex; this.active = true; }
    public void deactivate() { this.active = false; }
    public void credit(long amount) { balance = Math.addExact(balance, amount); }
    public void debit(long amount) {
        if (amount < 0 || amount > balance) throw new IllegalArgumentException("Not enough room coins");
        balance -= amount;
    }
}
