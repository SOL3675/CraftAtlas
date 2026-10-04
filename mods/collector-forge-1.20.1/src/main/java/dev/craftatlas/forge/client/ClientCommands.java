package dev.craftatlas.forge.client;

import dev.craftatlas.Collector;
import dev.craftatlas.ViewerBridge;
import com.mojang.brigadier.arguments.StringArgumentType;
import net.minecraft.client.Minecraft;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod.EventBusSubscriber;
import net.minecraftforge.client.event.RegisterClientCommandsEvent;

@EventBusSubscriber(modid = "craftatlas", value = Dist.CLIENT)
public final class ClientCommands {
    @SubscribeEvent public static void register(RegisterClientCommandsEvent event) {
        event.getDispatcher().register(Commands.literal("craftatlas-client")
            .then(Commands.literal("dump").then(Commands.argument("label", StringArgumentType.word()).executes(c -> {
                Minecraft mc = Minecraft.getInstance(); var server = mc.getSingleplayerServer();
                if (server == null || ViewerBridge.capture == null) {
                    c.getSource().sendFailure(Component.literal("Requires an integrated server and ready JEI runtime")); return 0;
                }
                try {
                    var viewer = ViewerBridge.capture.apply(server);
                    String label = StringArgumentType.getString(c, "label");
                    server.execute(() -> Collector.dump(server.createCommandSourceStack(), label, viewer)); return 1;
                } catch (Exception e) { c.getSource().sendFailure(Component.literal(e.toString())); return 0; }
            }))));
    }
}
