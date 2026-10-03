package dev.craftatlas.mixin;

import net.neoforged.neoforge.common.NeoForgeEventHandler;
import net.neoforged.neoforge.common.loot.LootModifierManager;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Invoker;

/** Accesses the actual reload-managed runtime instance, never a re-decoded approximation. */
@Mixin(value = NeoForgeEventHandler.class, remap = false)
public interface LootModifierManagerInvoker {
    @Invoker("getLootModifierManager") static LootModifierManager craftatlas$lootManager() { throw new IllegalStateException("Mixin invoker was not applied"); }
}
