package com.blufftable.repository;

import com.blufftable.domain.Player;
import java.util.UUID;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import jakarta.persistence.LockModeType;

public interface PlayerRepository extends JpaRepository<Player, UUID> {
    Optional<Player> findByDeviceTokenHash(String deviceTokenHash);
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select p from Player p where p.id = :id")
    Optional<Player> lockById(UUID id);
}
