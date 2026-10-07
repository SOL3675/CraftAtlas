package dev.craftatlas;
import java.nio.file.*;
import java.util.*;
import com.google.gson.*;
import static dev.craftatlas.JsonFiles.*;
/** Pure file/process identity probe. No Minecraft APIs or games are loaded. */
public final class IdentityProbe {
    public static void main(String[] args) throws Exception {
        Path root = Path.of(args[0]); Files.createDirectories(root.resolve("mods"));
        Path jar = root.resolve("mods/mod.jar"); Files.writeString(jar, "loaded-distribution");
        RuntimeIdentity unarmed = new RuntimeIdentity(root, () -> List.of(jar));
        if (unarmed.isArmed()) throw new AssertionError("Legacy unarmed captures must omit identity for older readers");
        System.out.println(canonical(unarmed.capture("missing", "session", 1)));
        System.setProperty("mod.option", "startup");
        Files.writeString(root.resolve(".craftatlas-launch.json"), "{\"schemaVersion\":1,\"launchNonce\":\"11111111-1111-1111-1111-111111111111\",\"propertyKeys\":[\"mod.option\"]}");
        Files.createDirectories(root.resolve("config")); Files.writeString(root.resolve("config/mod.json"), "first-config");
        Files.createDirectories(root.resolve("world/datapacks/pack")); Files.writeString(root.resolve("world/datapacks/pack/pack.mcmeta"), "first-pack");
        RuntimeIdentity identity = new RuntimeIdentity(root, () -> List.of(jar));
        if (!identity.isArmed()) throw new AssertionError("Harness launch must arm runtime identity");
        System.out.println(canonical(identity.capture("fresh", "session", 1)));
        Files.writeString(root.resolve("config/mod.json"), "changed-config");
        Files.writeString(root.resolve("world/datapacks/pack/pack.mcmeta"), "changed-pack");
        System.out.println(canonical(identity.capture("reload", "session", 2)));
        Files.writeString(root.resolve(".craftatlas-launch.json"), "{\"schemaVersion\":1,\"launchNonce\":\"22222222-2222-2222-2222-222222222222\"}");
        System.out.println(canonical(identity.capture("old-boot", "session", 2)));
        RuntimeIdentity restarted = new RuntimeIdentity(root, () -> List.of(jar));
        System.out.println(canonical(restarted.capture("new-boot", "next-session", 1)));
        Files.writeString(jar, "replaced-jar-after-boot");
        System.out.println(canonical(restarted.capture("stale-loaded-bytes", "next-session", 1)));
        System.out.println(canonical(new RuntimeIdentity(root, () -> List.of(root.resolve("mods"))).capture("development-origin", "session", 1)));
        Files.delete(jar);
        System.out.println(canonical(restarted.capture("missing-loaded-jar", "session", 1)));
        Files.writeString(jar, "loaded-distribution");
        RuntimeIdentity reloaded = new RuntimeIdentity(root, () -> List.of(jar));
        Files.writeString(root.resolve("world/datapacks/pack/pack.mcmeta"), "reloaded-pack");
        System.out.println(canonical(reloaded.capture("datapack-only-reload", "third-session", 2)));
        Files.writeString(root.resolve(".craftatlas-launch.json"), "{\"schemaVersion\":1,\"launchNonce\":\"33333333-3333-3333-3333-333333333333\",\"propertyKeys\":[\"mod.option\"]}");
        RuntimeIdentity properties = new RuntimeIdentity(root, () -> List.of(jar));
        System.setProperty("mod.option", "changed");
        System.out.println(canonical(properties.capture("property-after-boot", "fourth-session", 1)));
    }
}
