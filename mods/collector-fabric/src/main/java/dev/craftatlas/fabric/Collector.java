package dev.craftatlas.fabric;
import dev.craftatlas.WorldCollector;
import dev.craftatlas.JsonFiles;

import com.google.gson.*;
import com.mojang.serialization.JsonOps;
import net.minecraft.SharedConstants;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.item.crafting.Recipe;
import net.minecraft.world.item.crafting.RecipeHolder;
import net.fabricmc.loader.api.FabricLoader;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import static dev.craftatlas.JsonFiles.*;

public final class Collector {
    private static final Logger LOG = LoggerFactory.getLogger("CraftAtlas");
    private static final Map<MinecraftServer, State> STATES = new WeakHashMap<>();
    private static final ExecutorService WRITER = Executors.newSingleThreadExecutor(r -> { Thread t = new Thread(r, "CraftAtlas writer"); t.setDaemon(true); return t; });
    private static final class State {
        final String session = UUID.randomUUID().toString();
        long generation = 1;
        boolean active = true, busy = false, reloading = false;
        String status = "ready", last = "";
        final JsonArray observations = new JsonArray();
    }
    private static State state(MinecraftServer server) { synchronized (STATES) { return STATES.computeIfAbsent(server, s -> new State()); } }
    public static void started(MinecraftServer server) {
        State s = state(server); synchronized(s) { s.reloading = false; s.status = "ready"; }
        LOG.info("CRAFTATLAS READY session={} generation={}", s.session, s.generation);
    }
    public static void reloading(MinecraftServer server) {
        State s = state(server); synchronized(s) { ++s.generation; s.reloading = true; s.status = "reloading"; while (!s.observations.isEmpty()) s.observations.remove(0); }
        LOG.info("CRAFTATLAS RELOADING session={} generation={}", s.session, s.generation);
    }
    public static void reloaded(MinecraftServer server) {
        State s = state(server); synchronized (s) { if (!s.reloading) ++s.generation; s.reloading = false; s.status = "ready"; }
        LOG.info("CRAFTATLAS RELOADED session={} generation={}", s.session, s.generation);
    }
    public static void stopped(MinecraftServer server) { State s = state(server); synchronized(s) { s.active = false; } }
    public static String session(MinecraftServer server) { return state(server).session; }
    public static long generation(MinecraftServer server) { State s = state(server); synchronized(s) { return s.generation; } }
    public static String status(MinecraftServer server) {
        State s = state(server); synchronized(s) { return "CRAFTATLAS STATUS session=" + s.session + " generation=" + s.generation + " status=" + s.status + " last=" + s.last; }
    }
    /** Called only on the server thread; viewer is already copied on the client thread. */
    public static int dump(CommandSourceStack source, String label, JsonObject viewer) {
        MinecraftServer server = source.getServer(); State s = state(server);
        if (!label.matches("[a-zA-Z0-9_-]{1,80}")) { source.sendFailure(Component.literal("Invalid snapshot label")); return 0; }
        long generation;
        synchronized(s) {
            if (!s.active || s.busy || s.reloading) {
                String reason = s.reloading ? "reloading" : s.busy ? "busy" : "stopped";
                LOG.info("CRAFTATLAS REJECTED label={} status={} generation={}", label, reason, s.generation);
                source.sendFailure(Component.literal("Collector capture rejected: " + reason)); return 0;
            }
            generation = s.generation;
            if (viewer != null && (!viewer.get("session").getAsString().equals(s.session) || viewer.get("generation").getAsLong() != generation)) {
                source.sendFailure(Component.literal("Viewer generation differs from server")); return 0;
            }
            s.busy = true; s.status = "collecting";
        }
        long begin = System.nanoTime(), memory = usedMemory();
        try {
            JsonObject snapshot = capture(server, s.session, generation, viewer);
            long captureNanos = System.nanoTime() - begin, captureMemory = usedMemory() - memory;
            Path root = System.getProperty("craftatlas.output") == null ? server.getServerDirectory().resolve("craftatlas") : Path.of(System.getProperty("craftatlas.output"));
            Path target = root.resolve(label).toAbsolutePath();
            source.sendSuccess(() -> Component.literal("CRAFTATLAS CAPTURED label=" + label + " generation=" + generation), false);
            WRITER.execute(() -> {
                Path temporary = null;
                try {
                    temporary = JsonFiles.stage(target, snapshot, object("captureNanos", captureNanos, "heapDeltaBytes", captureMemory,
                        "capturedAt", java.time.Instant.now().toString(), "recipes", snapshot.getAsJsonArray("recipes").size()));
                    // Bounded fault injection for the harness's real reload/publication race test.
                    // Readiness still comes from lifecycle events; normal operation has no delay.
                    long testDelay = Math.max(0L, Math.min(5000L, Long.getLong("craftatlas.testWriteDelayMillis", 0L)));
                    if (testDelay > 0) Thread.sleep(testDelay);
                    synchronized(s) {
                        if (!s.active || s.generation != generation) throw new IllegalStateException("Server reloaded or stopped during capture; staged data is not published");
                        if (Files.exists(target)) throw new java.io.IOException("Refusing to overwrite " + target);
                        Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE);
                        s.status = snapshot.getAsJsonObject("completion").get("status").getAsString(); s.last = target.toString();
                    }
                    LOG.info("CRAFTATLAS COMPLETE label={} generation={} path={}", label, generation, target);
                } catch (Exception e) {
                    synchronized(s) { s.status = "failed"; }
                    // A failed generation/publication must never retain a readable successful completion marker.
                    if (temporary != null) {
                        try { Files.writeString(temporary.resolve("completion.json"), canonical(object("status", "failed", "id", snapshot.get("id"), "errors", array(e.toString())))); }
                        catch (Exception failure) { LOG.error("Could not invalidate staged completion {}", temporary, failure); }
                    }
                    LOG.error("CRAFTATLAS FAILED label={} generation={} staged={} reason={}", label, generation, temporary, e.toString());
                } finally { synchronized(s) { s.busy = false; } }
            });
            return 1;
        } catch (Exception e) {
            synchronized(s) { s.busy = false; s.status = "failed"; }
            LOG.error("CRAFTATLAS FAILED label={}", label, e); source.sendFailure(Component.literal(e.toString())); return 0;
        }
    }
    public static int observe(CommandSourceStack source, String label, java.util.function.Supplier<JsonObject> capture) {
        MinecraftServer server = source.getServer(); State s = state(server); long generation;
        if (!label.matches("[a-zA-Z0-9_-]{1,80}")) { source.sendFailure(Component.literal("Invalid observation label")); return 0; }
        synchronized(s) {
            if (!s.active || s.busy || s.reloading) { source.sendFailure(Component.literal("Collector cannot observe while busy/reloading/stopped")); return 0; }
            s.busy = true; s.status = "observing"; generation = s.generation;
        }
        try {
            JsonObject observation = capture.get(); observation.addProperty("schemaVersion", 1); observation.addProperty("id", label);
            observation.addProperty("session", s.session); observation.addProperty("generation", generation);
            observation.addProperty("environmentHash", hash(environment(server)));
            Path root = System.getProperty("craftatlas.output") == null ? server.getServerDirectory().resolve("craftatlas") : Path.of(System.getProperty("craftatlas.output"));
            Path target = root.resolve("observations").resolve(label).toAbsolutePath();
            source.sendSuccess(() -> Component.literal("CRAFTATLAS OBSERVATION CAPTURED label=" + label + " generation=" + generation), false);
            WRITER.execute(() -> {
                Path temporary = null;
                try {
                    if (Files.exists(target)) throw new java.io.IOException("Refusing to overwrite " + target);
                    temporary = target.resolveSibling(label + ".tmp-" + UUID.randomUUID()); Files.createDirectories(temporary);
                    String json = canonical(observation); JsonFiles.write(temporary.resolve("observation.json"), json);
                    String manifest = canonical(object("schemaVersion", 1, "id", label, "session", s.session, "generation", generation,
                        "files", object("observation.json", hash(json)), "contentHash", hash(observation)));
                    JsonFiles.write(temporary.resolve("manifest.json"), manifest);
                    JsonFiles.write(temporary.resolve("completion.json"), canonical(object("status", "complete", "errors", array(), "id", label, "manifestHash", hash(manifest))));
                    synchronized(s) {
                        if (!s.active || s.reloading || s.generation != generation) throw new IllegalStateException("Observation generation invalidated before publication");
                        if (Files.exists(target)) throw new java.io.IOException("Refusing to overwrite " + target);
                        Files.move(temporary, target, StandardCopyOption.ATOMIC_MOVE); s.observations.add(observation); s.status = "ready"; s.last = target.toString();
                    }
                    LOG.info("CRAFTATLAS OBSERVATION COMPLETE label={} generation={} path={}", label, generation, target);
                } catch (Exception error) {
                    if (temporary != null) try { Files.writeString(temporary.resolve("completion.json"), canonical(object("status", "failed", "errors", array(error.toString()), "id", label))); } catch (Exception failure) { LOG.error("Could not invalidate observation {}", temporary, failure); }
                    synchronized(s) { s.status = "failed"; } LOG.error("CRAFTATLAS OBSERVATION FAILED label={} reason={}", label, error.toString());
                } finally { synchronized(s) { s.busy = false; } }
            });
            return 1;
        } catch (Exception error) { synchronized(s) { s.busy = false; s.status = "failed"; } source.sendFailure(Component.literal(error.toString())); LOG.error("CRAFTATLAS OBSERVATION FAILED label={}", label, error); return 0; }
    }
    private static long usedMemory() { Runtime r = Runtime.getRuntime(); return r.totalMemory() - r.freeMemory(); }
    private static JsonObject capture(MinecraftServer server, String session, long generation, JsonObject viewer) throws Exception {
        JsonArray resources = new JsonArray(); JsonObject tags = new JsonObject();
        registry(BuiltInRegistries.ITEM, "item", "", resources, tags);
        registry(BuiltInRegistries.FLUID, "fluid", "fluid:", resources, tags);
        JsonArray recipes = new JsonArray(), errors = new JsonArray(); Map<String, int[]> counts = new TreeMap<>();
        var ops = server.registryAccess().createSerializationContext(JsonOps.INSTANCE);
        List<RecipeHolder<?>> holders = new ArrayList<>(server.getRecipeManager().getRecipes());
        holders.sort(Comparator.comparing(h -> h.id().toString()));
        for (RecipeHolder<?> holder : holders) {
            String type = BuiltInRegistries.RECIPE_SERIALIZER.getKey(holder.value().getSerializer()).toString();
            JsonObject raw = object("id", holder.id().toString(), "type", type);
            int[] count = counts.computeIfAbsent(type, t -> new int[2]); ++count[0];
            try { raw.add("data", Recipe.CODEC.encodeStart(ops, holder.value()).getOrThrow()); ++count[1]; }
            catch (Exception e) { raw.add("data", JsonNull.INSTANCE); raw.addProperty("error", e.toString()); errors.add(holder.id() + ": " + e); }
            recipes.add(raw);
        }
        JsonArray coverage = new JsonArray();
        coverage.add(coverage("registry", "item+fluid", "complete", resources.size(), null, array()));
        coverage.add(coverage("tags", "item+fluid", "complete", tags.size(), null, array()));
        for (var entry : counts.entrySet()) coverage.add(coverage("recipes", entry.getKey(), entry.getValue()[0] == entry.getValue()[1] ? "complete" : "partial", entry.getValue()[0], null,
            entry.getValue()[0] == entry.getValue()[1] ? array() : array("Recipe codec serialization failed; raw ID/type retained")));
        JsonObject world = WorldCollector.capture(server, coverage, errors);
        coverage.add(coverage("lootModifiers", "fabric", "unsupported", null, null, array("Fabric API has no Global Loot Modifier registry; code-driven loot hooks remain unknown")));
        if (viewer == null) coverage.add(coverage("viewer", "emi", "unsupported", null, null, array("Server-only capture; use integrated client /craftatlas-client dump after EMI runtime is ready")));
        JsonArray mods = new JsonArray();
        FabricLoader.getInstance().getAllMods().stream().sorted(Comparator.comparing(m -> m.getMetadata().getId())).forEach(m -> mods.add(object("id", m.getMetadata().getId(), "version", m.getMetadata().getVersion().getFriendlyString())));
        JsonObject environment;
        try {
            environment = environment(server);
            coverage.add(coverage("environment", "recipe+tag resources/configuration/datapacks", "complete", environment.getAsJsonObject("datapackResources").size(), null,
                array("Hashes preserve final resource source; overwriting script file/line remains unknown", "Other resource directories are not enumerated by the Phase 0-4 environment adapter")));
        } catch (Exception e) {
            String reason = "Required environment capture failed: " + e;
            errors.add(reason);
            environment = object("captureStatus", "failed", "reasons", array(reason));
            coverage.add(coverage("environment", "recipe+tag resources/configuration/datapacks", "failed", null, null, array(reason)));
        }
        JsonObject snapshot = object("schemaVersion", 1, "session", session, "generation", generation,
            "mode", server.isDedicatedServer() ? "dedicated" : "integrated", "minecraft", SharedConstants.getCurrentVersion().getName(),
            "loader", "fabric", "loaderVersion", FabricLoader.getInstance().getModContainer("fabricloader").orElseThrow().getMetadata().getVersion().getFriendlyString(),
            "collectorVersion", FabricLoader.getInstance().getModContainer("craftatlas").orElseThrow().getMetadata().getVersion().getFriendlyString(),
            "mods", mods, "environment", environment, "resources", resources, "tags", tags, "recipes", recipes, "coverage", coverage,
            "completion", object("status", errors.isEmpty() ? "complete" : "partial", "errors", errors));
        synchronized(state(server)) { world.add("observations", state(server).observations.deepCopy()); }
        snapshot.add("world", world);
        if (viewer != null) snapshot.add("viewer", viewer);
        snapshot.addProperty("id", hash(object("resources", resources, "tags", tags, "recipes", recipes, "environment", environment, "mods", mods,
            "world", world, "viewer", viewer)).substring(0, 24));
        return snapshot;
    }
    private static <T> void registry(Registry<T> registry, String kind, String prefix, JsonArray resources, JsonObject tags) {
        registry.keySet().stream().sorted(Comparator.comparing(Object::toString)).forEach(key -> resources.add(object("id", prefix + key,
            "kind", kind, "name", key.toString(), "evidence", array("runtime:registry:" + kind))));
        registry.getTags().sorted(Comparator.comparing(p -> p.getFirst().location().toString())).forEach(pair -> {
            List<String> members = pair.getSecond().stream().map(holder -> prefix + registry.getKey(holder.value())).sorted().toList();
            tags.add(prefix + pair.getFirst().location(), new Gson().toJsonTree(members));
        });
    }
    public static JsonObject coverage(String dataset, String type, String status, Integer enumerated, Integer interpreted, JsonArray reasons) {
        return object("dataset", dataset, "type", type, "status", status, "enumerated", enumerated, "interpreted", interpreted, "reasons", reasons);
    }
    private static JsonObject environment(MinecraftServer server) throws Exception {
        JsonObject rules = new JsonObject();
        var nbt = server.getGameRules().createTag(); for (String key : new TreeSet<>(nbt.getAllKeys())) rules.addProperty(key, nbt.getString(key));
        JsonObject files = new JsonObject();
        for (String directory : List.of("config", "defaultconfigs", "kubejs", "scripts")) hashFiles(server.getServerDirectory(), server.getServerDirectory().resolve(directory), files);
        hashFiles(server.getServerDirectory(), server.getWorldPath(net.minecraft.world.level.storage.LevelResource.ROOT).resolve("serverconfig"), files);
        hashFiles(server.getServerDirectory(), server.getWorldPath(net.minecraft.world.level.storage.LevelResource.ROOT).resolve("datapacks"), files);
        // Hash actual selected datapack resources, retaining source/priority instead of guessing an author.
        JsonObject datapackResources = new JsonObject();
        // Minecraft 1.21.1 rejects an empty lookup path. Enumerate explicit contract directories.
        for (String directory : List.of("recipe", "tags")) {
            for (var entry : new TreeMap<>(server.getResourceManager().listResources(directory, id -> true)).entrySet()) {
                try (var stream = entry.getValue().open()) { datapackResources.add(entry.getKey().toString(), object("source", entry.getValue().sourcePackId(), "sha256", hash(stream.readAllBytes()))); }
            }
        }
        if (datapackResources.isEmpty()) throw new IllegalStateException("Required applied recipe/tag resource environment capture enumerated zero resources");
        List<String> packs = server.getPackRepository().getSelectedPacks().stream().map(p -> p.getId()).toList();
        return object("datapacks", packs, "datapackResources", datapackResources, "configurationHashes", files, "gameRules", rules,
            "world", object("seed", Long.toString(server.overworld().getSeed()), "difficulty", server.getWorldData().getDifficulty().getSerializedName(),
                "hardcore", server.getWorldData().isHardcore(), "dimensions", server.levelKeys().stream().map(k -> k.location().toString()).sorted().toList()),
            "changeProvenance", "Final runtime state: overwriting script file/line and removed definition reasons are unknown");
    }
    private static void hashFiles(Path base, Path directory, JsonObject result) throws Exception {
        if (!Files.isDirectory(directory)) return;
        try (var paths = Files.walk(directory)) {
            for (Path file : paths.filter(Files::isRegularFile).sorted().toList()) {
                if (Files.isSymbolicLink(file) || file.toString().endsWith(".log")) continue;
                result.addProperty(base.toAbsolutePath().relativize(file.toAbsolutePath()).toString().replace('\\', '/'), hash(Files.readAllBytes(file)));
            }
        }
    }
}
