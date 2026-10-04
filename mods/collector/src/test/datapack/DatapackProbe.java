package dev.craftatlas;

import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.zip.ZipFile;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import static dev.craftatlas.JsonFiles.*;

/** Exercises real shared capture against an embedded archive + overriding directory.
 * The source boundary simulates ResourceManager; it is not a loader/game test. */
public final class DatapackProbe {
    public static void main(String[] args) throws Exception {
        if (args[0].equals("--stage")) {
            JsonObject snapshot = JsonParser.parseString(Files.readString(Path.of(args[1]))).getAsJsonObject();
            Path target = Path.of(args[2]); Files.move(JsonFiles.stage(target, snapshot, object()), target); return;
        }
        Path archive = Files.createTempFile("atlas-embedded-", ".jar"), fixture = Path.of(args[0]);
        try (var output = new ZipOutputStream(Files.newOutputStream(archive)); var files = Files.walk(fixture)) {
            for (Path file : files.filter(Files::isRegularFile).sorted().toList()) {
                output.putNextEntry(new ZipEntry(fixture.relativize(file).toString().replace('\\', '/')));
                Files.copy(file, output); output.closeEntry();
            }
        }
        try (ZipFile embedded = new ZipFile(archive.toFile())) {
            JsonArray coverage = new JsonArray(), errors = new JsonArray();
            DatapackCollector.Source source = directory -> {
                if (directory.equals("unavailable")) throw new IOException("Injected enumeration failure");
                Map<String, List<DatapackCollector.Resource>> stacks = new TreeMap<>();
                for (var entries = embedded.entries(); entries.hasMoreElements();) {
                    var entry = entries.nextElement(); String id = id(entry.getName(), directory);
                    if (id != null) stacks.computeIfAbsent(id, key -> new ArrayList<>()).add(new DatapackCollector.Resource("mod/embedded", () -> embedded.getInputStream(entry)));
                }
                Path override = Path.of(args[1]);
                try (var files = Files.walk(override)) {
                    for (Path file : files.filter(Files::isRegularFile).sorted().toList()) {
                        String id = id(override.relativize(file).toString().replace('\\', '/'), directory);
                        if (id != null) stacks.computeIfAbsent(id, key -> new ArrayList<>()).add(new DatapackCollector.Resource("file/override", () -> Files.newInputStream(file)));
                    }
                }
                if (directory.equals("recipe")) {
                    stacks.put("atlas:recipe/unreadable.json", List.of(new DatapackCollector.Resource("mod/embedded", () -> { throw new IOException("Injected read failure"); })));
                    stacks.put("atlas:recipe/invalid_utf8.json", List.of(new DatapackCollector.Resource("mod/embedded", () -> new ByteArrayInputStream(new byte[] { (byte)0xff }))));
                    stacks.put("atlas:recipe/trailing.json", List.of(new DatapackCollector.Resource("mod/embedded", () -> new ByteArrayInputStream("{} {}".getBytes(StandardCharsets.UTF_8)))));
                    stacks.put("atlas:recipe/permissive.json", List.of(new DatapackCollector.Resource("mod/embedded", () -> new ByteArrayInputStream("{unquoted:1}".getBytes(StandardCharsets.UTF_8)))));
                    stacks.put("atlas:recipe/overflow.json", List.of(new DatapackCollector.Resource("mod/embedded", () -> new ByteArrayInputStream("{\"number\":1e1000}".getBytes(StandardCharsets.UTF_8)))));
                }
                Map<String, DatapackCollector.ResourceStack> result = new TreeMap<>();
                stacks.forEach((id, stack) -> result.put(id, new DatapackCollector.ResourceStack(stack.getLast(), stack)));
                if (directory.equals("recipe")) {
                    var winner = new DatapackCollector.Resource("selected", () -> new ByteArrayInputStream("{\"type\":\"atlas:chosen\"}".getBytes(StandardCharsets.UTF_8)));
                    var other = new DatapackCollector.Resource("other", () -> new ByteArrayInputStream("{\"type\":\"atlas:other\"}".getBytes(StandardCharsets.UTF_8)));
                    result.put("atlas:recipe/nonlast.json", new DatapackCollector.ResourceStack(winner, List.of(winner, other)));
                }
                return result;
            };
            JsonObject data = DatapackCollector.capture(source, List.of("mod:atlas", "file/override"), List.of("mod/embedded", "file/override"),
                List.of("mod:atlas", "file/override", "file/disabled"), "machines,recipe,unavailable", coverage, errors);
            if (errors.isEmpty()) throw new AssertionError("Faults were lost");
            if (!DatapackCollector.directories("").equals(List.of("recipe"))) throw new AssertionError("Default recipe directory lost");
            JsonArray parseCoverage = new JsonArray(), parseErrors = new JsonArray();
            var malformed = new DatapackCollector.Resource("mod/embedded", () -> new ByteArrayInputStream("{".getBytes(StandardCharsets.UTF_8)));
            DatapackCollector.capture(directory -> Map.of("atlas:recipe/bad.json", new DatapackCollector.ResourceStack(malformed, List.of(malformed))),
                List.of("mod:atlas"), List.of("mod/embedded"), List.of("mod:atlas"), "", parseCoverage, parseErrors);
            if (!parseCoverage.get(0).getAsJsonObject().get("status").getAsString().equals("complete") || parseErrors.isEmpty()) throw new AssertionError("Raw bytes and parsing coverage were conflated");
            for (String invalid : List.of("../recipe", "/recipe", "recipe/", "recipe,,other")) {
                try { DatapackCollector.directories(invalid); throw new AssertionError("Accepted directory " + invalid); }
                catch (IllegalArgumentException expected) {}
            }
            System.out.println(canonical(object("datapack", data, "coverage", coverage, "errors", errors)));
        } finally { Files.deleteIfExists(archive); }
    }
    private static String id(String path, String directory) {
        String[] pieces = path.split("/", 3);
        if (pieces.length != 3 || !pieces[0].equals("data") || !pieces[2].startsWith(directory + "/") || !path.endsWith(".json")) return null;
        return pieces[1] + ":" + pieces[2];
    }
}
