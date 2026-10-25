package com.blufftable.game;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import java.io.*;
import java.net.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;

/** Bounded disk cache; at most four streaming downloads, no in-memory audio library. */
@Component
public class SpellingAudioCache {
    private static final long MAX_FILE = 5L * 1024 * 1024;
    private static final long MAX_CACHE = 128L * 1024 * 1024;
    private final Map<String, Map<String, String>> sources = new HashMap<>();
    private final Path directory;
    private final Semaphore downloads = new Semaphore(4);
    private final Object[] locks = new Object[64];

    public SpellingAudioCache(ObjectMapper json,
            @Value("${bluff.spelling.audio-cache:.local/spelling-audio}") String path) throws IOException {
        directory = Path.of(path);
        for (int i = 0; i < locks.length; i++) locks[i] = new Object();
        try (InputStream in = getClass().getResourceAsStream("/spelling/audio-manifest.json")) {
            if (in == null) throw new IOException("Missing pronunciation manifest");
            List<Map<String, String>> manifest = json.readValue(in, new TypeReference<>() {});
            for (var item : manifest) {
                URI url = URI.create(item.get("url"));
                if (!"https".equals(url.getScheme()) || !"upload.wikimedia.org".equals(url.getHost()))
                    throw new IOException("Unexpected pronunciation source");
                if (!SpellingWords.containsId(item.get("id"))) throw new IOException("Unknown pronunciation ID");
                sources.put(item.get("id"), item);
            }
            if (sources.size() != 2000) throw new IOException("Expected 2000 pronunciation sources");
        }
    }
    public boolean contains(String id) { return sources.containsKey(id); }
    public String contentType(String id) {
        String url = URI.create(sources.get(id).get("url")).getPath().toLowerCase(Locale.ROOT);
        return url.endsWith(".mp3") ? "audio/mpeg" : url.endsWith(".wav") ? "audio/wav" : "audio/ogg";
    }
    public Path file(String id) throws IOException {
        if (!contains(id)) throw new FileNotFoundException("Unknown pronunciation");
        synchronized (locks[Math.floorMod(id.hashCode(), locks.length)]) {
            Files.createDirectories(directory);
            Path target = directory.resolve(id + ".audio");
            if (Files.isRegularFile(target) && Files.size(target) > 0) {
                Files.setLastModifiedTime(target, java.nio.file.attribute.FileTime.fromMillis(System.currentTimeMillis()));
                return target;
            }
            boolean acquired = false;
            Path temporary = null;
            try {
                acquired = downloads.tryAcquire(10, TimeUnit.SECONDS);
                if (!acquired) throw new IOException("Pronunciation download is busy");
                temporary = Files.createTempFile(directory, "download-", ".tmp");
                HttpURLConnection connection = (HttpURLConnection) URI.create(sources.get(id).get("url")).toURL().openConnection();
                connection.setConnectTimeout(5000);
                connection.setReadTimeout(5000);
                connection.setInstanceFollowRedirects(false);
                connection.setRequestProperty("User-Agent", "BluffTableVocabulary/1.0");
                try {
                    if (connection.getResponseCode() != 200) throw new IOException("Pronunciation source unavailable");
                    long total = 0;
                    try (InputStream input = connection.getInputStream(); OutputStream output = Files.newOutputStream(temporary)) {
                        byte[] buffer = new byte[8192];
                        int length;
                        while ((length = input.read(buffer)) != -1) {
                            total += length;
                            if (total > MAX_FILE) throw new IOException("Pronunciation exceeds size limit");
                            output.write(buffer, 0, length);
                        }
                    }
                    if (total == 0) throw new IOException("Empty pronunciation");
                } finally { connection.disconnect(); }
                synchronized (this) {
                    trimCache(Files.size(temporary));
                    Files.move(temporary, target, StandardCopyOption.REPLACE_EXISTING);
                }
                return target;
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new IOException("Pronunciation download interrupted", e);
            } finally {
                if (temporary != null) Files.deleteIfExists(temporary);
                if (acquired) downloads.release();
            }
        }
    }
    private synchronized void trimCache(long incoming) throws IOException {
        List<Path> files;
        try (var stream = Files.list(directory)) {
            files = new ArrayList<>(stream.filter(p -> p.getFileName().toString().endsWith(".audio")).toList());
        }
        files.sort(Comparator.comparingLong(p -> p.toFile().lastModified()));
        long size = 0;
        for (Path file : files) size += Files.size(file);
        for (Path file : files) {
            if (size + incoming <= MAX_CACHE) break;
            long length = Files.size(file);
            if (Files.deleteIfExists(file)) size -= length;
        }
    }
}
