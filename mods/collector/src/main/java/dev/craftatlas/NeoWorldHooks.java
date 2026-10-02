package dev.craftatlas;

import com.google.gson.*;
import com.mojang.serialization.JsonOps;
import dev.craftatlas.mixin.LootModifierManagerAccessor;
import dev.craftatlas.mixin.LootModifierManagerInvoker;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.biome.Biome;
import net.neoforged.neoforge.common.loot.IGlobalLootModifier;
import static dev.craftatlas.JsonFiles.*;

public final class NeoWorldHooks {
    public static void supplement(MinecraftServer server, JsonObject world, JsonArray coverage, JsonArray errors) {
        var ops = server.reloadableRegistries().get().createSerializationContext(JsonOps.INSTANCE);
        JsonArray modifiers = new JsonArray();
        try {
            var manager = LootModifierManagerInvoker.craftatlas$lootManager();
            var runtime = ((LootModifierManagerAccessor) manager).craftatlas$registeredModifiers();
            // Map iteration is the actual CommonHooks.modifyLoot application order; never sort it.
            for (var entry : runtime.entrySet()) modifiers.add(WorldCollector.row(entry.getKey().toString(), "neoforge:global_loot_modifier",
                () -> WorldCollector.encode(IGlobalLootModifier.DIRECT_CODEC, entry.getValue(), ops), errors));
            WorldCollector.acquired(coverage, "loot", "runtime global modifiers in application order", modifiers);
        } catch (Exception e) {
            String reason = "Actual runtime Global Loot Modifier collection failed: " + e;
            errors.add(reason); coverage.add(WorldCollector.coverage("loot", "runtime global modifiers in application order", "failed", null, null, array(reason)));
        }
        world.add("lootModifiers", modifiers);
        var biomes = server.registryAccess().registryOrThrow(Registries.BIOME);
        for (var row : world.getAsJsonArray("biomes")) {
            var record = row.getAsJsonObject(); if (!record.get("data").isJsonObject()) continue;
            try {
                Biome biome = biomes.get(ResourceLocation.parse(record.get("id").getAsString()));
                record.getAsJsonObject("data").add("climate", WorldCollector.encode(Biome.ClimateSettings.CODEC.codec(), biome.getModifiedClimateSettings(), ops));
            } catch (Exception e) {
                String reason = "Applied biome climate codec failed: " + e; errors.add(reason); record.addProperty("error", reason);
                coverage.add(WorldCollector.coverage("worldgen", "applied biome climate", "partial", 1, null, array(reason)));
            }
        }
    }
}
