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
import com.mojang.brigadier.arguments.IntegerArgumentType;
import net.minecraft.commands.arguments.ResourceLocationArgument;
import net.minecraft.commands.arguments.blocks.BlockStateArgument;
import net.minecraft.commands.arguments.item.ItemArgument;
import net.minecraft.core.registries.BuiltInRegistries;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredRegister;
import net.neoforged.neoforge.registries.NeoForgeRegistries;
import com.mojang.serialization.MapCodec;
import net.neoforged.neoforge.common.loot.IGlobalLootModifier;

@Mod("craftatlas")
public final class CollectorMod {
    public CollectorMod(IEventBus modBus) {
        DeferredRegister<MapCodec<? extends IGlobalLootModifier>> modifiers = DeferredRegister.create(NeoForgeRegistries.Keys.GLOBAL_LOOT_MODIFIER_SERIALIZERS, "craftatlas");
        modifiers.register("add_item", () -> AddItemLootModifier.CODEC); modifiers.register(modBus);
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
                Collector.dump(c.getSource(), StringArgumentType.getString(c, "label"), null))))
            .then(Commands.literal("observe")
                .then(Commands.literal("loot").then(Commands.argument("label", StringArgumentType.word()).then(Commands.argument("table", ResourceLocationArgument.id())
                    .then(Commands.argument("trials", IntegerArgumentType.integer(1, 1000)).executes(c -> Collector.observe(c.getSource(), StringArgumentType.getString(c, "label"),
                        () -> WorldObservations.loot(c.getSource(), ResourceLocationArgument.getId(c, "table"), IntegerArgumentType.getInteger(c, "trials"))))))))
                .then(Commands.literal("block").then(Commands.argument("label", StringArgumentType.word()).then(Commands.argument("block", BlockStateArgument.block(event.getBuildContext()))
                    .then(Commands.argument("tool", ItemArgument.item(event.getBuildContext())).then(Commands.argument("trials", IntegerArgumentType.integer(1, 1000)).executes(c -> {
                        var block = BlockStateArgument.getBlock(c, "block").getState(); var tool = ItemArgument.getItem(c, "tool").createItemStack(1, false);
                        return Collector.observe(c.getSource(), StringArgumentType.getString(c, "label"), () -> WorldObservations.block(c.getSource(), block, tool, IntegerArgumentType.getInteger(c, "trials")));
                    }))))))
                .then(Commands.literal("entity").then(Commands.argument("label", StringArgumentType.word()).then(Commands.argument("entity", ResourceLocationArgument.id())
                    .then(Commands.argument("trials", IntegerArgumentType.integer(1, 1000)).executes(c -> Collector.observe(c.getSource(), StringArgumentType.getString(c, "label"),
                        () -> WorldObservations.entity(c.getSource(), BuiltInRegistries.ENTITY_TYPE.getOptional(ResourceLocationArgument.getId(c, "entity")).orElseThrow(() -> new IllegalArgumentException("Entity type is not registered")), IntegerArgumentType.getInteger(c, "trials"))))))))
                .then(Commands.literal("world").then(Commands.argument("label", StringArgumentType.word()).then(Commands.argument("radius", IntegerArgumentType.integer(0, 1))
                    .then(Commands.argument("minY", IntegerArgumentType.integer()).then(Commands.argument("maxY", IntegerArgumentType.integer()).executes(c -> Collector.observe(c.getSource(), StringArgumentType.getString(c, "label"),
                        () -> WorldObservations.world(c.getSource(), IntegerArgumentType.getInteger(c, "radius"), IntegerArgumentType.getInteger(c, "minY"), IntegerArgumentType.getInteger(c, "maxY")))))))))));
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
