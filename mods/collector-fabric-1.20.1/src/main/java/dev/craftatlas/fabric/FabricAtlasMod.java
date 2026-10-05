package dev.craftatlas.fabric;
import net.fabricmc.api.ModInitializer;
import dev.craftatlas.Collector;
import dev.craftatlas.ObservationCommands;
import dev.craftatlas.RuntimeFixture;
import dev.craftatlas.JsonFiles;
import net.fabricmc.loader.api.FabricLoader;
import com.google.gson.JsonArray;
import java.util.Comparator;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import com.mojang.brigadier.arguments.StringArgumentType;
public final class FabricAtlasMod implements ModInitializer {
    @Override public void onInitialize() {
        Collector.initialize(new Collector.Platform() {
            public String loader() { return "fabric"; }
            public String loaderVersion() { return FabricLoader.getInstance().getModContainer("fabricloader").orElseThrow().getMetadata().getVersion().getFriendlyString(); }
            public String collectorVersion() { return FabricLoader.getInstance().getModContainer("craftatlas").orElseThrow().getMetadata().getVersion().getFriendlyString(); }
            public String viewer() { return "emi"; }
            public JsonArray mods() {
                JsonArray mods = new JsonArray();
                FabricLoader.getInstance().getAllMods().stream().sorted(Comparator.comparing(m -> m.getMetadata().getId())).forEach(m -> mods.add(JsonFiles.object("id", m.getMetadata().getId(), "version", m.getMetadata().getVersion().getFriendlyString())));
                return mods;
            }
            public void captureWorld(net.minecraft.server.MinecraftServer server, com.google.gson.JsonObject world, JsonArray coverage, JsonArray errors) {
                coverage.add(Collector.coverage("lootModifiers", "fabric", "unsupported", null, null, JsonFiles.array("Fabric Java loot hooks have no exhaustive registry; conditions and effects remain unknown")));
            }
        });
        ServerLifecycleEvents.SERVER_STARTED.register(server -> { RuntimeFixture.install(server); Collector.started(server); });
        ServerLifecycleEvents.SERVER_STOPPING.register(Collector::stopped);
        ServerLifecycleEvents.START_DATA_PACK_RELOAD.register((server, manager) -> Collector.reloading(server));
        ServerLifecycleEvents.END_DATA_PACK_RELOAD.register((server, manager, success) -> { if (success) { RuntimeFixture.install(server); Collector.reloaded(server); } });
        CommandRegistrationCallback.EVENT.register((dispatcher, context, environment) -> dispatcher.register(Commands.literal("craftatlas").requires(s -> s.hasPermission(2))
            .then(Commands.literal("status").executes(c -> { c.getSource().sendSuccess(() -> Component.literal(Collector.status(c.getSource().getServer())), false); return 1; }))
            .then(Commands.literal("dump").then(Commands.argument("label", StringArgumentType.word()).executes(c -> Collector.dump(c.getSource(), StringArgumentType.getString(c,"label"), null))))
            .then(ObservationCommands.tree(context))));
    }
}
