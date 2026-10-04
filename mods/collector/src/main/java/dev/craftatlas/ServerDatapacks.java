package dev.craftatlas;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import net.minecraft.server.MinecraftServer;
import java.util.*;

/** Both supported loaders use Minecraft's active SERVER_DATA resource manager. */
public final class ServerDatapacks {
    public static JsonObject capture(MinecraftServer server, JsonArray coverage, JsonArray errors) {
        var manager = server.getResourceManager();
        List<String> selected = server.getPackRepository().getSelectedPacks().stream().map(p -> p.getId()).toList();
        List<String> available = server.getPackRepository().getAvailablePacks().stream().map(p -> p.getId()).toList();
        List<String> loaded = manager.listPacks().map(p -> p.packId()).toList();
        return DatapackCollector.capture(directory -> {
            var effective = manager.listResources(directory, id -> id.getPath().endsWith(".json"));
            var stacks = manager.listResourceStacks(directory, id -> id.getPath().endsWith(".json"));
            Map<String, DatapackCollector.ResourceStack> resources = new TreeMap<>();
            for (var entry : effective.entrySet()) {
                var winner = entry.getValue();
                var stack = stacks.getOrDefault(entry.getKey(), List.of());
                resources.put(entry.getKey().toString(), new DatapackCollector.ResourceStack(
                    new DatapackCollector.Resource(winner.sourcePackId(), winner::open),
                    stack.stream().map(r -> new DatapackCollector.Resource(r.sourcePackId(), r::open)).toList()));
            }
            return resources;
        }, selected, loaded, available, System.getProperty("craftatlas.resourceDirectories", ""), coverage, errors);
    }
}
