package dev.craftatlas.fabric;
import dev.craftatlas.Collector;
import com.google.gson.JsonObject;
import java.util.function.Supplier;
/** No EMI class appears in this loader boundary: dedicated and EMI-absent clients remain loadable. */
public final class ViewerBridge {
    public static volatile Supplier<JsonObject> capture;
    public static volatile Runnable poll;
    private ViewerBridge() {}
}
