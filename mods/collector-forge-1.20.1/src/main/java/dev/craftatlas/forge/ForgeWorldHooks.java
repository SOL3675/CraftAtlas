package dev.craftatlas.forge;

import com.google.gson.*;
import com.mojang.serialization.JsonOps;
import dev.craftatlas.Collector;
import dev.craftatlas.WorldCollector;
import net.minecraft.server.MinecraftServer;
import dev.craftatlas.forge.mixin.LootManagerInvoker;
import dev.craftatlas.forge.mixin.LootManagerAccessor;
import net.minecraftforge.common.loot.IGlobalLootModifier;
import static dev.craftatlas.JsonFiles.*;

/** Pinned Forge internal map preserves applied resource IDs and application order. */
public final class ForgeWorldHooks {
    public static void capture(MinecraftServer server, JsonObject world, JsonArray coverage, JsonArray errors) {
        JsonArray modifiers = world.getAsJsonArray("lootModifiers");
        try {
            var manager = LootManagerInvoker.craftatlas$manager();
            var applied = ((LootManagerAccessor) manager).craftatlas$modifiers();
            for (var entry : applied.entrySet()) modifiers.add(WorldCollector.row(entry.getKey().toString(), "forge:global_loot_modifier",
                () -> IGlobalLootModifier.DIRECT_CODEC.encodeStart(JsonOps.INSTANCE, entry.getValue())
                    .getOrThrow(false, message -> { throw new IllegalStateException(message); }), errors));
            WorldCollector.acquired(coverage, "loot", "runtime global modifiers in application order", modifiers);
        } catch (Exception error) {
            errors.add("Forge global loot modifiers: " + error);
            coverage.add(Collector.coverage("lootModifiers", "applied collection", "failed", null, null, array(error.toString())));
        }
    }
}
