package com.blufftable.websocket;

import com.blufftable.game.GameEngine;
import com.blufftable.game.GameEngineRegistry;
import com.blufftable.service.RoomService;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import static org.mockito.Mockito.*;

class SpellingTickerTest {
    @Test void oneFailedRoomCannotPreventAnotherTimerFromSettling() {
        var rooms = mock(RoomService.class);
        var sockets = mock(GameSocketHandler.class);
        var engines = mock(GameEngineRegistry.class);
        var engine = mock(GameEngine.class);
        UUID failed = UUID.randomUUID(), deleted = UUID.randomUUID(), healthy = UUID.randomUUID();
        when(engines.all()).thenReturn(List.of(engine));
        when(engine.dueRooms()).thenReturn(List.of(failed, deleted, healthy));
        when(rooms.advanceTimedGame(failed)).thenThrow(new IllegalStateException("simulated transaction failure"));
        when(rooms.advanceTimedGame(healthy)).thenReturn(true);
        new SpellingTicker(rooms, sockets, engines).tick();
        verify(rooms).advanceTimedGame(deleted);
        verify(rooms).advanceTimedGame(healthy);
        verify(sockets).broadcast(healthy);
        verifyNoMoreInteractions(sockets);
    }
}
