package dev.craftatlas;

import com.google.gson.*;
import com.google.gson.internal.Streams;
import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import java.io.*;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.util.*;
import static dev.craftatlas.JsonFiles.*;

/** Raw acquisition only. A parsed JSON object does not establish recipe semantics. */
public final class DatapackCollector {
    @FunctionalInterface public interface Opener { InputStream open() throws IOException; }
    public record Resource(String source, Opener opener) {}
    public record ResourceStack(Resource effective, List<Resource> stack) {}
    public interface Source { Map<String, ResourceStack> list(String directory) throws IOException; }

    public static List<String> directories(String custom) {
        TreeSet<String> directories = new TreeSet<>(); directories.add("recipe");
        if (!custom.isBlank()) for (String value : custom.split(",", -1)) {
            String directory = value.trim();
            if (!directory.matches("[a-z0-9_-]+(?:/[a-z0-9_-]+)*")) throw new IllegalArgumentException("Invalid craftatlas.resourceDirectories entry: " + value);
            directories.add(directory);
        }
        return List.copyOf(directories);
    }

    public static JsonObject capture(Source source, List<String> selected, List<String> loaded, List<String> available,
                                     String custom, JsonArray coverage, JsonArray errors) {
        List<String> directories = directories(custom);
        TreeMap<String, ResourceStack> resources = new TreeMap<>();
        boolean failed = false; JsonArray failures = new JsonArray();
        for (String directory : directories) try { resources.putAll(source.list(directory)); }
        catch (Exception error) { failed = true; String reason = "Datapack directory " + directory + ": " + error; errors.add(reason); failures.add(reason); }
        JsonArray records = new JsonArray(); int readFailures = 0;
        for (var entry : resources.entrySet()) {
            JsonObject effective = read(entry.getKey(), entry.getValue().effective(), errors);
            JsonArray stack = new JsonArray();
            for (Resource resource : entry.getValue().stack()) {
                JsonObject variant = read(entry.getKey(), resource, errors); stack.add(variant);
                if (!variant.has("sha256")) ++readFailures;
            }
            if (!effective.has("sha256")) ++readFailures;
            records.add(object("id", entry.getKey(), "effective", effective, "stack", stack));
        }
        JsonArray limitations = array("Only active server data resources in declared directories are captured; client assets and disabled pack contents are excluded",
            "Stack order is the resource manager's low-to-high order, after pack filters; effective is obtained separately from listResources",
            "Source pack IDs do not identify a Mod author; loaded internal packs may differ from repository selection IDs",
            "Presence does not prove conditions passed, RecipeManager registration, custom API registration or machine executability",
            "Custom directories preserve JSON without inferring IDs, inputs, outputs or conditions; runtime-only recipes may have no resource");
        JsonArray reasons = limitations.deepCopy(); reasons.addAll(failures);
        if (readFailures > 0) reasons.add("Resource byte acquisition failed for " + readFailures + " effective/stack variants; see retained source errors");
        coverage.add(object("dataset", "datapack", "type", String.join(",", directories), "status", failed || readFailures > 0 ? "partial" : "complete",
            "enumerated", failed ? null : records.size(), "interpreted", null, "reasons", reasons));
        return object("directories", directories, "selectedPacks", selected, "loadedPacks", loaded,
            "disabledPacks", available.stream().filter(id -> !selected.contains(id)).sorted().toList(), "resources", records, "limitations", limitations);
    }

    private static JsonObject read(String id, Resource resource, JsonArray errors) {
        JsonObject result = object("source", resource.source(), "data", JsonNull.INSTANCE);
        try (InputStream stream = resource.opener().open()) {
            byte[] bytes = stream.readAllBytes(); result.addProperty("sha256", hash(bytes));
            String text;
            try { text = StandardCharsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString(); }
            catch (Exception error) { result.addProperty("bytesBase64", Base64.getEncoder().encodeToString(bytes)); throw error; }
            result.addProperty("text", text);
            // Keep strict JSON: permissive Gson parsing must not invent valid authoring data.
            try (JsonReader reader = new JsonReader(new StringReader(text))) {
                reader.setLenient(false);
                if (reader.peek() == JsonToken.END_DOCUMENT) throw new IOException("Empty JSON resource");
                JsonElement data = Streams.parse(reader);
                if (reader.peek() != JsonToken.END_DOCUMENT) throw new IOException("Trailing JSON content");
                canonical(data); // Unrepresentable numbers must retain text, not break publication.
                result.add("data", data);
            }
        } catch (Exception error) {
            result.add("data", JsonNull.INSTANCE); result.addProperty("error", error.toString());
            errors.add("Datapack " + id + " (" + resource.source() + "): " + error);
        }
        return result;
    }
}
