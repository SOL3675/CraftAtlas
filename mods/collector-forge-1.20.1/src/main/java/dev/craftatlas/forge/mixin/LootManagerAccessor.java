package dev.craftatlas.forge.mixin;
import java.util.Map;
import net.minecraft.resources.ResourceLocation;
import net.minecraftforge.common.loot.IGlobalLootModifier;
import net.minecraftforge.common.loot.LootModifierManager;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;
@Mixin(value = LootModifierManager.class, remap = false)
public interface LootManagerAccessor {
    @Accessor("registeredLootModifiers") Map<ResourceLocation, IGlobalLootModifier> craftatlas$modifiers();
}
