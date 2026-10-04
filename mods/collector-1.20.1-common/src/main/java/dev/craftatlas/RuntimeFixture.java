package dev.craftatlas;

import net.minecraft.core.NonNullList;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.item.crafting.*;
import java.util.*;

/** Explicit opt-in for the harness's runtime-only evidence check. Normal captures do not mutate recipes. */
public final class RuntimeFixture {
    public static void install(MinecraftServer server) {
        if (!Boolean.getBoolean("craftatlas.testRuntimeFixture")) return;
        List<Recipe<?>> recipes = new ArrayList<>(server.getRecipeManager().getRecipes());
        ResourceLocation id = new ResourceLocation("craftatlas", "runtime_only");
        recipes.removeIf(r -> r.getId().equals(id));
        recipes.add(new ShapelessRecipe(id, "", CraftingBookCategory.MISC, new ItemStack(Items.EMERALD),
            NonNullList.of(Ingredient.EMPTY, Ingredient.of(Items.DIRT))));
        server.getRecipeManager().replaceRecipes(recipes);
    }
}
