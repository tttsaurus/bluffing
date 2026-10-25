package com.blufftable.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "players")
public class Player {
    @Id private UUID id;
    @Column(name = "display_name", nullable = false, length = 24) private String displayName;
    @Column(name = "device_token_hash", unique = true, length = 64) private String deviceTokenHash;
    @Column(name = "root_account", nullable = false) private boolean rootAccount;
    @Column(name = "debug_owner_id", unique = true) private UUID debugOwnerId;
    @Column(name = "created_at", nullable = false) private Instant createdAt;

    protected Player() {}

    public Player(UUID id, String displayName) {
        this(id, displayName, null);
    }

    public Player(UUID id, String displayName, String deviceTokenHash) {
        this.id = id;
        this.displayName = displayName;
        this.deviceTokenHash = deviceTokenHash;
        this.rootAccount = false;
        this.createdAt = Instant.now();
    }

    public UUID getId() { return id; }
    public String getDisplayName() { return displayName; }
    public void setDisplayName(String displayName) { this.displayName = displayName; }
    public String getDeviceTokenHash() { return deviceTokenHash; }
    public boolean isRootAccount() { return rootAccount; }
    public UUID getDebugOwnerId() { return debugOwnerId; }
    public void setDebugOwnerId(UUID ownerId) { debugOwnerId = ownerId; }
    public void grantRootAccess() { rootAccount = true; }
    public String identityTag() { return id.toString().replace("-", "").substring(0, 5); }
    public void bindDeviceTokenHash(String deviceTokenHash) {
        if (this.deviceTokenHash != null && !this.deviceTokenHash.equals(deviceTokenHash)) {
            throw new IllegalStateException("Player identity is already bound to another device token");
        }
        this.deviceTokenHash = deviceTokenHash;
    }
}
