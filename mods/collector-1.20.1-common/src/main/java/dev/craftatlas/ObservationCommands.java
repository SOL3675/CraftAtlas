package dev.craftatlas;

import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.CommandBuildContext;
import net.minecraft.commands.Commands;
import net.minecraft.commands.arguments.ResourceLocationArgument;
import net.minecraft.commands.arguments.blocks.BlockStateArgument;
import net.minecraft.commands.arguments.item.ItemArgument;
import net.minecraft.core.registries.BuiltInRegistries;

/** Identical permission-inherited finite observation commands on Forge and Fabric 1.20.1. */
public final class ObservationCommands {
    public static LiteralArgumentBuilder<CommandSourceStack> tree(CommandBuildContext context) {
        return Commands.literal("observe")
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
                        () -> WorldObservations.entity(c.getSource(), BuiltInRegistries.ENTITY_TYPE.getOptional(ResourceLocationArgument.getId(c, "entity")).orElseThrow(() -> new IllegalArgumentException("Entity type is not registered")), IntegerArgumentType.getInteger(c, "trials"))))))))
                .then(Commands.literal("world").then(Commands.argument("label", StringArgumentType.word()).then(Commands.argument("radius", IntegerArgumentType.integer(0, 1))
                    .then(Commands.argument("minY", IntegerArgumentType.integer()).then(Commands.argument("maxY", IntegerArgumentType.integer()).executes(c -> Collector.observe(c.getSource(), StringArgumentType.getString(c, "label"),
                        () -> WorldObservations.world(c.getSource(), IntegerArgumentType.getInteger(c, "radius"), IntegerArgumentType.getInteger(c, "minY"), IntegerArgumentType.getInteger(c, "maxY")))))))));
    }
}
