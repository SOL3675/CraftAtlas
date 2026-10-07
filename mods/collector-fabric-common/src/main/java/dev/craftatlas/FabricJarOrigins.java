package dev.craftatlas;

import java.net.URI;
import java.nio.file.*;
import java.util.*;
import net.fabricmc.loader.api.FabricLoader;
import net.fabricmc.loader.api.ModContainer;

/** Both installation provenance and actual runtime backing JARs; nested modules resolve through their loaded parent. */
public final class FabricJarOrigins {
    public static List<Path> paths(Path root) {
        return paths(FabricLoader.getInstance().getAllMods(), root);
    }
    public static List<Path> paths(Collection<ModContainer> containers, Path root) {
        Map<String, ModContainer> mods = new HashMap<>();
        for (ModContainer mod : containers) mods.put(mod.getMetadata().getId(), mod);
        Set<Path> paths = new HashSet<>();
        for (ModContainer mod : containers) {
            if (List.of("minecraft", "java", "fabricloader").contains(mod.getMetadata().getId())) continue;
            for (Path source : sources(mod, mods, new HashSet<>())) {
                if (!source.toAbsolutePath().normalize().startsWith(root.toAbsolutePath().normalize().resolve("mods")) && !loaderNestedSource(mod, mods, source, root)) throw new IllegalStateException("Unrecorded external Mod origin: " + mod.getMetadata().getId() + " kind=" + mod.getOrigin().getKind() + " source=" + source + " runtime=" + mod.getRootPaths());
                paths.add(source);
            }
            for (Path runtime : mod.getRootPaths()) {
                String uri = runtime.toUri().toString();
                int end = uri.indexOf("!/");
                if (!uri.startsWith("jar:file:") || end < 0) throw new IllegalStateException("Runtime Mod root is not a backing distribution JAR: " + mod.getMetadata().getId());
                paths.add(Path.of(URI.create(uri.substring(4, end))));
            }
        }
        return new ArrayList<>(paths);
    }
    private static List<Path> sources(ModContainer mod, Map<String, ModContainer> mods, Set<String> seen) {
        if (!seen.add(mod.getMetadata().getId())) throw new IllegalStateException("Cyclic nested Mod origin");
        var origin = mod.getOrigin();
        return switch (origin.getKind()) {
            case PATH -> origin.getPaths();
            case NESTED -> {
                var parent = mods.get(origin.getParentModId());
                if (parent == null) throw new IllegalStateException("Missing loaded parent for nested Mod origin");
                yield sources(parent, mods, seen);
            }
            default -> throw new IllegalStateException("Unknown Mod origin; capture identity is unverifiable");
        };
    }
    /** Loader-bundled nested modules are measured with their loaded parent, never treated as unrecorded deployed Mods. */
    private static boolean loaderNestedSource(ModContainer mod, Map<String, ModContainer> mods, Path source, Path root) {
        Set<String> seen = new HashSet<>();
        while (mod.getOrigin().getKind() == net.fabricmc.loader.api.metadata.ModOrigin.Kind.NESTED) {
            if (!seen.add(mod.getMetadata().getId())) return false;
            mod = mods.get(mod.getOrigin().getParentModId());
            if (mod == null) return false;
        }
        if (!mod.getMetadata().getId().equals("fabricloader")) return false;
        Path normalized = source.toAbsolutePath().normalize();
        return normalized.startsWith(root.toAbsolutePath().normalize().resolve("libraries/net/fabricmc/fabric-loader"))
            && mod.getOrigin().getPaths().stream().anyMatch(path -> path.toAbsolutePath().normalize().equals(normalized));
    }
}
