package dev.craftatlas.forge.mixin;
import net.minecraftforge.common.ForgeInternalHandler;
import net.minecraftforge.common.loot.LootModifierManager;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;
/** Fixed Forge 47.3.0 internal boundary; target names are not Minecraft obfuscated members. */
@Mixin(value = ForgeInternalHandler.class, remap = false)
public interface LootManagerInvoker {
    @Invoker("getLootModifierManager")
    static LootModifierManager craftatlas$manager() { throw new AssertionError("Mixin was not applied"); }
}
