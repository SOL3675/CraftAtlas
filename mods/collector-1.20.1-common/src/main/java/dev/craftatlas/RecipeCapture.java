package dev.craftatlas;

import com.google.gson.*;
import io.netty.buffer.Unpooled;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.server.MinecraftServer;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.*;
import java.util.*;
import static dev.craftatlas.JsonFiles.*;

/** 1.20.1 has no general Recipe JSON encoder. Never substitute source JSON for runtime state. */
public final class RecipeCapture {
    public static void capture(MinecraftServer server, Recipe<?> recipe, JsonObject raw, JsonArray errors, JsonArray coverage) {
        JsonObject serialization = object("encoding", "recipe-network-1.20.1", "limitations", array(
            "Serializer network payload is evidence, not portable JSON or execution proof",
            "Custom network encoders can omit server-only fields; source JSON remains separate",
            "Only exact vanilla implementations have reviewed runtime field extraction"));
        raw.add("serialization", serialization);
        FriendlyByteBuf buffer = new FriendlyByteBuf(Unpooled.buffer());
        try {
            network(recipe, buffer);
            byte[] bytes = new byte[buffer.readableBytes()]; buffer.getBytes(buffer.readerIndex(), bytes);
            serialization.addProperty("bytesBase64", Base64.getEncoder().encodeToString(bytes));
            serialization.addProperty("sha256", hash(bytes));
        } catch (Exception error) {
            serialization.addProperty("error", error.toString()); raw.addProperty("error", error.toString());
            errors.add("Recipe network " + recipe.getId() + ": " + error);
        } finally { buffer.release(); }
        try {
            JsonObject data = fields(server, recipe);
            raw.add("data", data == null ? JsonNull.INSTANCE : data);
            coverage.add(Collector.coverage("recipeSerialization", recipe.getId().toString(), data == null ? "unsupported" : "complete", 1, null,
                data == null ? array("No reviewed runtime JSON encoder for " + recipe.getClass().getName() + "; ID/type/network bytes and raw resources retained") : array("Reviewed vanilla runtime fields; original text retained separately")));
        } catch (Exception error) {
            raw.add("data", JsonNull.INSTANCE); raw.addProperty("error", error.toString()); errors.add("Recipe fields " + recipe.getId() + ": " + error);
            coverage.add(Collector.coverage("recipeSerialization", recipe.getId().toString(), "failed", 1, null, array(error.toString())));
        }
    }
    private static <T extends Recipe<?>> void network(T recipe, FriendlyByteBuf buffer) {
        @SuppressWarnings("unchecked") RecipeSerializer<T> serializer = (RecipeSerializer<T>) recipe.getSerializer();
        serializer.toNetwork(buffer, recipe);
    }
    private static JsonObject fields(MinecraftServer server, Recipe<?> recipe) {
        Class<?> type = recipe.getClass();
        JsonObject data = object("type", BuiltInRegistries.RECIPE_SERIALIZER.getKey(recipe.getSerializer()).toString(), "group", recipe.getGroup());
        if (type == ShapedRecipe.class) {
            ShapedRecipe shaped = (ShapedRecipe) recipe; JsonArray pattern = new JsonArray(); JsonObject key = new JsonObject();
            for (int y = 0; y < shaped.getHeight(); ++y) {
                StringBuilder row = new StringBuilder();
                for (int x = 0; x < shaped.getWidth(); ++x) {
                    int index = y * shaped.getWidth() + x; Ingredient ingredient = shaped.getIngredients().get(index);
                    if (ingredient == Ingredient.EMPTY) row.append(' ');
                    else { String symbol = Character.toString((char)('A' + index)); row.append(symbol); key.add(symbol, ingredient.toJson()); }
                }
                pattern.add(row.toString());
            }
            data.add("pattern", pattern); data.add("key", key);
        } else if (type == ShapelessRecipe.class) {
            JsonArray ingredients = new JsonArray(); recipe.getIngredients().forEach(i -> ingredients.add(i.toJson())); data.add("ingredients", ingredients);
        } else if (type == SmeltingRecipe.class || type == BlastingRecipe.class || type == SmokingRecipe.class || type == CampfireCookingRecipe.class) {
            AbstractCookingRecipe cooking = (AbstractCookingRecipe) recipe;
            data.add("ingredient", cooking.getIngredients().get(0).toJson());
            data.addProperty("cookingtime", cooking.getCookingTime()); data.addProperty("experience", cooking.getExperience());
        } else if (type == StonecutterRecipe.class) data.add("ingredient", recipe.getIngredients().get(0).toJson());
        else if (type == SmithingTransformRecipe.class) {
            // The vanilla serializer writes template/base/addition/result in this exact order.
            FriendlyByteBuf buffer = new FriendlyByteBuf(Unpooled.buffer());
            try {
                network(recipe, buffer);
                data.add("template", Ingredient.fromNetwork(buffer).toJson());
                data.add("base", Ingredient.fromNetwork(buffer).toJson());
                data.add("addition", Ingredient.fromNetwork(buffer).toJson());
                data.add("result", result(buffer.readItem()));
            } finally { buffer.release(); }
            return data;
        } else return null;
        data.add("result", result(recipe.getResultItem(server.registryAccess()))); return data;
    }
    private static JsonObject result(ItemStack stack) {
        JsonObject value = object("item", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString(), "count", stack.getCount());
        String constraints = NbtStacks.constraints(stack);
        if (constraints != null) value.addProperty("nbt", constraints);
        return value;
    }
}
