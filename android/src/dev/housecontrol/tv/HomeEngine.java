package dev.housecontrol.tv;

import android.content.Context;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

/** Durable TV-owned plan/state and direct device commands (Home Assistant, Hue). Mac is not in the runtime path. */
final class HomeEngine {
    final Context context;
    final Object lock=new Object(),actionLock=new Object();
    final HomeAssistantClient ha;
    final HueClient hue;
    JSONObject plan,state;
    String revision="",syncFingerprint="";
    long lastPoll=0;
    volatile boolean polling=false;
    private boolean activityActive=false,widgetActive=false;
    // Home Assistant and Hue answer on the LAN in milliseconds: their reads run on their own short cycle.
    final ScheduledExecutorService localScheduler=Executors.newSingleThreadScheduledExecutor();
    final java.util.concurrent.atomic.AtomicBoolean localPending=new java.util.concurrent.atomic.AtomicBoolean();
    /** When each plan device last received a command: an older read must not undo it. */
    final Map<String,Long> touched=new ConcurrentHashMap<>();
    HomeEngine(Context c)throws Exception{
        context=c.getApplicationContext();
        ha=new HomeAssistantClient(new SecureVault(context,"homeassistant.enc"));hue=new HueClient(new SecureVault(context,"hue.enc"));
        ha.onChange=this::localChanged;hue.onChange=this::localChanged;ha.active=()->polling;hue.active=()->polling;
        JSONObject saved=read("home.json");if(saved!=null){plan=saved.getJSONObject("plan");state=saved.getJSONObject("state");revision=saved.optString("revision");syncFingerprint=saved.optString("syncFingerprint");}
        watchLinks();
        localScheduler.scheduleWithFixedDelay(()->{if(polling&&(ha.connected()||hue.connected()))try{pollLocal();}catch(Exception ignored){}},2,5,TimeUnit.SECONDS);
    }
    static String safe(Exception e){return e.getMessage()==null?"Device request failed.":e.getMessage();}
    synchronized void setActive(boolean on){activityActive=on;polling=activityActive||widgetActive;}
    synchronized void setWidgetActive(boolean on){widgetActive=on;polling=activityActive||widgetActive;}
    JSONObject read(String name)throws Exception{AtomicFile f=new AtomicFile(new File(context.getFilesDir(),name));return f.getBaseFile().exists()?new JSONObject(new String(f.readFully(),SharingTransport.UTF8)):null;}
    void write(String name,JSONObject value)throws Exception{AtomicFile f=new AtomicFile(new File(context.getFilesDir(),name));FileOutputStream out=null;try{out=f.startWrite();out.write(value.toString().getBytes(SharingTransport.UTF8));f.finishWrite(out);}catch(Exception e){f.failWrite(out);throw e;}}
    void save()throws Exception{write("home.json",new JSONObject().put("plan",plan).put("state",state).put("revision",revision).put("syncFingerprint",syncFingerprint));}
    static void validatePlan(JSONObject p)throws Exception{
        JSONArray rooms=p.getJSONArray("rooms");if(rooms.length()<1||rooms.length()>100)throw new IOException("A home needs 1–100 rooms.");Set<String> ids=new HashSet<>(),roomIds=new HashSet<>();
        for(int i=0;i<rooms.length();i++){JSONObject r=rooms.getJSONObject(i);String id=r.getString("id");JSONArray rect=r.getJSONArray("rect");if(id.isEmpty()||!ids.add(id)||rect.length()!=4)throw new IOException("Invalid room id or rectangle.");roomIds.add(id);for(int n=0;n<4;n++)if(!Double.isFinite(rect.getDouble(n))||Math.abs(rect.getDouble(n))>500)throw new IOException("Invalid room dimensions.");if(rect.getDouble(2)<=0||rect.getDouble(3)<=0)throw new IOException("Room size must be positive.");}
        for(String section:new String[]{"lights","acs"}){JSONArray a=p.optJSONArray(section);if(a==null)continue;if(a.length()>200)throw new IOException("Too many devices.");for(int i=0;i<a.length();i++){JSONObject d=a.getJSONObject(i);if(!ids.add(d.getString("id"))||!roomIds.contains(d.getString("room")))throw new IOException("Duplicate device id or unknown room.");JSONArray pos=d.getJSONArray("pos");if(pos.length()!=2||!Double.isFinite(pos.getDouble(0))||!Double.isFinite(pos.getDouble(1)))throw new IOException("Invalid device position.");}}
    }
    void importHome(JSONObject data)throws Exception{
        JSONObject p=data.has("plan")?data.getJSONObject("plan"):data;validatePlan(p);JSONObject incoming=data.optJSONObject("state"),next=new JSONObject().put("lights",new JSONObject()).put("acs",new JSONObject());
        synchronized(actionLock){synchronized(lock){
            String fingerprint=data.optString("syncFingerprint");boolean settingsOnly=data.optBoolean("settingsOnly");
            if(settingsOnly&&!fingerprint.matches("[a-f0-9]{64}"))throw new IOException("Invalid settings fingerprint.");
            if(settingsOnly&&plan!=null&&fingerprint.equals(syncFingerprint))return;
            if(settingsOnly)incoming=null;
            for(String section:new String[]{"lights","acs"}){JSONArray devices=p.optJSONArray(section);if(devices==null)continue;for(int i=0;i<devices.length();i++){JSONObject d=devices.getJSONObject(i);String id=d.getString("id");JSONObject value=new JSONObject();
                if(section.equals("lights"))value.put("on",false).put("brightness",.8).put("temp",3000).put("color",JSONObject.NULL);else value.put("on",false).put("target",24).put("mode","cool").put("fan","auto");
                if(state!=null&&state.optJSONObject(section)!=null)CloudMapper.merge(value,state.getJSONObject(section).optJSONObject(id));
                if(incoming!=null&&incoming.optJSONObject(section)!=null)CloudMapper.merge(value,incoming.getJSONObject(section).optJSONObject(id));next.getJSONObject(section).put(id,value);
            }}
            Object selected=settingsOnly&&state!=null?state.opt("scene"):incoming==null?JSONObject.NULL:incoming.opt("scene");
            if(selected instanceof String){boolean exists=false;JSONArray scenes=p.optJSONArray("scenes");if(scenes!=null)for(int i=0;i<scenes.length();i++)if(scenes.getJSONObject(i).optString("id").equals(selected))exists=true;if(!exists)selected=JSONObject.NULL;}
            next.put("scene",selected);plan=CloudMapper.copy(p);state=next;revision=UUID.randomUUID().toString();syncFingerprint=settingsOnly?fingerprint:"";save();
        }}
        watchLinks();localChanged();
    }
    JSONObject home()throws Exception{
        synchronized(lock){if(plan==null)throw new IOException("Import your home from Mac once, or upload a floor plan from your phone.");
            JSONObject safePlan=CloudMapper.copy(plan);Set<String> needed=new TreeSet<>();
            for(String section:new String[]{"lights","acs"}){JSONArray a=safePlan.optJSONArray(section);if(a==null)continue;for(int i=0;i<a.length();i++){JSONObject d=a.getJSONObject(i);String via=via(d);boolean real=!via.isEmpty();if(real){d.put("via",via);if(!via.equals("homekit"))needed.add(via);}d.put("linked",real);d.remove("link");d.remove("sensor");}}
            List<String> on=new ArrayList<>(),off=new ArrayList<>();for(String s:needed)(serviceReady(s)?on:off).add(title(s));
            boolean ready=needed.isEmpty()||!on.isEmpty();String label=off.isEmpty()?(on.isEmpty()?"TV · no devices linked":"TV · "+String.join(", ",on)+" connected"):on.isEmpty()?"Connect "+String.join(", ",off)+" on TV":"TV · "+String.join(", ",on)+" · connect "+String.join(", ",off);
            JSONObject errors=new JSONObject().put("homeassistant",ha.lastError).put("hue",hue.lastError),services=new JSONObject().put("homeassistant",ha.connected()).put("hue",hue.connected());
            return new JSONObject().put("version",2).put("mode","standalone").put("plan",safePlan).put("state",CloudMapper.copy(state)).put("revision",revision).put("syncFingerprint",syncFingerprint).put("macOnline",ready).put("controlReady",ready).put("connections",services).put("connectionErrors",errors).put("connectionLabel",label).put("lastPoll",lastPoll).put("cloudError",ha.lastError.isEmpty()?hue.lastError:ha.lastError).put("source","This TV");
        }
    }
    /** Which platform switches this plan device, from its `link`. */
    static String via(JSONObject d){JSONObject l=d.optJSONObject("link");if(l!=null&&!l.optString("id").isEmpty())return l.optString("service");return "";}
    boolean serviceReady(String s){return s.equals(LocalMapper.HA)?ha.connected():s.equals(LocalMapper.HUE)&&hue.connected();}
    static String title(String s){return s.equals(LocalMapper.HA)?"Home Assistant":s.equals(LocalMapper.HUE)?"Hue":s.equals("homekit")?"Apple Home":s;}
    JSONObject find(String section,String id)throws Exception{JSONArray a=plan.optJSONArray(section);if(a!=null)for(int i=0;i<a.length();i++)if(a.getJSONObject(i).getString("id").equals(id))return a.getJSONObject(i);throw new IOException("Device or scene no longer exists.");}
    void commit(String section,String id,JSONObject patch)throws Exception{synchronized(lock){CloudMapper.merge(state.getJSONObject(section).getJSONObject(id),patch);state.put("scene",JSONObject.NULL);save();}}
    void change(String section,String id,JSONObject patch)throws Exception{
        JSONObject d,current,desired; synchronized(lock){d=CloudMapper.copy(find(section,id));current=CloudMapper.copy(state.getJSONObject(section).getJSONObject(id));}
        patch=CloudMapper.patch(section,patch,d);if(patch.length()==0)return;
        desired=CloudMapper.copy(current);CloudMapper.merge(desired,patch);
        JSONObject service=d.optJSONObject("link");if(service!=null&&!service.optString("id").isEmpty()){local(section,id,service,patch,desired);return;}
        commit(section,id,patch);
    }
    void local(String section,String id,JSONObject link,JSONObject patch,JSONObject desired)throws Exception{
        String service=link.optString("service"),target=link.optString("id");
        if(service.equals(LocalMapper.HUE)){if(!section.equals("lights"))throw new IOException("Hue has no air conditioners.");if(!hue.connected())throw new IOException("Pair the Hue Bridge on this TV first: Sync & connect → Home Assistant & Hue.");hue.send(target,LocalMapper.withPower(patch,desired));}
        else if(service.equals(LocalMapper.HA)){if(!ha.connected())throw new IOException("Connect Home Assistant on this TV first: Sync & connect → Home Assistant & Hue.");ha.send(target,section.equals("lights")?LocalMapper.withPower(patch,desired):patch,desired);}
        else if(service.equals("homekit"))throw new IOException("Apple Home devices can only be switched from an iPhone or iPad: HomeKit is Apple-only. Add the device to Home Assistant to control it from the TV.");
        else throw new IOException("This device uses a connection the TV does not know.");
        touched.put(id,System.currentTimeMillis());commit(section,id,patch);
    }
    JSONObject action(JSONObject action)throws Exception{
        synchronized(actionLock){String kind=action.getString("kind"),id=action.optString("id");
            if(kind.equals("light")||kind.equals("acPower")){Object value=action.get("on");if(!(value instanceof Boolean))throw new IOException("Expected an explicit on/off value.");change(kind.equals("light")?"lights":"acs",id,new JSONObject().put("on",value));}
            else if(kind.equals("lightSet")){JSONObject patch=new JSONObject();for(String key:new String[]{"on","brightness","temp","color"})if(action.has(key))patch.put(key,action.get(key));if(patch.length()==0)throw new IOException("Nothing to change.");change("lights",id,patch);}
            else if(kind.equals("acTarget")){JSONObject d; synchronized(lock){d=find("acs",id);}Object value=action.get("target");if(!(value instanceof Number))throw new IOException("Invalid temperature.");double target=((Number)value).doubleValue();if(!Double.isFinite(target)||target<d.optInt("min",16)||target>d.optInt("max",30))throw new IOException("Temperature is outside this unit’s range.");change("acs",id,new JSONObject().put("target",Math.round(target)));}
            else if(kind.equals("scene")&&isActiveScene(id))sceneOff(id);
            else if(kind.equals("scene")||kind.equals("allLights")||kind.equals("room")){
                if(kind.equals("scene")&&(ha.connected()||hue.connected()))pollLocal();
                JSONObject scene=null; synchronized(lock){if(kind.equals("scene"))scene=CloudMapper.copy(find("scenes",id));else if(kind.equals("room"))find("rooms",id);}
                List<String> errors=new ArrayList<>();for(String section:new String[]{"lights","acs"}){JSONArray devices; synchronized(lock){devices=new JSONArray(plan.optJSONArray(section)==null?"[]":plan.getJSONArray(section).toString());}
                    for(int i=0;i<devices.length();i++){JSONObject d=devices.getJSONObject(i),patch=new JSONObject();String deviceId=d.getString("id");
                        if(scene!=null){JSONObject patches=scene.optJSONObject(section);if(patches!=null){CloudMapper.merge(patch,patches.optJSONObject("*"));CloudMapper.merge(patch,patches.optJSONObject(deviceId));}}
                        else if(section.equals("lights")&&(!kind.equals("room")||d.getString("room").equals(id))){if(!(action.opt("on") instanceof Boolean))throw new IOException("Expected on/off value.");patch.put("on",action.getBoolean("on"));}
                        if(patch.length()==0)continue;try{if(scene!=null&&section.equals("lights"))synchronized(lock){patch=CloudMapper.difference(CloudMapper.patch(section,patch,d),state.getJSONObject(section).getJSONObject(deviceId));}if(patch.length()>0)change(section,deviceId,patch);}catch(Exception e){errors.add(d.optString("name",deviceId)+": "+safe(e));}
                    }}
                if(!errors.isEmpty())throw new IOException(String.join("; ",errors));if(scene!=null)synchronized(lock){state.put("scene",id);save();}
            }else throw new IOException("Unsupported TV action.");
            return new JSONObject().put("ok",true).put("direct",true).put("home",home());
        }
    }
    /** Tells Home Assistant and Hue which of their devices the plan uses, for their live updates. */
    void watchLinks(){
        Set<String> haIds=new HashSet<>(),hueIds=new HashSet<>();JSONObject p;synchronized(lock){p=plan;}if(p!=null)for(String section:new String[]{"lights","acs"}){JSONArray a=p.optJSONArray(section);if(a==null)continue;for(int i=0;i<a.length();i++){JSONObject d=a.optJSONObject(i);if(d==null)continue;
            for(JSONObject l:new JSONObject[]{d.optJSONObject("link"),section.equals("acs")?d.optJSONObject("sensor"):null}){if(l==null||l.optString("id").isEmpty())continue;if(l.optString("service").equals(LocalMapper.HA))haIds.add(l.optString("id"));if(l.optString("service").equals(LocalMapper.HUE))hueIds.add(l.optString("id"));}}}
        ha.watch(haIds);hue.watch(hueIds);
    }
    /** A burst of events (a scene switching six lamps) becomes one read. */
    void localChanged(){if(localPending.compareAndSet(false,true))localScheduler.schedule(()->{localPending.set(false);try{pollLocal();}catch(Exception ignored){}},300,TimeUnit.MILLISECONDS);}
    boolean isActiveScene(String id){synchronized(lock){Object s=state==null?null:state.opt("scene");return s instanceof String&&s.equals(id);}}
    /** Running the active scene again switches it off: the lights it turns on go off, and no scene is active. */
    void sceneOff(String id)throws Exception{
        JSONObject scene;JSONArray devices;synchronized(lock){scene=CloudMapper.copy(find("scenes",id));devices=new JSONArray(plan.optJSONArray("lights")==null?"[]":plan.getJSONArray("lights").toString());}
        JSONObject patches=scene.optJSONObject("lights");List<String> errors=new ArrayList<>();
        if(patches!=null)for(int i=0;i<devices.length();i++){JSONObject d=devices.getJSONObject(i),patch=new JSONObject();String deviceId=d.getString("id");
            CloudMapper.merge(patch,patches.optJSONObject("*"));CloudMapper.merge(patch,patches.optJSONObject(deviceId));
            boolean lit;synchronized(lock){lit=state.getJSONObject("lights").getJSONObject(deviceId).optBoolean("on");}
            if(patch.optBoolean("on")&&lit)try{change("lights",deviceId,new JSONObject().put("on",false));}catch(Exception e){errors.add(d.optString("name",deviceId)+": "+safe(e));}
        }
        synchronized(lock){state.put("scene",JSONObject.NULL);save();}
        if(!errors.isEmpty())throw new IOException(String.join("; ",errors));
    }
    void pollLocal()throws Exception{
        JSONObject p;synchronized(lock){if(plan==null)return;p=CloudMapper.copy(plan);}
        Set<String> haIds=new HashSet<>(),hueLights=new HashSet<>(),hueSensors=new HashSet<>();
        for(String section:new String[]{"lights","acs"}){JSONArray a=p.optJSONArray(section);if(a==null)continue;for(int i=0;i<a.length();i++){JSONObject d=a.getJSONObject(i),l=d.optJSONObject("link"),s=section.equals("acs")?d.optJSONObject("sensor"):null;
            if(l!=null&&!l.optString("id").isEmpty()){if(l.optString("service").equals(LocalMapper.HA))haIds.add(l.getString("id"));else if(l.optString("service").equals(LocalMapper.HUE)&&section.equals("lights"))hueLights.add(l.getString("id"));}
            if(s!=null&&!s.optString("id").isEmpty()){if(s.optString("service").equals(LocalMapper.HA))haIds.add(s.getString("id"));else if(s.optString("service").equals(LocalMapper.HUE))hueSensors.add(s.getString("id"));}}}
        if(haIds.isEmpty()&&hueLights.isEmpty()&&hueSensors.isEmpty())return;
        long started=System.currentTimeMillis();Map<String,JSONObject> fromHa=Collections.emptyMap(),fromHue=Collections.emptyMap();
        if(ha.connected()&&!haIds.isEmpty())try{fromHa=ha.read(haIds);ha.lastError="";}catch(Exception e){ha.lastError=safe(e);}
        if(hue.connected()&&!(hueLights.isEmpty()&&hueSensors.isEmpty()))try{fromHue=hue.read(hueLights,hueSensors);hue.lastError="";}catch(Exception e){hue.lastError=safe(e);}
        synchronized(lock){if(plan==null)return;String before=state.toString();
            for(String section:new String[]{"lights","acs"}){JSONArray a=p.optJSONArray(section);if(a==null)continue;for(int i=0;i<a.length();i++){JSONObject d=a.getJSONObject(i);String id=d.getString("id");JSONObject target=state.getJSONObject(section).optJSONObject(id);
                if(target==null||touched.getOrDefault(id,0L)>=started)continue;
                JSONObject l=d.optJSONObject("link"),s=section.equals("acs")?d.optJSONObject("sensor"):null;
                if(l!=null&&!l.optString("id").isEmpty()){Map<String,JSONObject> from=l.optString("service").equals(LocalMapper.HA)?fromHa:l.optString("service").equals(LocalMapper.HUE)?fromHue:Collections.emptyMap();JSONObject r=from.get(l.getString("id"));
                    if(r!=null&&r.optBoolean("online",true))CloudMapper.merge(target,r.optJSONObject(section.equals("lights")?"light":"ac"));}
                if(s!=null){Map<String,JSONObject> from=s.optString("service").equals(LocalMapper.HA)?fromHa:s.optString("service").equals(LocalMapper.HUE)?fromHue:Collections.emptyMap();JSONObject r=from.get(s.optString("id"));if(r!=null&&r.has("temperature"))target.put("roomTemp",Math.round(r.getDouble("temperature")*10)/10.);}
            }}
            lastPoll=System.currentTimeMillis();if(!before.equals(state.toString()))save();
        }
    }
    JSONObject connections()throws Exception{return new JSONObject().put("homeassistant",ha.info()).put("hue",hue.info()).put("macFingerprint",context.getSharedPreferences("connections",0).getString("macFingerprint",""));}
    /** The paired Mac's Home Assistant and Hue connections (sync_mac.py). A connection set up on the TV itself is kept. */
    JSONObject adopt(JSONObject body)throws Exception{
        String fingerprint=body.optString("fingerprint");if(!fingerprint.matches("[a-f0-9]{64}"))throw new IOException("Invalid connections fingerprint.");
        if(body.has(LocalMapper.HA))ha.adopt(body.optJSONObject(LocalMapper.HA));if(body.has(LocalMapper.HUE))hue.adopt(body.optJSONObject(LocalMapper.HUE));
        context.getSharedPreferences("connections",0).edit().putString("macFingerprint",fingerprint).commit();watchLinks();localChanged();return connections();
    }
    JSONObject handle(String path,JSONObject body)throws Exception{
        switch(path){
            case "/api/connections":return connections();
            case "/api/connections/discover":return LanDiscovery.find(context);
            case "/api/connections/adopt":return adopt(body);
            case "/api/homeassistant/connect":ha.connect(body.optString("url"),body.optString("token"));watchLinks();localChanged();return connections();
            case "/api/homeassistant/disconnect":ha.disconnect();return connections();
            case "/api/hue/pair":try{hue.pair(body.optString("host"),body.optString("bridgeId"),body.optString("name"));}catch(HueClient.ButtonNotPressed e){return connections().put("buttonRequired",true);}watchLinks();localChanged();return connections();
            case "/api/hue/disconnect":hue.disconnect();return connections();case "/api/home":return home().put("appVersion",version());case "/api/action":return action(body);case "/api/import":importHome(body);return new JSONObject().put("ok",true).put("home",home());default:throw new IOException("Unknown request.");}
    }
    String version(){try{return context.getPackageManager().getPackageInfo(context.getPackageName(),0).versionName;}catch(Exception e){return "";}}
    void close(){localScheduler.shutdownNow();}
}
