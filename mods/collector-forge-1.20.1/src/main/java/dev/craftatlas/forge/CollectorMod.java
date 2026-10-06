package dev.craftatlas.forge;
import dev.craftatlas.Collector;
import dev.craftatlas.ObservationCommands;
import dev.craftatlas.RuntimeFixture;

import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.event.OnDatapackSyncEvent;
import net.minecraftforge.event.AddReloadListenerEvent;
import net.minecraftforge.server.ServerLifecycleHooks;
import net.minecraftforge.event.server.ServerStartedEvent;
import net.minecraftforge.event.server.ServerStoppedEvent;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraftforge.fml.ModList;
import net.minecraftforge.versions.forge.ForgeVersion;
import com.google.gson.*;
import java.util.Comparator;
import static dev.craftatlas.JsonFiles.*;

@Mod("craftatlas")
public final class CollectorMod {
    public CollectorMod() {
        var modifiers = net.minecraftforge.registries.DeferredRegister.<com.mojang.serialization.Codec<? extends net.minecraftforge.common.loot.IGlobalLootModifier>>create(
            net.minecraftforge.registries.ForgeRegistries.Keys.GLOBAL_LOOT_MODIFIER_SERIALIZERS, "craftatlas");
        modifiers.register("add_item", () -> AddItemLootModifier.CODEC);
        modifiers.register(net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext.get().getModEventBus());
        Collector.initialize(new Collector.Platform() {
            public String loader() { return "forge"; }
            public String loaderVersion() { return ForgeVersion.getVersion(); }
            public String collectorVersion() { return ModList.get().getModContainerById("craftatlas").orElseThrow().getModInfo().getVersion().toString(); }
            public String viewer() { return "jei"; }
            public JsonArray mods() {
                JsonArray mods = new JsonArray();
                ModList.get().getMods().stream().sorted(Comparator.comparing(m -> m.getModId())).forEach(m -> mods.add(object("id", m.getModId(), "version", m.getVersion().toString())));
                return mods;
            }
            public void captureWorld(net.minecraft.server.MinecraftServer server, JsonObject world, JsonArray coverage, JsonArray errors) {
                ForgeWorldHooks.capture(server, world, coverage, errors);
            }
        });
        MinecraftForge.EVENT_BUS.addListener(this::commands);
        MinecraftForge.EVENT_BUS.addListener(this::started);
        MinecraftForge.EVENT_BUS.addListener(this::synced);
        MinecraftForge.EVENT_BUS.addListener(this::reloadStarting);
        MinecraftForge.EVENT_BUS.addListener(this::stopped);
    }
    private void commands(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("craftatlas").requires(s -> s.hasPermission(2))
            .then(Commands.literal("status").executes(c -> {
                c.getSource().sendSuccess(() -> Component.literal(Collector.status(c.getSource().getServer())), false); return 1;
            }))
            .then(Commands.literal("dump").then(Commands.argument("label", StringArgumentType.word()).executes(c ->
                Collector.dump(c.getSource(), StringArgumentType.getString(c, "label"), null))))
            .then(ObservationCommands.tree(event.getBuildContext())));
    }
    private void started(ServerStartedEvent event) {
        RuntimeFixture.install(event.getServer()); Collector.started(event.getServer());
        if (Boolean.getBoolean("craftatlas.autoDump")) Collector.dump(event.getServer().createCommandSourceStack(), "startup", null);
    }
    private void synced(OnDatapackSyncEvent event) {
        if (event.getPlayer() == null) { RuntimeFixture.install(event.getPlayerList().getServer()); Collector.reloaded(event.getPlayerList().getServer()); }
    }
    private void reloadStarting(AddReloadListenerEvent event) {
        var server = ServerLifecycleHooks.getCurrentServer();
        if (server != null) Collector.reloading(server);
    }
    private void stopped(ServerStoppedEvent event) { Collector.stopped(event.getServer()); }
}
