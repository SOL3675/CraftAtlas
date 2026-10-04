package dev.craftatlas;

import com.google.gson.*;
import com.mojang.serialization.Codec;
import com.mojang.serialization.DynamicOps;
import com.mojang.serialization.JsonOps;
import net.minecraft.core.Registry;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.biome.Biome;
import net.minecraft.world.level.biome.BiomeGenerationSettings;
import net.minecraft.world.level.biome.MobSpawnSettings;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.ChunkGenerator;
import net.minecraft.world.level.levelgen.feature.ConfiguredFeature;
import net.minecraft.world.level.levelgen.placement.PlacedFeature;
import net.minecraft.world.level.storage.loot.LootTable;
import net.minecraft.world.level.storage.loot.LootDataType;
import net.minecraft.world.level.storage.loot.Deserializers;
import net.minecraft.resources.RegistryOps;
import java.util.*;
import java.util.function.Supplier;
import static dev.craftatlas.JsonFiles.*;

/** Minecraft-only acquisition shared by loader adapters. No inferred generation or drop result. */
public final class WorldCollector {
    public static JsonObject capture(MinecraftServer server, JsonArray coverage, JsonArray errors) {
        var ops = RegistryOps.create(JsonOps.INSTANCE, server.registryAccess());
        JsonArray tables = new JsonArray(), sources = new JsonArray(), biomes = new JsonArray(), dimensions = new JsonArray(), features = new JsonArray();
        var lootManager = server.getLootData();
        var lootKeys = lootManager.getKeys(LootDataType.TABLE);
        lootKeys.stream().sorted(Comparator.comparing(Object::toString)).forEach(id ->
            tables.add(row(id.toString(), "minecraft:loot_table", () -> Deserializers.createLootTableSerializer().create().toJsonTree(lootManager.getLootTable(id)), errors)));
        BuiltInRegistries.BLOCK.keySet().stream().sorted(Comparator.comparing(Object::toString)).forEach(id -> {
            var block = BuiltInRegistries.BLOCK.get(id); var table = block.getLootTable();
            sources.add(row("block:" + id, "block", () -> object("kind", "block", "resourceId", "block:" + id,
                "lootTable", table.toString(), "defaultMappingOnly", true,
                "registeredTablePresent", lootKeys.contains(table), "defaultState", encode(BlockState.CODEC, block.defaultBlockState(), ops),
                "item", BuiltInRegistries.ITEM.getKey(block.asItem()).toString(), "destroyTime", block.defaultDestroyTime()), errors));
        });
        BuiltInRegistries.ENTITY_TYPE.keySet().stream().sorted(Comparator.comparing(Object::toString)).forEach(id -> {
            var entity = BuiltInRegistries.ENTITY_TYPE.get(id); var table = entity.getDefaultLootTable();
            sources.add(row("entity:" + id, "entity", () -> object("kind", "entity", "resourceId", "entity:" + id,
                "lootTable", table.toString(), "defaultMappingOnly", true, "registeredTablePresent", lootKeys.contains(table),
                "category", entity.getCategory().getName(), "summonable", entity.canSummon(), "serializable", entity.canSerialize(),
                "width", entity.getDimensions().width, "height", entity.getDimensions().height), errors));
        });
        var biomeRegistry = server.registryAccess().registryOrThrow(Registries.BIOME);
        biomeRegistry.keySet().stream().sorted(Comparator.comparing(Object::toString)).forEach(id -> {
            Biome biome = biomeRegistry.get(id);
            biomes.add(row(id.toString(), "minecraft:biome", () -> object(
                "generation", encode(BiomeGenerationSettings.CODEC, biome.getGenerationSettings(), ops),
                "spawns", encode(MobSpawnSettings.CODEC, biome.getMobSettings(), ops),
                "climate", object("has_precipitation", biome.hasPrecipitation(), "temperature", biome.getBaseTemperature(),
                    "limitations", array("Applied downfall and temperature modifier require the loader adapter")),
                "original", encode(Biome.DIRECT_CODEC, biome, ops)), errors));
        });
        collectRegistry(server.registryAccess().registryOrThrow(Registries.CONFIGURED_FEATURE), "configured", "configured_feature:", ConfiguredFeature.DIRECT_CODEC, ops, features, errors);
        collectRegistry(server.registryAccess().registryOrThrow(Registries.PLACED_FEATURE), "placed", "placed_feature:", PlacedFeature.DIRECT_CODEC, ops, features, errors);
        List<net.minecraft.server.level.ServerLevel> levels = new ArrayList<>(); server.getAllLevels().forEach(levels::add);
        levels.sort(Comparator.comparing(level -> level.dimension().location().toString()));
        for (var level : levels) dimensions.add(row(level.dimension().location().toString(), "minecraft:dimension", () -> {
            ChunkGenerator generator = level.getChunkSource().getGenerator(); JsonObject generation = new JsonObject();
            var possible = generator.getBiomeSource().possibleBiomes().stream().sorted(Comparator.comparing(holder -> holder.unwrapKey().map(key -> key.location().toString()).orElse("inline:" + hash(encode(Biome.DIRECT_CODEC, holder.value(), ops))))).toList();
            List<String> names = new ArrayList<>();
            for (var biome : possible) {
                String name = biome.unwrapKey().map(key -> key.location().toString()).orElse("inline:" + hash(encode(Biome.DIRECT_CODEC, biome.value(), ops)));
                names.add(name); generation.add(name, encode(BiomeGenerationSettings.CODEC, generator.getBiomeGenerationSettings(biome), ops));
            }
            return object("generator", encode(ChunkGenerator.CODEC, generator, ops),
                "type", level.dimensionTypeRegistration().unwrapKey().map(key -> key.location().toString()).orElse(null),
                "seed", Long.toString(level.getSeed()), "possibleBiomes", names, "biomeGeneration", generation,
                "dimensionReachability", "Travel/unlock requirements must be supplied separately");
        }, errors));
        acquired(coverage, "loot", "tables", tables);
        acquired(coverage, "loot", "default block/entity mappings", sources);
        acquired(coverage, "worldgen", "applied biomes/spawns", biomes);
        acquired(coverage, "worldgen", "configured/placed features", features);
        acquired(coverage, "worldgen", "active dimension generators and biome membership", dimensions);
        coverage.add(coverage("loot", "event/code-driven changes", "unsupported", null, null,
            array("LivingDropsEvent, block drop events and custom Java supply paths are not fully enumerated", "Default entity loot mappings may be overridden per entity instance")));
        coverage.add(coverage("worldgen", "code spawn restrictions and observed supply rate", "unsupported", null, null,
            array("Spawn weights are not time-based supply rates", "Placement code, event restrictions and dimension travel are not inferred")));
        coverage.add(coverage("observation", "commands", "unsupported", null, null, array("Finite observation commands are not implemented for 1.20.1; no observed supply is inferred")));
        return object("lootTables", tables, "lootModifiers", array(), "lootSources", sources, "biomes", biomes, "dimensions", dimensions,
            "features", features, "observations", array(), "limitations", array(
                "Registered features, active generator membership and finite observations are distinct evidence",
                "Custom loot/spawn/worldgen Java and event paths remain unknown", "No observation proves absence or universal reachability"));
    }
    private static <T> void collectRegistry(Registry<T> registry, String type, String prefix, Codec<T> codec, DynamicOps<JsonElement> ops, JsonArray result, JsonArray errors) {
        registry.keySet().stream().sorted(Comparator.comparing(Object::toString)).forEach(id -> result.add(row(prefix + id, type, () -> encode(codec, registry.get(id), ops), errors)));
    }
    public static <T> JsonElement encode(Codec<T> codec, T value, DynamicOps<JsonElement> ops) { return codec.encodeStart(ops, value).getOrThrow(false, message -> { throw new IllegalStateException(message); }); }
    public static JsonObject row(String id, String type, Supplier<JsonElement> value, JsonArray errors) {
        JsonObject result = object("id", id, "type", type);
        try { result.add("data", value.get()); }
        catch (Exception error) { result.add("data", JsonNull.INSTANCE); result.addProperty("error", error.toString()); errors.add(type + " " + id + ": " + error); }
        return result;
    }
    public static JsonObject coverage(String dataset, String type, String status, Integer enumerated, Integer interpreted, JsonArray reasons) {
        return object("dataset", dataset, "type", type, "status", status, "enumerated", enumerated, "interpreted", interpreted, "reasons", reasons);
    }
    public static void acquired(JsonArray coverage, String dataset, String type, JsonArray values) {
        int failed = 0; for (var value : values) if (value.getAsJsonObject().has("error")) ++failed;
        coverage.add(coverage(dataset, type, failed == 0 ? "complete" : "partial", values.size(), null,
            failed == 0 ? array() : array(failed + " runtime codec records failed; IDs/types/errors are retained")));
    }
}
