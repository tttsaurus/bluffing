package com.blufftable.websocket;

import com.blufftable.service.RoomService;
import com.blufftable.game.GameEngineRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.scheduling.annotation.Scheduled;

@Component
public class SpellingTicker {
    private static final Logger log = LoggerFactory.getLogger(SpellingTicker.class);
    private final RoomService rooms;
    private final GameSocketHandler sockets;
    private final GameEngineRegistry engines;
    public SpellingTicker(RoomService rooms, GameSocketHandler sockets, GameEngineRegistry engines) {
        this.rooms = rooms; this.sockets = sockets; this.engines = engines;
    }
    @Scheduled(fixedDelay = 250)
    public void tick() {
        for (var engine : engines.all()) {
            for (var id : engine.dueRooms()) {
                try {
                    if (rooms.advanceTimedGame(id)) sockets.broadcast(id);
                } catch (RuntimeException failure) {
                    log.error("Could not advance timed game in room {}", id, failure);
                }
            }
        }
    }
}
