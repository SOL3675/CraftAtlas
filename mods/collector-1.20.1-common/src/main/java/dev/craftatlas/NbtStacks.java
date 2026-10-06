package dev.craftatlas;

import net.minecraft.nbt.CompoundTag;
import net.minecraft.world.item.ItemStack;

/** Retain saved tag/capability data, while plain item ID/count remain ordinary quantities. */
public final class NbtStacks {
    public static String constraints(ItemStack stack) {
        CompoundTag saved = stack.save(new CompoundTag());
        saved.remove("id"); saved.remove("Count");
        return saved.isEmpty() ? null : saved.toString();
    }
}
