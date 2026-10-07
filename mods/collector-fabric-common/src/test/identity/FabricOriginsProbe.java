package dev.craftatlas;
import java.lang.reflect.Proxy;
import java.net.URI;
import java.nio.file.*;
import java.util.*;
import java.util.zip.*;
import net.fabricmc.loader.api.ModContainer;
import net.fabricmc.loader.api.metadata.ModMetadata;
import net.fabricmc.loader.api.metadata.ModOrigin;

/** Uses the actual pinned Fabric Loader API without loading Minecraft. */
public final class FabricOriginsProbe {
    static Path jar(Path file) throws Exception { Files.createDirectories(file.getParent()); try(var out=new ZipOutputStream(Files.newOutputStream(file))) {out.putNextEntry(new ZipEntry("probe"));out.write(1);out.closeEntry();} return file; }
    static ModContainer mod(String id, ModOrigin origin, List<Path> roots) {
        var metadata=(ModMetadata)Proxy.newProxyInstance(ModMetadata.class.getClassLoader(),new Class<?>[]{ModMetadata.class},(p,m,a)->m.getName().equals("getId")?id:null);
        return (ModContainer)Proxy.newProxyInstance(ModContainer.class.getClassLoader(),new Class<?>[]{ModContainer.class},(p,m,a)->switch(m.getName()){case "getMetadata"->metadata;case "getOrigin"->origin;case "getRootPaths"->roots;default->null;});
    }
    static ModOrigin origin(List<Path> paths,String parent) { return new ModOrigin(){public Kind getKind(){return parent==null?Kind.PATH:Kind.NESTED;}public List<Path> getPaths(){return paths;}public String getParentModId(){return parent;}public String getParentSubLocation(){return "META-INF/jars/nested.jar";}}; }
    static void reject(List<ModContainer> mods,Path root,String expected) {try{FabricJarOrigins.paths(mods,root);throw new AssertionError("Expected rejection: "+expected);}catch(IllegalStateException error){if(!error.getMessage().contains(expected))throw error;}}
    public static void main(String[] args) throws Exception {
        Path root=Path.of(args[0]).toAbsolutePath();Path loader=jar(root.resolve("libraries/net/fabricmc/fabric-loader/0.16.14/fabric-loader.jar"));Path nested=jar(root.resolve(".fabric/processedMods/nested.jar"));Path distribution=jar(root.resolve("mods/mod.jar"));
        try(var nestedFs=FileSystems.newFileSystem(URI.create("jar:"+nested.toUri()),Map.of());var modFs=FileSystems.newFileSystem(URI.create("jar:"+distribution.toUri()),Map.of())) {
            var parent=mod("fabricloader",origin(List.of(loader),null),List.of());var bundled=mod("mixinextras",origin(List.of(),"fabricloader"),List.of(nestedFs.getPath("/")));var user=mod("user",origin(List.of(distribution),null),List.of(modFs.getPath("/")));
            var paths=FabricJarOrigins.paths(List.of(parent,bundled,user),root);if(!new HashSet<>(paths).equals(Set.of(loader,nested,distribution)))throw new AssertionError(paths);
            var userNested=mod("child",origin(List.of(),"user"),List.of(nestedFs.getPath("/")));if(!FabricJarOrigins.paths(List.of(user,userNested),root).contains(distribution))throw new AssertionError("Nested user Mod provenance lost");
            reject(List.of(mod("external",origin(List.of(loader),null),List.of(nestedFs.getPath("/")))),root,"Unrecorded external");
            reject(List.of(mod("fabricloader",origin(List.of(root.resolve("outside.jar")),null),List.of()),bundled),root,"Unrecorded external");
            reject(List.of(mod("child",origin(List.of(),"missing"),List.of())),root,"Missing loaded parent");
            reject(List.of(mod("a",origin(List.of(),"b"),List.of()),mod("b",origin(List.of(),"a"),List.of())),root,"Cyclic nested");
            reject(List.of(mod("development",origin(List.of(distribution),null),List.of(root))),root,"not a backing distribution");
        }
        System.out.println("{\"status\":\"passed\",\"cases\":7,\"boundary\":\"Actual Fabric API and backing JAR paths; no Minecraft loaded\"}");
    }
}
