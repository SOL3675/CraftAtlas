package dev.craftatlas.fabric;
import net.fabricmc.api.ModInitializer;
import dev.craftatlas.WorldObservations;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import net.minecraft.commands.arguments.ResourceLocationArgument;
import net.minecraft.commands.arguments.blocks.BlockStateArgument;
import net.minecraft.commands.arguments.item.ItemArgument;
import net.minecraft.core.registries.BuiltInRegistries;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.command.v2.CommandRegistrationCallback;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import com.mojang.brigadier.arguments.StringArgumentType;
public final class FabricAtlasMod implements ModInitializer {
    @Override public void onInitialize() {
        ServerLifecycleEvents.SERVER_STARTED.register(Collector::started);
        ServerLifecycleEvents.SERVER_STOPPING.register(Collector::stopped);
        ServerLifecycleEvents.START_DATA_PACK_RELOAD.register((server, manager) -> Collector.reloading(server));
        ServerLifecycleEvents.END_DATA_PACK_RELOAD.register((server, manager, success) -> { if (success) Collector.reloaded(server); });
        CommandRegistrationCallback.EVENT.register((dispatcher, context, environment) -> dispatcher.register(Commands.literal("craftatlas").requires(s -> s.hasPermission(2))
            .then(Commands.literal("status").executes(c -> { c.getSource().sendSuccess(() -> Component.literal(Collector.status(c.getSource().getServer())), false); return 1; }))
            .then(Commands.literal("dump").then(Commands.argument("label", StringArgumentType.word()).executes(c -> Collector.dump(c.getSource(), StringArgumentType.getString(c,"label"), null))))
            .then(Commands.literal("observe")
                .then(Commands.literal("loot").then(Commands.argument("label", StringArgumentType.word()).then(Commands.argument("table", ResourceLocationArgument.id())
                    .then(Commands.argument("trials", IntegerArgumentType.integer(1, 1000)).executes(c -> Collector.observe(c.getSource(), StringArgumentType.getString(c, "label"),
                        () -> WorldObservations.loot(c.getSource(), ResourceLocationArgument.getId(c, "table"), IntegerArgumentType.getInteger(c, "trials"))))))))
                .then(Commands.literal("block").then(Commands.argument("label", StringArgumentType.word()).then(Commands.argument("block", BlockStateArgument.block(context))
                    .then(Commands.argument("tool", ItemArgument.item(context)).then(Commands.argument("trials", IntegerArgumentType.integer(1, 1000)).executes(c -> {
                        var block = BlockStateArgument.getBlock(c, "block").getState(); var tool = ItemArgument.getItem(c, "tool").createItemStack(1, false);
                        return Collector.observe(c.getSource(), StringArgumentType.getString(c, "label"), () -> WorldObservations.block(c.getSource(), block, tool, IntegerArgumentType.getInteger(c, "trials")));
                    }))))))
                .then(Commands.literal("entity").then(Commands.argument("label", StringArgumentType.word()).then(Commands.argument("entity", ResourceLocationArgument.id())
                    .then(Commands.argument("trials", IntegerArgumentType.integer(1, 1000)).executes(c -> Collector.observe(c.getSource(), StringArgumentType.getString(c, "label"),
                        () -> WorldObservations.entity(c.getSource(), BuiltInRegistries.ENTITY_TYPE.get(ResourceLocationArgument.getId(c, "entity")), IntegerArgumentType.getInteger(c, "trials"))))))))
                .then(Commands.literal("world").then(Commands.argument("label", StringArgumentType.word()).then(Commands.argument("radius", IntegerArgumentType.integer(0, 1))
                    .then(Commands.argument("minY", IntegerArgumentType.integer()).then(Commands.argument("maxY", IntegerArgumentType.integer()).executes(c -> Collector.observe(c.getSource(), StringArgumentType.getString(c, "label"),
                        () -> WorldObservations.world(c.getSource(), IntegerArgumentType.getInteger(c, "radius"), IntegerArgumentType.getInteger(c, "minY"), IntegerArgumentType.getInteger(c, "maxY"))))))))))));
    }
}
