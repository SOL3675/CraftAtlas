package dev.craftatlas.fabric;
import dev.craftatlas.Collector;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandRegistrationCallback;
import net.fabricmc.fabric.api.client.command.v2.ClientCommandManager;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.network.chat.Component;
import com.mojang.brigadier.arguments.StringArgumentType;
public final class FabricAtlasClient implements ClientModInitializer {
    @Override public void onInitializeClient() {
        ClientTickEvents.END_CLIENT_TICK.register(client -> { Runnable poll = ViewerBridge.poll; if (poll != null) poll.run(); });
        ClientCommandRegistrationCallback.EVENT.register((dispatcher, context) -> dispatcher.register(ClientCommandManager.literal("craftatlas-client")
            .then(ClientCommandManager.literal("dump").then(ClientCommandManager.argument("label", StringArgumentType.word()).executes(c -> {
                var server = c.getSource().getClient().getSingleplayerServer();
                if (server == null) { c.getSource().sendError(Component.literal("Only an integrated server is supported")); return 0; }
                try {
                    if (ViewerBridge.capture == null) throw new IllegalStateException("EMI runtime is absent or not initialized");
                    var viewer = ViewerBridge.capture.get(); String label = StringArgumentType.getString(c,"label");
                    server.execute(() -> Collector.dump(server.createCommandSourceStack(), label, viewer)); return 1;
                } catch (Exception e) { c.getSource().sendError(Component.literal(e.toString())); return 0; }
            })))));
    }
}
