package com.blufftable.game;

import com.blufftable.domain.GameType;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class GameEngineRegistry {
    private final Map<GameType, GameEngine> engines = new EnumMap<>(GameType.class);

    public GameEngineRegistry(List<GameEngine> discovered) {
        discovered.forEach(engine -> engines.put(engine.type(), engine));
    }

    public GameEngine require(GameType type) {
        GameEngine engine = engines.get(type);
        if (engine == null) throw new IllegalStateException("No engine registered for " + type);
        return engine;
    }

    public List<GameEngine> all() { return List.copyOf(engines.values()); }
}

