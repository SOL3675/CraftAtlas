package dev.craftatlas.mixin;

import net.neoforged.neoforge.common.loot.IGlobalLootModifier;
import net.neoforged.neoforge.common.loot.LootModifierManager;
import net.minecraft.resources.ResourceLocation;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;
import java.util.Map;

/** Fixed NeoForge 21.1 boundary: no public API exposes registered modifier IDs. */
@Mixin(value = LootModifierManager.class, remap = false)
public interface LootModifierManagerAccessor {
    @Accessor("registeredLootModifiers") Map<ResourceLocation, IGlobalLootModifier> craftatlas$registeredModifiers();
}
