package dev.craftatlas.fabric;
import com.google.gson.*;
import com.mojang.serialization.JsonOps;
import dev.emi.emi.api.*;
import dev.emi.emi.api.recipe.EmiRecipe;
import dev.emi.emi.api.stack.*;
import dev.emi.emi.runtime.EmiReloadManager;
import net.minecraft.client.Minecraft;
import net.minecraft.core.component.DataComponentPatch;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.material.Fluid;
import org.slf4j.LoggerFactory;
import java.util.*;
import static dev.craftatlas.JsonFiles.*;
/** Fixed EMI 1.1.24 boundary. Public recipe API plus pinned positive reload-completion signal. */
public final class AtlasEmiPlugin implements EmiPlugin {
    private static volatile MinecraftServer server;
    private static volatile String session;
    private static volatile long generation;
    private static volatile boolean announced;
    @Override public void register(EmiRegistry registry) {
        server = Minecraft.getInstance().getSingleplayerServer();
        session = server == null ? null : Collector.session(server);
        generation = server == null ? -1 : Collector.generation(server); announced = false;
        ViewerBridge.capture = AtlasEmiPlugin::capture;
        ViewerBridge.poll = () -> { if (!announced && ready()) { announced = true;
            LoggerFactory.getLogger("CraftAtlas").info("CRAFTATLAS EMI READY session={} generation={}", session, generation); } };
    }
    private static boolean ready() {
        var current = Minecraft.getInstance().getSingleplayerServer();
        return current != null && current == server && Objects.equals(session, Collector.session(current))
            && generation == Collector.generation(current) && EmiReloadManager.isLoaded();
    }
    private static JsonObject capture() {
        if (!ready()) throw new IllegalStateException("EMI reload is incomplete or generation/session is stale");
        var manager = EmiApi.getRecipeManager(); JsonArray recipes = new JsonArray();
        List<EmiRecipe> values = new ArrayList<>(manager.getRecipes());
        values.sort(Comparator.comparing(r -> r.getCategory().getId() + ":" + r.getId()));
        Map<String,Integer> duplicate = new HashMap<>();
        for (var recipe : values) {
            JsonArray inputs = new JsonArray(), outputs = new JsonArray(), unknown = array("Viewer execution and chance semantics are unconfirmed"), equipment = new JsonArray();
            for (var ingredient : recipe.getInputs()) addInput(ingredient, inputs, outputs, unknown);
            for (var ingredient : recipe.getCatalysts()) for (var stack : ingredient.getEmiStacks()) if (!stack.isEmpty()) equipment.add(resource(stack));
            for (var ingredient : manager.getWorkstations(recipe.getCategory())) for (var stack : ingredient.getEmiStacks()) if (!stack.isEmpty()) equipment.add(resource(stack));
            int output = 0;
            JsonArray rawOutputs = new JsonArray();
            for (var stack : recipe.getOutputs()) if (!stack.isEmpty()) {
                rawOutputs.add(object("resource",resource(stack),"amount",stack.getAmount(),"unit",unit(stack),"displayChance",stack.getChance()));
                if (stack.getAmount() > 0) outputs.add(output(stack, output++ == 0 ? "primary" : "byproduct", unknown));
                else unknown.add("Viewer output quantity is zero/unknown; no executable quantity is inferred");
            }
            String id = recipe.getId() == null ? "anonymous:" + hash(object("category", recipe.getCategory().getId().toString(), "inputs",inputs,"outputs",outputs)) : recipe.getId().toString();
            int n = duplicate.merge(id, 1, Integer::sum); String entry = "emi:" + id + (n == 1 ? "" : ":duplicate-" + n);
            String recipeId = null;
            try { var backing = recipe.getBackingRecipe(); if (backing != null) recipeId = backing.id().toString(); }
            catch (Exception e) { unknown.add("Backing recipe lookup failed: " + e); }
            if (recipeId == null) unknown.add("No backing runtime recipe; correspondence is unknown");
            recipes.add(object("id",entry,"recipeId",recipeId,"category",recipe.getCategory().getId().toString(),"inputs",inputs,"outputs",outputs,
                "equipment",equipment,"execution","unconfirmed","unknown",unknown,"raw",object("viewerId",id,"outputs",rawOutputs,"supportsRecipeTree",recipe.supportsRecipeTree(),"hideCraftable",recipe.hideCraftable())));
        }
        if (!ready()) throw new IllegalStateException("EMI changed during capture");
        JsonArray coverage = array(Collector.coverage("viewer","emi","complete",recipes.size(),null,
            array("Public registered recipe/category/workstation API; execution unconfirmed","Positive completion uses fixed EMI internal reload boundary")));
        boolean grinderSeen = false;
        for (var entry : recipes) { var value = entry.getAsJsonObject().get("recipeId"); if (!value.isJsonNull() && value.getAsString().startsWith("techreborn:grinder/")) grinderSeen = true; }
        if (net.fabricmc.loader.api.FabricLoader.getInstance().isModLoaded("techreborn") && !grinderSeen)
            coverage.add(Collector.coverage("viewer","emi/techreborn:grinder","unsupported",null,null,
                array("This fixed TechReborn/EMI combination does not register grinder display recipes; raw runtime grinder recipes are retained independently")));
        return object("kind","emi","version","1.1.24+1.21.1+fabric","session",session,"generation",generation,"context",object("viewer","emi","version","1.1.24+1.21.1+fabric","readiness","pinned EmiReloadManager.isLoaded positive completion", "limitations", array("EMI-absent and remote dedicated viewers are unsupported","Fabric fluid quantities retain droplet units","Displayed chance is not proof of independent probability")),"recipes",recipes,
            "coverage",coverage);
    }
    private static void addInput(EmiIngredient ingredient, JsonArray inputs, JsonArray outputs, JsonArray unknown) {
        if (ingredient.isEmpty()) return;
        JsonArray alternatives = new JsonArray(); Set<String> units = new HashSet<>();
        for (var stack : ingredient.getEmiStacks()) if (!stack.isEmpty()) {
            JsonObject alternative = object("resource",resource(stack)); components(stack,alternative,unknown); alternatives.add(alternative); units.add(unit(stack));
            if (!stack.getRemainder().isEmpty()) {
                if (stack.getRemainder().getAmount() > 0) outputs.add(output(stack.getRemainder(),"returned",unknown));
                else unknown.add("Remainder quantity is zero/unknown; no quantity inferred");
                if (ingredient.getEmiStacks().size() > 1) unknown.add("Alternative-specific returned container relationship is not interpreted");
            }
        }
        if (alternatives.isEmpty() || ingredient.getAmount() <= 0 || units.size() != 1) { unknown.add("Unsupported empty/mixed-unit/zero-amount ingredient"); return; }
        inputs.add(object("alternatives",alternatives,"amount",ingredient.getAmount(),"unit",units.iterator().next(),"consumption","consumed","evidence",array()));
        if (ingredient.getChance() != 1) unknown.add("Probabilistic input consumption is not interpreted");
    }
    private static JsonObject output(EmiStack stack, String role, JsonArray unknown) {
        JsonObject value = object("resource",resource(stack),"amount",stack.getAmount(),"unit",unit(stack),"role",role,"probability",null,"evidence",array());
        components(stack,value,unknown); return value;
    }
    private static String resource(EmiStack stack) {
        if (stack.getKey() instanceof Item) return stack.getId().toString();
        if (stack.getKey() instanceof Fluid) return "fluid:" + stack.getId();
        return "opaque:" + stack.getId();
    }
    private static String unit(EmiStack stack) { return stack.getKey() instanceof Fluid ? "droplet" : stack.getKey() instanceof Item ? "item" : "unknown"; }
    private static void components(EmiStack stack, JsonObject value, JsonArray unknown) {
        if (stack.getComponentChanges().isEmpty()) return;
        try { value.add("components", DataComponentPatch.CODEC.encodeStart(Minecraft.getInstance().level.registryAccess().createSerializationContext(JsonOps.INSTANCE),stack.getComponentChanges()).getOrThrow()); }
        catch (Exception e) { unknown.add("Components serialization failed: " + e); }
    }
}
