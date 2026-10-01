package dev.craftatlas;

import com.google.gson.JsonObject;
import net.minecraft.server.MinecraftServer;
import java.util.function.Function;

/** Optional plugin supplies this callback; common code never links JEI or client classes. */
public final class ViewerBridge {
    public static Function<MinecraftServer, JsonObject> capture;
}
