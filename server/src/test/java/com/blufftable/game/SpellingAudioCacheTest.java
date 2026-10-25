package com.blufftable.game;

import com.blufftable.api.SpellingAudioController;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.web.server.ResponseStatusException;
import java.nio.file.*;
import java.util.*;
import static org.assertj.core.api.Assertions.*;

class SpellingAudioCacheTest {
    @TempDir Path directory;
    @Test void manifestHasEveryWordAndCacheServesFilesWithoutNetwork() throws Exception {
        var cache = new SpellingAudioCache(new ObjectMapper(), directory.toString());
        var words = new SpellingWords().pick(8, new java.security.SecureRandom(),new HashSet<>());
        var controller = new SpellingAudioController(cache);
        for (var word : words) {
            assertThat(cache.contains(word.id())).isTrue();
            Path file = directory.resolve(word.id()+".audio");
            Files.write(file, new byte[]{'O','g','g','S'});
            assertThat(cache.file(word.id())).isEqualTo(file);
            var response = controller.audio(word.id());
            assertThat(response.getStatusCode().value()).isEqualTo(200);
            assertThat(response.getHeaders().getContentType().getType()).isEqualTo("audio");
            assertThat(response.getBody().contentLength()).isEqualTo(4);
        }
        assertThat(cache.contains("../../etc/passwd")).isFalse();
        assertThatThrownBy(() -> controller.audio("unknown")).isInstanceOf(ResponseStatusException.class);
    }
    @Test void catalogAcceptsListedBritishVariantsAndDoesNotRepeatBeforeExhaustion() throws Exception {
        var catalog = new SpellingWords();var used = new HashSet<String>();
        var all = catalog.pick(2000,new java.security.SecureRandom(),used);
        assertThat(used).hasSize(2000);
        assertThat(all.stream().map(SpellingWords.Word::text)).doesNotHaveDuplicates();
        var acknowledgement = all.stream().filter(w -> w.text().equals("acknowledgment")).findFirst().orElseThrow();
        assertThat(acknowledgement.accepts("acknowledgement")).isTrue();
        assertThat(acknowledgement.accepts("acknowlegment")).isFalse();
        assertThat(catalog.pick(2,new java.security.SecureRandom(),used)).hasSize(2);
        assertThat(used).hasSize(2);
    }
}
