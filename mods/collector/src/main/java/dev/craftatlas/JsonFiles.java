package dev.craftatlas;

import com.google.gson.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.security.MessageDigest;
import java.util.*;

/** Matches core/hash.ts: sorted object keys, array order retained, UTF-8 SHA-256. */
public final class JsonFiles {
    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().serializeNulls().create();
    public static JsonObject object(Object... pairs) {
        JsonObject result = new JsonObject();
        for (int i = 0; i < pairs.length; i += 2) result.add((String)pairs[i], GSON.toJsonTree(pairs[i + 1]));
        return result;
    }
    public static JsonArray array(Object... values) {
        JsonArray result = new JsonArray(); for (Object value : values) result.add(GSON.toJsonTree(value)); return result;
    }
    public static String canonical(JsonElement value) {
        if (value.isJsonObject()) {
            List<String> keys = new ArrayList<>(value.getAsJsonObject().keySet()); Collections.sort(keys);
            List<String> parts = new ArrayList<>();
            for (String key : keys) parts.add(quote(key) + ":" + canonical(value.getAsJsonObject().get(key)));
            return "{" + String.join(",", parts) + "}";
        }
        if (value.isJsonArray()) {
            List<String> parts = new ArrayList<>(); for (JsonElement child : value.getAsJsonArray()) parts.add(canonical(child));
            return "[" + String.join(",", parts) + "]";
        }
        if (value.isJsonPrimitive() && value.getAsJsonPrimitive().isNumber()) {
            return jsonNumber(value.getAsString());
        }
        if (value.isJsonPrimitive() && value.getAsJsonPrimitive().isString()) return quote(value.getAsString());
        return GSON.toJson(value);
    }
    /** JSON.stringify preserves U+2028/U+2029 and escapes only unpaired UTF-16 surrogates. */
    private static String quote(String input) {
        StringBuilder output = new StringBuilder("\"");
        for (int i = 0; i < input.length(); ++i) {
            char character = input.charAt(i);
            switch (character) {
                case '"' -> output.append("\\\"");
                case '\\' -> output.append("\\\\");
                case '\b' -> output.append("\\b");
                case '\t' -> output.append("\\t");
                case '\n' -> output.append("\\n");
                case '\f' -> output.append("\\f");
                case '\r' -> output.append("\\r");
                default -> {
                    if (Character.isHighSurrogate(character) && i + 1 < input.length() && Character.isLowSurrogate(input.charAt(i + 1))) {
                        output.append(character).append(input.charAt(++i));
                    } else if (character < 0x20 || Character.isSurrogate(character)) {
                        output.append("\\u");
                        for (int shift = 12; shift >= 0; shift -= 4) output.append("0123456789abcdef".charAt((character >>> shift) & 15));
                    } else output.append(character);
                }
            }
        }
        return output.append('"').toString();
    }
    /** ECMAScript's shortest round-trip decimal, with JSON.stringify exponent thresholds. */
    private static String jsonNumber(String input) {
        double number = Double.parseDouble(input);
        if (!Double.isFinite(number)) throw new IllegalArgumentException("Non-finite JSON number");
        if (number == 0) return "0";
        var exact = new java.math.BigDecimal(number);
        java.math.BigDecimal decimal = null;
        for (int precision = 1; precision <= 17; ++precision) {
            var candidate = exact.round(new java.math.MathContext(precision, java.math.RoundingMode.HALF_EVEN));
            if (candidate.doubleValue() == number) { decimal = candidate.stripTrailingZeros(); break; }
        }
        if (decimal == null) throw new IllegalStateException("Cannot represent JSON number");
        int exponent = decimal.precision() - decimal.scale() - 1;
        if (exponent >= 21 || exponent < -6) {
            String digits = decimal.unscaledValue().abs().toString();
            String significand = digits.length() == 1 ? digits : digits.substring(0, 1) + "." + digits.substring(1);
            return (number < 0 ? "-" : "") + significand + "e" + (exponent >= 0 ? "+" : "") + exponent;
        }
        return decimal.toPlainString();
    }
    public static String hash(byte[] bytes) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
        catch (Exception e) { throw new IllegalStateException(e); }
    }
    public static String hash(String value) { return hash(value.getBytes(StandardCharsets.UTF_8)); }
    public static String hash(JsonElement value) { return hash(canonical(value)); }
    public static void write(Path path, String value) throws java.io.IOException {
        Files.writeString(path, value, StandardCharsets.UTF_8, StandardOpenOption.CREATE_NEW);
    }
    public static Path stage(Path target, JsonObject snapshot, JsonObject measurements) throws java.io.IOException {
        if (Files.exists(target)) throw new java.io.IOException("Refusing to overwrite " + target);
        Path temporary = target.resolveSibling(target.getFileName() + ".tmp-" + UUID.randomUUID());
        Files.createDirectories(temporary);
        JsonObject metadata = snapshot.deepCopy(), checksums = new JsonObject();
        for (String field : List.of("resources", "tags", "coverage", "environment", "viewer", "world", "datapack")) {
            if (!snapshot.has(field)) continue;
            String name = field + ".json", value = canonical(snapshot.get(field));
            write(temporary.resolve(name), value); checksums.addProperty(name, hash(value)); metadata.remove(field);
        }
        StringBuilder lines = new StringBuilder();
        for (JsonElement recipe : snapshot.getAsJsonArray("recipes")) lines.append(canonical(recipe)).append('\n');
        write(temporary.resolve("recipes.jsonl"), lines.toString()); checksums.addProperty("recipes.jsonl", hash(lines.toString()));
        metadata.remove("recipes"); metadata.remove("completion");
        String manifest = canonical(object("schemaVersion", 1, "id", snapshot.get("id"), "metadata", metadata,
            "files", checksums, "contentHash", hash(snapshot)));
        write(temporary.resolve("manifest.json"), manifest);
        JsonObject completion = snapshot.getAsJsonObject("completion").deepCopy();
        completion.add("id", snapshot.get("id")); completion.addProperty("manifestHash", hash(manifest));
        write(temporary.resolve("measurements.json"), canonical(measurements));
        write(temporary.resolve("completion.json"), canonical(completion));
        return temporary;
    }
}
