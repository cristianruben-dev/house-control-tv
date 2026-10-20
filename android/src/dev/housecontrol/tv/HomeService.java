package dev.housecontrol.tv;

import android.app.Service;
import android.content.*;
import android.content.pm.*;
import android.os.*;
import org.json.*;
import java.security.MessageDigest;

/** Bound by the home-screen launcher (tv-vibehack, or Luma) while it is visible. Keeps TV-owned control alive without the Mac. */
public final class HomeService extends Service {
    static final String ACTIVITY_BIND="dev.housecontrol.tv.ACTIVITY_BIND";
    /** Launchers that may show this home, each also pinned to a signing certificate in Trust.LUMA. */
    static final java.util.List<String> LAUNCHERS=java.util.Arrays.asList("com.gathin.tvhome","dev.luma.tv");
    static HomeEngine sharedEngine;static TvServer sharedServer;
    static synchronized void initialize(Context c)throws Exception{
        if(sharedEngine==null)sharedEngine=new HomeEngine(c);
        if(sharedServer==null){android.content.SharedPreferences p=c.getSharedPreferences("connection",MODE_PRIVATE);String key=p.getString("remoteKey","");if(key.isEmpty()){byte[] bytes=new byte[32];new java.security.SecureRandom().nextBytes(bytes);key=java.util.Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);p.edit().putString("remoteKey",key).apply();}sharedServer=new TvServer(c.getApplicationContext(),sharedEngine,key);}
    }
    static synchronized void replaceServer(Context c,String key)throws Exception{if(sharedServer!=null)sharedServer.close();sharedServer=new TvServer(c.getApplicationContext(),sharedEngine,key);}
    private boolean trusted(int uid){
        if(uid==android.os.Process.myUid())return true;
        try{String[] packages=getPackageManager().getPackagesForUid(uid);if(packages==null)return false;for(String name:packages)if(LAUNCHERS.contains(name)){
            PackageInfo p=getPackageManager().getPackageInfo(name,PackageManager.GET_SIGNING_CERTIFICATES);
            for(Signature signature:p.signingInfo.getApkContentsSigners())if(java.util.Arrays.asList(Trust.LUMA).contains(SharingTransport.hex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray()))))return true;
        }}catch(Exception ignored){}return false;
    }
    /**
     * A look, checked: "dark" or "light" mode, a glass opacity of 0–100 % (at least 40 % in light mode, whose dark
     * text needs it), a bundled wallpaper's file name ("" for the app's own) and when it was chosen. Anything else is
     * dark at 15 %.
     */
    static JSONObject appearance(String raw)throws JSONException{
        JSONObject in;try{in=new JSONObject(raw==null?"{}":raw);}catch(JSONException e){in=new JSONObject();}
        boolean light="light".equals(in.optString("mode"));
        String wallpaper=in.optString("wallpaper","");if(!wallpaper.matches("[a-z0-9_]{1,64}\\.jpg"))wallpaper="";
        return new JSONObject().put("mode",light?"light":"dark").put("opacity",Math.max(light?40:0,Math.min(100,in.optInt("opacity",15)))).put("wallpaper",wallpaper).put("at",Math.max(0L,in.optLong("at",0L)));
    }
    /**
     * Keeps a look from the launcher ({@code fromApp} false) or from this app's own appearance menu (true, stamped
     * now). Whichever was chosen last wins: the launcher sends its look every time it connects, which must not undo
     * a newer choice made in the app.
     */
    static void storeAppearance(Context c,String raw,boolean fromApp)throws JSONException{
        android.content.SharedPreferences p=c.getSharedPreferences("connection",MODE_PRIVATE);
        JSONObject next=appearance(raw);if(fromApp)next.put("at",System.currentTimeMillis());
        if(!fromApp&&next.optLong("at")<appearance(p.getString("appearance","{}")).optLong("at"))return;
        p.edit().putString("appearance",next.toString()).apply();
    }
    @Override public void onCreate(){super.onCreate();try{initialize(this);}catch(Exception ignored){}}
    @Override public IBinder onBind(Intent intent){if(sharedEngine!=null&&!ACTIVITY_BIND.equals(intent.getAction()))sharedEngine.setWidgetActive(true);return new Binder(){
        @Override protected boolean onTransact(int code,Parcel data,Parcel reply,int flags)throws RemoteException{
            if(!trusted(Binder.getCallingUid())){reply.writeException(new SecurityException("Only a paired launcher may access this home."));return true;}
            JSONObject result;
            try{
                if(code==5){storeAppearance(HomeService.this,data.readString(),false);reply.writeNoException();reply.writeString("{\"ok\":true}");return true;}
                if(sharedEngine==null)throw new IllegalStateException("Open House Control to finish TV setup.");
                if(code==1){result=sharedEngine.home();}
                else if(code==2){String id=data.readString();result=sharedEngine.action(new JSONObject().put("kind","scene").put("id",id));}
                else if(code==4){String id=data.readString();result=sharedEngine.demoAction(new JSONObject().put("kind","scene").put("id",id));}
                else if(code==3){sharedEngine.setWidgetActive(data.readInt()!=0);result=new JSONObject().put("ok",true);}
                else return super.onTransact(code,data,reply,flags);
            }catch(Exception error){try{result=new JSONObject().put("error",HomeEngine.safe(error));}catch(Exception ignored){result=new JSONObject();}}
            reply.writeNoException();reply.writeString(result.toString());return true;
        }
    };}
    @Override public boolean onUnbind(Intent intent){if(sharedEngine!=null&&!ACTIVITY_BIND.equals(intent.getAction()))sharedEngine.setWidgetActive(false);return true;}
    @Override public void onRebind(Intent intent){if(sharedEngine!=null&&!ACTIVITY_BIND.equals(intent.getAction()))sharedEngine.setWidgetActive(true);}
    @Override public int onStartCommand(Intent intent,int flags,int startId){return START_NOT_STICKY;}
    @Override public void onDestroy(){if(sharedServer!=null)sharedServer.close();if(sharedEngine!=null)sharedEngine.close();sharedServer=null;sharedEngine=null;super.onDestroy();}
}
