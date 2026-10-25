package com.blufftable.api;

import com.blufftable.game.SpellingAudioCache;
import org.springframework.core.io.FileSystemResource;
import java.io.IOException;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import java.util.concurrent.TimeUnit;

@RestController
@RequestMapping("/api/spelling")
public class SpellingAudioController {
    private final SpellingAudioCache cache;
    public SpellingAudioController(SpellingAudioCache cache) { this.cache = cache; }
    @GetMapping("/audio/{id}")
    public ResponseEntity<Resource> audio(@PathVariable String id) {
        if (!cache.contains(id)) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        Resource resource;
        try { resource = new FileSystemResource(cache.file(id)); }
        catch (IOException e) { throw new ResponseStatusException(HttpStatus.SERVICE_UNAVAILABLE, "Pronunciation unavailable; retry preparation"); }
        return ResponseEntity.ok().cacheControl(CacheControl.maxAge(30, TimeUnit.DAYS))
                .contentType(MediaType.parseMediaType(cache.contentType(id))).body(resource);
    }
    @GetMapping(value = "/credits", produces = "text/html;charset=UTF-8")
    public Resource credits() { return new ClassPathResource("spelling/credits.html"); }
}
