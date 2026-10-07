package dev.craftatlas;

import com.google.gson.*;
import java.nio.file.*;
import java.util.*;
import java.util.function.Supplier;
import static dev.craftatlas.JsonFiles.*;

/** Independent runtime measurements. A launcher nonce is read once at boot, never from an old dump. */
public final class RuntimeIdentity {
    private static final List<String> ROOTS = List.of("mods", "config", "defaultconfigs", "kubejs", "scripts", "world/serverconfig", "world/datapacks", "server.properties");
    private final Path root;
    private final Supplier<List<Path>> origins;
    private JsonArray startupJars;
    private String launchNonce;
    private String startupConfigurationHash;
    private String startupInputsHash;
    private String startupPropertiesHash;
    private final List<String> propertyKeys = new ArrayList<>();
    private final List<String> errors = new ArrayList<>();
    private final boolean armed;
    public boolean isArmed() { return armed; }
    public RuntimeIdentity(Path root, Supplier<List<Path>> origins) {
        this.root = root.toAbsolutePath().normalize(); this.origins = origins;
        armed = Files.exists(this.root.resolve(".craftatlas-launch.json"), LinkOption.NOFOLLOW_LINKS);
        try {
            Path launch = this.root.resolve(".craftatlas-launch.json");
            if (!Files.isRegularFile(launch, LinkOption.NOFOLLOW_LINKS)) throw new IllegalStateException("No launcher-issued capture identity; use a fresh harness-owned session");
            JsonObject value = JsonParser.parseString(Files.readString(launch)).getAsJsonObject();
            if (value.get("schemaVersion").getAsInt() != 1) throw new IllegalStateException("Unknown launch identity version");
            launchNonce = value.get("launchNonce").getAsString();
            if (value.has("propertyKeys")) for (JsonElement key : value.getAsJsonArray("propertyKeys")) propertyKeys.add(key.getAsString());
            startupJars = jars();
            JsonObject startupInputs = new JsonObject();
            for (String name : ROOTS) inputs(this.root.resolve(name), startupInputs);
            startupInputsHash = hash(startupInputs);
            startupConfigurationHash = configurationHash(startupInputs);
            startupPropertiesHash = hash(properties());
        } catch (Exception error) { errors.add(error.toString()); }
    }
    private JsonArray jars() throws Exception {
        JsonArray result = new JsonArray();
        var unique = new TreeMap<String, Path>();
        for (Path path : origins.get()) unique.put(path.toAbsolutePath().normalize().toString(), path);
        List<JsonObject> records = new ArrayList<>();
        for (Path file : unique.values()) {
            if (!Files.isRegularFile(file) || !file.getFileName().toString().endsWith(".jar")) throw new IllegalStateException("Loaded mod origin is not a measurable distribution JAR: " + file.getFileName());
            records.add(object("name", file.getFileName().toString(), "sha256", hash(Files.readAllBytes(file))));
        }
        records.sort(Comparator.comparing(JsonFiles::canonical)); records.forEach(result::add);
        if (result.isEmpty()) throw new IllegalStateException("No measured loaded mod origins");
        return result;
    }
    private void inputs(Path file, JsonObject result) throws Exception {
        if (!Files.exists(file, LinkOption.NOFOLLOW_LINKS)) return;
        if (Files.isSymbolicLink(file)) throw new IllegalStateException("Runtime identity does not follow symlinks");
        if (!file.toRealPath().startsWith(root.toRealPath())) throw new IllegalStateException("Runtime input escapes owned root");
        if (Files.isDirectory(file)) { try (var entries = Files.list(file)) { for (Path entry : entries.sorted().toList()) inputs(entry, result); } }
        else if (Files.isRegularFile(file)) result.addProperty(root.relativize(file).toString().replace('\\', '/'), hash(Files.readAllBytes(file)));
        else throw new IllegalStateException("Runtime input is not a regular file");
    }
    private JsonObject properties() {
        JsonObject result = new JsonObject();
        for (String key : propertyKeys) result.addProperty(key, System.getProperty(key));
        return result;
    }
    private static String configurationHash(JsonObject inputs) {
        JsonObject result = new JsonObject();
        for (String key : inputs.keySet()) if (key.equals("server.properties") || key.startsWith("config/") || key.startsWith("defaultconfigs/") || key.startsWith("world/serverconfig/")) result.add(key, inputs.get(key));
        return hash(result);
    }
    public JsonObject capture(String requestId, String session, long generation) {
        JsonObject measured = new JsonObject(); JsonArray loaded = new JsonArray();
        JsonObject properties = properties();
        List<String> failures = new ArrayList<>(errors);
        try {
            for (String name : ROOTS) inputs(root.resolve(name), measured);
            loaded = jars();
            if (!hash(measured).equals(startupInputsHash)) throw new IllegalStateException("Runtime input inventory changed after boot; fully restart with the intended config/datapack/script inputs before capture");
            if (startupJars == null || !hash(loaded).equals(hash(startupJars))) throw new IllegalStateException("Loaded JAR bytes changed after boot; restart the server before capture");
            if (!configurationHash(measured).equals(startupConfigurationHash) || !hash(properties).equals(startupPropertiesHash)) throw new IllegalStateException("Configuration or declared JVM properties changed after boot; fully restart before capture to verify applied inputs");
        } catch (Exception error) { failures.add(error.toString()); }
        return object("schemaVersion", 1, "status", failures.isEmpty() ? "complete" : "unsupported", "launchNonce", launchNonce,
            "requestId", requestId, "session", session, "generation", generation, "inputs", measured, "loadedJars", loaded,
            "startupJarsHash", startupJars == null ? null : hash(startupJars), "startupConfigurationHash", startupConfigurationHash,
            "startupInputsHash", startupInputsHash,
            "startupPropertiesHash", startupPropertiesHash, "jvmProperties", properties, "errors", failures);
    }
}
