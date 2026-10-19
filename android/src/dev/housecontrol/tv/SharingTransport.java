package dev.housecontrol.tv;

import java.nio.charset.StandardCharsets;
import java.util.*;

/** Text and hash helpers shared by the TV server, the Hue certificate pin and the Luma trust check. */
public final class SharingTransport {
    static final java.nio.charset.Charset UTF8 = StandardCharsets.UTF_8;
    public static String hex(byte[] bytes) { StringBuilder s=new StringBuilder();for(byte b:bytes)s.append(String.format(Locale.ROOT,"%02x",b&255));return s.toString(); }
}
