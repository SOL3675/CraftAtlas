# Fabric collector

This guide describes the existing 1.21.1 pack. Fabric 1.20.1 has an independent Java 17 build with API 0.92.7+1.20.1 and EMI 1.1.24+1.20.1; see [1.20.1 usage](usage.md#forge-and-fabric-1201) and [development validation](development.md#forge-and-fabric-1201-validation). TechReborn/RebornCore and the grinder adapter remain scoped to the pinned 1.21.1 pack.

The independent `mods/collector-fabric` build pins Minecraft 1.21.1, Fabric Loader 0.16.14, Fabric API 0.116.17+1.21.1, Loom 1.8.13, Gradle 8.10, and Java 21. [The pack lock](../fixtures/pack-fabric.lock.json) records download URLs and SHA-256 for EMI 1.1.24+1.21.1+fabric and TechReborn/RebornCore 5.11.19. EMI is client-only.

For setup and collector builds, see [development](development.md#fabric-1211-validation). Use the [capture commands](usage.md#fixed-collectors) with the installed collector. Remote dedicated-server viewer capture and viewer capture without EMI are unsupported.

EMI recipes/categories/workstations use its public API; completion additionally depends on the pinned EmiReloadManager.isLoaded behavior. The [1.20.1 EMI source tag](https://github.com/emilyploszaj/emi/tree/23d251ea8ea3a5fd7d760948f36014b185eac69f) confirms its separate `Recipe<?>` backing IDs and NBT stack API; the 1.20.1 adapter does not use 1.21.1 component patches. Other versions are not implicitly supported. Viewer display is not execution proof; output independence and return-container/OR matching may remain unknown. Fluids retain droplet units. The fixed EMI/TechReborn combination does not expose grinder viewer recipes; raw runtime grinder capture is separate.

The [TechReborn adapter](../packages/core/src/techreborn.ts) interprets only the pinned grinder's item/tag quantities, outputs, and base power/time. RebornCore power is EU/tick and time is pre-upgrade ticks. Their product is base EU, not observed supplied power or elapsed time. Upgrades, interruptions, other machines, custom ingredients, and components remain unknown/opaque. The [definition pack](../definitions/techreborn-5.11.19-fabric.json) retains missing output inventory capacity/slot conditions and original evidence.

Common world capture records applied data, but arbitrary Fabric Java loot hooks cannot be exhaustively enumerated. Finite observations cannot prove impossibility, rates, or infinite supply. These constraints apply even when required fixture suites pass.

Fabric 1.20.1 also implements the bounded `craftatlas observe loot|block|entity|world` commands. This is a port of the finite sampling boundary, not an exhaustive Fabric Java hook registry. Dedicated and integrated validation has completed for the reviewed implementation. Contributor checks for future changes are in the [observation validation procedure](development.md#validate-the-1201-observation-port).
