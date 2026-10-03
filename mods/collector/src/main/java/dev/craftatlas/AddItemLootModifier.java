package dev.craftatlas;

import com.mojang.serialization.MapCodec;
import com.mojang.serialization.Codec;
import com.mojang.serialization.codecs.RecordCodecBuilder;
import it.unimi.dsi.fastutil.objects.ObjectArrayList;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.storage.loot.LootContext;
import net.minecraft.world.level.storage.loot.predicates.LootItemCondition;
import net.neoforged.neoforge.common.loot.LootModifier;
import net.neoforged.neoforge.common.loot.IGlobalLootModifier;

/** Optional definition-driven supply rule; inert until explicitly enabled in a datapack. */
public final class AddItemLootModifier extends LootModifier {
    public static final MapCodec<AddItemLootModifier> CODEC = RecordCodecBuilder.mapCodec(instance -> codecStart(instance)
        .and(BuiltInRegistries.ITEM.byNameCodec().fieldOf("item").forGetter(modifier -> modifier.item))
        .and(Codec.intRange(1, 64).fieldOf("count").forGetter(modifier -> modifier.count))
        .apply(instance, AddItemLootModifier::new));
    private final Item item;
    private final int count;
    public AddItemLootModifier(LootItemCondition[] conditions, Item item, int count) { super(conditions); this.item = item; this.count = count; }
    @Override protected ObjectArrayList<ItemStack> doApply(ObjectArrayList<ItemStack> generatedLoot, LootContext context) {
        generatedLoot.add(new ItemStack(item, count)); return generatedLoot;
    }
    @Override public MapCodec<? extends IGlobalLootModifier> codec() { return CODEC; }
}
