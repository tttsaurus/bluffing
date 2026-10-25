package com.blufftable.game;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.*;

/** Shared, text-only catalog. Audio is streamed separately, never loaded into the game heap. */
public final class SpellingWords {
    public record Word(String id, String text, Set<String> alternatives) {
        public boolean accepts(String answer) { return text.equals(answer) || alternatives.contains(answer); }
    }
    private static final List<Word> CATALOG = load();
    private static List<Word> load() {
        try (InputStream stream = SpellingWords.class.getResourceAsStream("/spelling/words.tsv")) {
            if (stream == null) throw new IllegalStateException("Missing spelling vocabulary");
            List<Word> words = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8)).lines()
                    .filter(line -> !line.isBlank() && !line.startsWith("#")).map(line -> {
                        String[] fields = line.split("\t", -1);
                        return new Word(fields[0], fields[1], fields.length < 3 || fields[2].isBlank()
                                ? Set.of() : Set.copyOf(Arrays.asList(fields[2].split(","))));
                    }).toList();
            if (words.size() != 2000 || words.stream().map(Word::text).distinct().count() != 2000
                    || words.stream().map(Word::id).distinct().count() != 2000) {
                throw new IllegalStateException("Spelling vocabulary must contain exactly 2000 unique words");
            }
            return words;
        } catch (IOException e) { throw new IllegalStateException("Cannot read spelling vocabulary", e); }
    }
    public List<Word> pick(int count, SecureRandom random, Set<String> used) {
        if (CATALOG.size() - used.size() < count) used.clear();
        List<Word> shuffled = new ArrayList<>(CATALOG.stream().filter(word -> !used.contains(word.id())).toList());
        Collections.shuffle(shuffled, random);
        List<Word> selected = List.copyOf(shuffled.subList(0, count));
        selected.forEach(word -> used.add(word.id()));
        return selected;
    }
    public static boolean containsId(String id) { return CATALOG.stream().anyMatch(word -> word.id().equals(id)); }
}
