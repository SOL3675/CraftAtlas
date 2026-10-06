package dev.craftatlas;

import com.google.gson.*;
import com.mojang.serialization.JsonOps;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.core.BlockPos;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.resources.RegistryOps;
import net.minecraft.world.level.storage.loot.LootDataType;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LivingEntity;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.ChunkGenerator;
import net.minecraft.world.level.storage.loot.LootParams;
import net.minecraft.world.level.storage.loot.LootTable;
import net.minecraft.world.level.storage.loot.parameters.LootContextParams;
import java.util.*;
import static dev.craftatlas.JsonFiles.*;

/** Bounded, explicit observations. Sampling never grants items or proves absence. */
public final class WorldObservations {
    public static JsonObject loot(CommandSourceStack source, ResourceLocation tableId, int trials) {
        var parameters = new LootParams.Builder(source.getLevel()).withParameter(LootContextParams.ORIGIN, source.getPosition())
            .withOptionalParameter(LootContextParams.THIS_ENTITY, source.getEntity());
        return sample(source, tableId, parameters, trials, object("kind", "explicit_table", "tool", stack(source, ItemStack.EMPTY),
            "missingParameters", "Unsupported required table contexts fail explicitly; this command does not synthesize them"));
    }
    public static JsonObject block(CommandSourceStack source, BlockState state, ItemStack tool, int trials) {
        var parameters = new LootParams.Builder(source.getLevel()).withParameter(LootContextParams.ORIGIN, source.getPosition())
            .withParameter(LootContextParams.BLOCK_STATE, state).withParameter(LootContextParams.TOOL, tool)
            .withOptionalParameter(LootContextParams.THIS_ENTITY, source.getEntity());
        var ops = RegistryOps.create(JsonOps.INSTANCE, source.getServer().registryAccess());
        return sample(source, state.getBlock().getLootTable(), parameters, trials,
            object("kind", "block", "blockState", WorldCollector.encode(BlockState.CODEC, state, ops), "tool", stack(source, tool),
                "blockEntity", null, "explosionRadius", null, "breakPerformed", false));
    }
    public static JsonObject entity(CommandSourceStack source, EntityType<?> type, int trials) {
        var entity = type.create(source.getLevel());
        if (!(entity instanceof LivingEntity living)) throw new IllegalArgumentException("Observation requires a living entity type");
        entity.setPos(source.getPosition());
        var attacker = source.getEntity(); var damage = source.getLevel().damageSources().generic();
        if (attacker instanceof net.minecraft.world.entity.player.Player player) damage = source.getLevel().damageSources().playerAttack(player);
        var parameters = new LootParams.Builder(source.getLevel()).withParameter(LootContextParams.ORIGIN, source.getPosition())
            .withParameter(LootContextParams.THIS_ENTITY, entity).withParameter(LootContextParams.DAMAGE_SOURCE, damage)
            .withOptionalParameter(LootContextParams.KILLER_ENTITY, attacker).withOptionalParameter(LootContextParams.DIRECT_KILLER_ENTITY, attacker);
        if (attacker instanceof net.minecraft.world.entity.player.Player player) parameters.withParameter(LootContextParams.LAST_DAMAGE_PLAYER, player).withLuck(player.getLuck());
        var nbt = new net.minecraft.nbt.CompoundTag(); entity.saveWithoutId(nbt);
        return sample(source, living.getLootTable(), parameters, trials,
            object("kind", "entity", "entityType", BuiltInRegistries.ENTITY_TYPE.getKey(type).toString(), "entityState", nbt.toString(),
                "entitySpawned", false, "deathPerformed", false, "damageSource", damage.getMsgId(),
                "lastDamagePlayer", attacker instanceof net.minecraft.world.entity.player.Player player ? player.getUUID().toString() : null,
                "tool", stack(source, attacker instanceof LivingEntity actor ? actor.getMainHandItem() : ItemStack.EMPTY)));
    }
    private static JsonObject sample(CommandSourceStack source, ResourceLocation id, LootParams.Builder builder, int trials, JsonObject context) {
        if (trials < 1 || trials > 1000) throw new IllegalArgumentException("Trials must be 1..1000");
        if (!source.getServer().getLootData().getKeys(LootDataType.TABLE).contains(id)) throw new IllegalArgumentException("Loot table is not registered: " + id);
        LootTable table = source.getServer().getLootData().getLootTable(id);
        LootParams parameters = builder.create(table.getParamSet());
        context.addProperty("lootLuck", parameters.getLuck());
        context.addProperty("samplingApi", "LootTable.getRandomItems(LootParams,long)");
        JsonArray samples = new JsonArray(); Map<String, Long> totals = new TreeMap<>();
        long baseSeed = source.getLevel().getSeed();
        for (int trial = 0; trial < trials; ++trial) {
            long seed = baseSeed + trial + 1L;
            // The 1.20.1 long-seed overload treats zero as unspecified; record a nonzero seed.
            if (seed == 0L) seed = Long.MIN_VALUE; JsonArray outputs = new JsonArray();
            // Use the loader's non-raw runtime API; loader coverage declares acquired post-table hooks.
            for (ItemStack output : table.getRandomItems(parameters, seed)) {
                if (output.isEmpty()) continue;
                String resource = BuiltInRegistries.ITEM.getKey(output.getItem()).toString(); totals.merge(resource, (long) output.getCount(), Long::sum);
                outputs.add(object("resource", resource, "amount", output.getCount(), "stack", stack(source, output)));
            }
            samples.add(object("trial", trial, "randomSeed", Long.toString(seed), "outputs", outputs));
        }
        JsonObject result = base(source); result.addProperty("kind", "loot"); result.addProperty("lootTable", id.toString()); result.addProperty("trials", trials);
        result.add("context", context); result.add("samples", samples); result.add("totals", new Gson().toJsonTree(totals));
        result.add("limitations", array("Uses loader runtime LootTable.getRandomItems; collection coverage declares whether post-table hooks are acquired; actual break/death events are not sampled", "Absent samples do not prove zero probability", "Trial independence and context completeness are not inferred"));
        return result;
    }
    public static JsonObject world(CommandSourceStack source, int radius, int minY, int maxY) {
        if (radius < 0 || radius > 1 || minY > maxY || (long) maxY - minY > 63) throw new IllegalArgumentException("World observation radius must be 0..1 and height span at most 64 blocks");
        var level = source.getLevel();
        if (minY < level.getMinBuildHeight() || maxY >= level.getMaxBuildHeight()) throw new IllegalArgumentException("Height range outside dimension bounds");
        BlockPos origin = BlockPos.containing(source.getPosition()); int centerX = origin.getX() >> 4, centerZ = origin.getZ() >> 4;
        JsonArray chunks = new JsonArray(); Map<String, Long> totals = new TreeMap<>(); BlockPos.MutableBlockPos position = new BlockPos.MutableBlockPos();
        for (int x = centerX - radius; x <= centerX + radius; ++x) for (int z = centerZ - radius; z <= centerZ + radius; ++z) {
            boolean loaded = level.hasChunk(x, z); var chunk = level.getChunk(x, z); Map<String, Long> counts = new TreeMap<>(); Set<String> biomes = new TreeSet<>();
            for (int y = minY; y <= maxY; ++y) for (int dx = 0; dx < 16; ++dx) for (int dz = 0; dz < 16; ++dz) {
                position.set((x << 4) + dx, y, (z << 4) + dz);
                String block = "block:" + BuiltInRegistries.BLOCK.getKey(chunk.getBlockState(position).getBlock());
                counts.merge(block, 1L, Long::sum); totals.merge(block, 1L, Long::sum);
                biomes.add(level.getBiome(position).unwrapKey().map(key -> key.location().toString()).orElse("inline:unidentified"));
            }
            chunks.add(object("x", x, "z", z, "wasLoaded", loaded, "minY", minY, "maxY", maxY, "blockCounts", counts, "biomes", biomes));
        }
        JsonObject result = base(source); result.addProperty("kind", "world"); result.addProperty("trials", chunks.size()); result.add("chunks", chunks);
        result.add("totals", new Gson().toJsonTree(totals)); result.add("tool", stack(source, source.getEntity() instanceof LivingEntity actor ? actor.getMainHandItem() : ItemStack.EMPTY));
        result.add("limitations", array("Bounded sample of current world state; may load or generate requested chunks", "Previously generated/edited chunks are not classified as pristine generation", "Finite non-observation does not prove generation impossible", "Spawn rates, structure completion and dimension travel are not proven"));
        return result;
    }
    private static JsonObject base(CommandSourceStack source) {
        var level = source.getLevel(); var ops = RegistryOps.create(JsonOps.INSTANCE, source.getServer().registryAccess());
        BlockPos origin = BlockPos.containing(source.getPosition());
        return object("seed", Long.toString(level.getSeed()), "generator", WorldCollector.encode(ChunkGenerator.CODEC, level.getChunkSource().getGenerator(), ops),
            "dimension", level.dimension().location().toString(), "difficulty", level.getDifficulty().getSerializedName(),
            "biome", level.getBiome(BlockPos.containing(source.getPosition())).unwrapKey().map(key -> key.location().toString()).orElse("inline:unidentified"), "position", array(source.getPosition().x, source.getPosition().y, source.getPosition().z),
            "chunks", array(object("x", origin.getX() >> 4, "z", origin.getZ() >> 4)),
            "player", source.getEntity() instanceof net.minecraft.server.level.ServerPlayer player ? object("uuid", player.getUUID().toString(), "gameMode", player.gameMode.getGameModeForPlayer().getName(), "luck", player.getLuck()) : null,
            "gameTime", Long.toString(level.getGameTime()), "dayTime", Long.toString(level.getDayTime()), "weather", object("raining", level.isRaining(), "thundering", level.isThundering()),
            "gameRules", level.getGameRules().createTag().toString());
    }
    private static JsonElement stack(CommandSourceStack source, ItemStack stack) {
        if (stack.isEmpty()) return object("empty", true);
        return WorldCollector.encode(ItemStack.CODEC, stack, RegistryOps.create(JsonOps.INSTANCE, source.getServer().registryAccess()));
    }
}
