package dev.housecontrol.tv;

import org.json.*;
import java.util.*;
import java.io.IOException;

/** Plan-state helpers for the engine: copies, merges and validated patches. */
final class CloudMapper {
    static JSONObject copy(JSONObject j)throws JSONException{return new JSONObject(j.toString());}
    static void merge(JSONObject to,JSONObject from)throws JSONException{if(from==null)return;Iterator<String> keys=from.keys();while(keys.hasNext()){String k=keys.next();to.put(k,from.get(k));}}
    static double clamp(double x,double lo,double hi){return Math.max(lo,Math.min(hi,x));}
    static JSONObject difference(JSONObject patch,JSONObject current)throws Exception{
        JSONObject out=new JSONObject();Iterator<String> keys=patch.keys();while(keys.hasNext()){String key=keys.next();Object desired=patch.get(key),old=current.opt(key);boolean same=desired.equals(old);if(desired instanceof Number&&old instanceof Number)same=Math.abs(((Number)desired).doubleValue()-((Number)old).doubleValue())<.001;if(!same)out.put(key,desired);}return out;
    }
    static JSONObject patch(String section,JSONObject raw,JSONObject device)throws Exception{
        JSONObject out=new JSONObject();
        if(raw.has("on")){if(!(raw.get("on") instanceof Boolean))throw new IllegalArgumentException("Falta un valor de encendido o apagado.");out.put("on",raw.getBoolean("on"));}
        if(section.equals("lights")){
            for(String key:new String[]{"brightness","temp"})if(raw.has(key)){Object v=raw.get(key);if(!(v instanceof Number)||!Double.isFinite(((Number)v).doubleValue()))throw new IllegalArgumentException("Ajuste de luz no válido.");double value=((Number)v).doubleValue();out.put(key,key.equals("brightness")?clamp(value,.05,1):clamp(value,2200,6500));}
            if(raw.has("color")){if(!raw.isNull("color")&&!raw.getString("color").matches("#[a-fA-F0-9]{6}"))throw new IllegalArgumentException("Color de luz no válido.");out.put("color",raw.get("color"));}
        }else{
            if(raw.has("target")){Object v=raw.get("target");if(!(v instanceof Number)||!Double.isFinite(((Number)v).doubleValue()))throw new IllegalArgumentException("Temperatura no válida.");out.put("target",Math.round(clamp(((Number)v).doubleValue(),device.optInt("min",16),device.optInt("max",30))));}
            if(raw.has("mode")){String value=raw.getString("mode");if(!MODES.containsKey(value))throw new IllegalArgumentException("Modo de clima no compatible.");out.put("mode",value);}
            if(raw.has("fan")){String value=raw.getString("fan");if(!FANS.containsKey(value))throw new IllegalArgumentException("Velocidad de ventilador no compatible.");out.put("fan",value);}
        }
        return out;
    }
    static final Map<String,String> MODES=new HashMap<>(),FANS=new HashMap<>();
    static{String[] a={"cool","cold","heat","hot","dry","wet","fan","wind","auto","auto"};for(int i=0;i<a.length;i+=2)MODES.put(a[i],a[i+1]);String[] b={"auto","auto","low","low","medium","mid","high","high","turbo","strong"};for(int i=0;i<b.length;i+=2)FANS.put(b[i],b[i+1]);}
}
