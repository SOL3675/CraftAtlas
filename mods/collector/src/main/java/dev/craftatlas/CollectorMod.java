package dev.craftatlas;

import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.RegisterCommandsEvent;
import net.neoforged.neoforge.event.OnDatapackSyncEvent;
import net.neoforged.neoforge.event.AddReloadListenerEvent;
import net.neoforged.neoforge.server.ServerLifecycleHooks;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppedEvent;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import com.mojang.brigadier.arguments.StringArgumentType;

@Mod("craftatlas")
public final class CollectorMod {
    public CollectorMod() {
        NeoForge.EVENT_BUS.addListener(this::commands);
        NeoForge.EVENT_BUS.addListener(this::started);
        NeoForge.EVENT_BUS.addListener(this::synced);
        NeoForge.EVENT_BUS.addListener(this::reloadStarting);
        NeoForge.EVENT_BUS.addListener(this::stopped);
    }
    private void commands(RegisterCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("craftatlas").requires(s -> s.hasPermission(2))
            .then(Commands.literal("status").executes(c -> {
                c.getSource().sendSuccess(() -> Component.literal(Collector.status(c.getSource().getServer())), false); return 1;
            }))
            .then(Commands.literal("dump").then(Commands.argument("label", StringArgumentType.word()).executes(c ->
                Collector.dump(c.getSource(), StringArgumentType.getString(c, "label"), null)))));
    }
    private void started(ServerStartedEvent event) {
        Collector.started(event.getServer());
        if (Boolean.getBoolean("craftatlas.autoDump")) Collector.dump(event.getServer().createCommandSourceStack(), "startup", null);
    }
    private void synced(OnDatapackSyncEvent event) {
        if (event.getPlayer() == null) Collector.reloaded(event.getPlayerList().getServer());
    }
    private void reloadStarting(AddReloadListenerEvent event) {
        var server = ServerLifecycleHooks.getCurrentServer();
        if (server != null) Collector.reloading(server);
    }
    private void stopped(ServerStoppedEvent event) { Collector.stopped(event.getServer()); }
}
