package dev.craftatlas.forge.client;

import com.google.gson.*;
import dev.craftatlas.Collector;
import dev.craftatlas.NbtStacks;
import dev.craftatlas.ViewerBridge;
import mezz.jei.api.IModPlugin;
import mezz.jei.api.JeiPlugin;
import mezz.jei.api.runtime.IJeiRuntime;
import mezz.jei.api.recipe.RecipeIngredientRole;
import mezz.jei.api.recipe.category.IRecipeCategory;
import mezz.jei.api.ingredients.ITypedIngredient;
import net.minecraft.client.Minecraft;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.crafting.Recipe;
import net.minecraft.server.MinecraftServer;
import net.minecraftforge.fluids.FluidStack;
import java.util.*;
import static dev.craftatlas.JsonFiles.*;

@JeiPlugin
public final class AtlasJeiPlugin implements IModPlugin {
    private IJeiRuntime runtime;
    private MinecraftServer associatedServer;
    private String session;
    private long generation;
    @Override public ResourceLocation getPluginUid() { return new ResourceLocation("craftatlas", "collector"); }
    @Override public void onRuntimeAvailable(IJeiRuntime runtime) {
        this.runtime = runtime; associatedServer = Minecraft.getInstance().getSingleplayerServer();
        if (associatedServer != null) { session = Collector.session(associatedServer); generation = Collector.generation(associatedServer); }
        ViewerBridge.capture = this::capture;
        org.slf4j.LoggerFactory.getLogger("CraftAtlas").info("CRAFTATLAS JEI READY session={} generation={}", session, generation);
    }
    @Override public void onRuntimeUnavailable() { runtime = null; associatedServer = null; ViewerBridge.capture = null; }
    private JsonObject capture(MinecraftServer server) {
        Minecraft mc = Minecraft.getInstance();
        if (runtime == null || server != associatedServer || !Objects.equals(session, Collector.session(server)) || generation != Collector.generation(server))
            throw new IllegalStateException("JEI cache has no matching runtime completion for the current server session/generation");
        JsonArray recipes = new JsonArray(), coverage = new JsonArray();
        runtime.getRecipeManager().createRecipeCategoryLookup().includeHidden().get()
            .sorted(Comparator.comparing(c -> c.getRecipeType().getUid().toString())).forEach(category -> captureCategory(category, recipes, coverage));
        List<JsonElement> stableRecipes = new ArrayList<>(); recipes.forEach(stableRecipes::add);
        stableRecipes.sort(Comparator.comparing((JsonElement r) -> r.getAsJsonObject().get("id").getAsString()).thenComparing(dev.craftatlas.JsonFiles::canonical));
        Map<String, Integer> occurrences = new HashMap<>();
        JsonArray sortedRecipes = new JsonArray();
        for (JsonElement recipe : stableRecipes) {
            JsonObject row = recipe.getAsJsonObject(); String sourceId = row.get("id").getAsString();
            int occurrence = occurrences.merge(sourceId, 1, Integer::sum);
            if (occurrence > 1) {
                row.addProperty("id", sourceId + "/duplicate-" + occurrence);
                row.getAsJsonArray("unknown").add("Multiple viewer entries share source identity; correspondence is ambiguous");
            }
            sortedRecipes.add(row);
        }
        JsonObject context = object("player", mc.player == null ? null : mc.player.getUUID().toString(),
            "dimension", mc.level == null ? null : mc.level.dimension().location().toString(),
            "hiddenIncluded", true, "jeiVersion", "15.20.0.106", "equipmentMeaning", "Category catalysts are candidates, not proven structures",
            "limitations", array("Rendered text, probability, energy and temperature are not inferred", "Custom ingredients retained as opaque predicates", "Remote dedicated-server viewer capture unsupported"));
        return object("kind", "jei", "version", "15.20.0.106", "session", session, "generation", generation, "context", context, "recipes", sortedRecipes, "coverage", coverage);
    }
    private <T> void captureCategory(IRecipeCategory<T> category, JsonArray recipes, JsonArray coverage) {
        var manager = runtime.getRecipeManager(); String type = category.getRecipeType().getUid().toString();
        List<T> entries = manager.createRecipeLookup(category.getRecipeType()).includeHidden().get().toList();
        JsonArray failures = new JsonArray(); int captured = 0;
        JsonArray equipment = new JsonArray(); manager.createRecipeCatalystLookup(category.getRecipeType()).includeHidden().getItemStack()
            .map(stack -> BuiltInRegistries.ITEM.getKey(stack.getItem()).toString()).distinct().sorted().forEach(equipment::add);
        for (T recipe : entries) {
            try {
                JsonArray inputs = new JsonArray(), outputs = new JsonArray(), unknown = new JsonArray(), rawSlots = new JsonArray();
                var layout = manager.createRecipeLayoutDrawable(category, recipe, runtime.getJeiHelpers().getFocusFactory().getEmptyFocusGroup()).orElseThrow();
                for (var slot : layout.getRecipeSlotsView().getSlotViews()) {
                    JsonArray alternatives = new JsonArray(); List<Double> amounts = new ArrayList<>(); List<String> units = new ArrayList<>();
                    String unit = "item"; double amount = 1; boolean first = true;
                    for (ITypedIngredient<?> ingredient : slot.getAllIngredients().toList()) {
                        if (ingredient == null) { unknown.add("Empty viewer ingredient alternative"); continue; }
                        Object value = ingredient.getIngredient(); JsonObject alternative;
                        double quantity = 1; String ingredientUnit = "item";
                        if (value instanceof ItemStack stack) {
                            quantity = stack.getCount(); alternative = object("resource", BuiltInRegistries.ITEM.getKey(stack.getItem()).toString());
                            String constraints = NbtStacks.constraints(stack);
                            if (constraints != null) { alternative.add("components", object("nbt", constraints)); unknown.add("Viewer NBT/capability matching is not interpreted"); }
                        } else if (value instanceof FluidStack fluid) {
                            quantity = fluid.getAmount(); ingredientUnit = "mB";
                            alternative = object("resource", "fluid:" + BuiltInRegistries.FLUID.getKey(fluid.getFluid()));
                            if (fluid.hasTag()) { alternative.add("components", object("nbt", fluid.getTag().toString())); unknown.add("Viewer fluid NBT matching is not interpreted"); }
                        } else {
                            alternative = object("predicate", object("javaType", value.getClass().getName(), "encoding", "unavailable"));
                            unknown.add("Custom ingredient " + value.getClass().getName());
                        }
                        if (first) { amount = quantity; unit = ingredientUnit; first = false; }
                        else if (amount != quantity || !unit.equals(ingredientUnit)) unknown.add("Alternatives differ in quantity/unit; linked quantity not interpreted");
                        alternatives.add(alternative); amounts.add(quantity); units.add(ingredientUnit);
                    }
                    rawSlots.add(object("role", slot.getRole().toString(), "alternatives", alternatives, "amounts", amounts, "units", units));
                    if (slot.getRole() == RecipeIngredientRole.OUTPUT) {
                        if (alternatives.size() > 1) unknown.add("Output slot has alternatives; probabilities and correlation are unknown");
                        for (int i = 0; i < alternatives.size(); ++i) {
                            JsonObject a = alternatives.get(i).getAsJsonObject();
                            if (!a.has("resource")) { unknown.add("Opaque output ingredient"); continue; }
                            if (amounts.get(i) <= 0) { unknown.add("Viewer output quantity is zero/unknown; retained in raw slots"); continue; }
                            JsonObject output = object("resource", a.get("resource"), "amount", amounts.get(i), "unit", units.get(i),
                                "role", "primary", "probability", null, "evidence", array());
                            if (a.has("components")) output.add("components", a.get("components")); outputs.add(output);
                        }
                    } else if (slot.getRole() == RecipeIngredientRole.INPUT || slot.getRole() == RecipeIngredientRole.CATALYST) {
                        if (alternatives.isEmpty() || amount <= 0) { unknown.add("Empty/zero-amount viewer input; retained in raw slots"); continue; }
                        inputs.add(object("alternatives", alternatives, "amount", amount, "unit", unit,
                            "consumption", slot.getRole() == RecipeIngredientRole.CATALYST ? "catalyst" : "consumed", "evidence", array()));
                    }
                }
                ResourceLocation registryName = category.getRegistryName(recipe);
                String recipeId = recipe instanceof Recipe<?> holder ? holder.getId().toString() : registryName == null ? null : registryName.toString();
                JsonObject raw = object("category", type, "recipeClass", recipe.getClass().getName(), "registryName", registryName == null ? null : registryName.toString(), "slots", rawSlots);
                JsonObject row = object("recipeId", recipeId, "category", type, "inputs", inputs, "outputs", outputs, "equipment", equipment,
                    "execution", "unconfirmed", "unknown", unknown, "raw", raw);
                row.addProperty("id", type + "/" + (recipeId == null ? hash(row).substring(0, 24) : recipeId)); recipes.add(row); ++captured;
            } catch (Exception e) {
                String recipeId = recipe instanceof Recipe<?> value ? value.getId().toString() : null;
                JsonObject raw = object("category", type, "recipeClass", recipe.getClass().getName(), "error", e.toString());
                String id = type + "/failed/" + (recipeId == null ? hash(raw).substring(0, 24) : recipeId);
                failures.add(id + ": " + e);
                recipes.add(object("id", id, "recipeId", recipeId, "category", type, "inputs", array(), "outputs", array(), "equipment", equipment,
                    "execution", "unconfirmed", "unknown", array("Viewer capture failed: " + e), "raw", raw));
            }
        }
        coverage.add(Collector.coverage("viewer", type, captured == entries.size() ? "complete" : "partial", entries.size(), null, failures));
    }
}
