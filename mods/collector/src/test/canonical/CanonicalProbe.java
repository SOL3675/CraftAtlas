package dev.craftatlas;

import com.google.gson.JsonParser;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Base64;

/** Standalone cross-language regression probe, run by scripts/check-collector-canonical.ts. */
public final class CanonicalProbe {
    public static void main(String[] args) throws Exception {
        var samples = JsonParser.parseString(Files.readString(Path.of(args[0]), StandardCharsets.UTF_8)).getAsJsonArray();
        for (var sample : samples) {
            byte[] bytes = JsonFiles.canonical(sample).getBytes(StandardCharsets.UTF_8);
            System.out.println(Base64.getEncoder().encodeToString(bytes) + "\t" + JsonFiles.hash(sample));
        }
    }
}
