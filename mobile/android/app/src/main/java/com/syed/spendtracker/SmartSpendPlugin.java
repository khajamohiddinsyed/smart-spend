package com.syed.spendtracker;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.net.Uri;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.Arrays;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * The few things the web app can't do inside a WebView:
 *  - read what the native Android app (v1.0 / v1.1) stored, once, so an update keeps everything;
 *  - keep the GitHub token and passphrase sealed with an Android Keystore key;
 *  - save a backup file where the person chooses.
 */
@CapacitorPlugin(name = "SmartSpend")
public class SmartSpendPlugin extends Plugin {

    private static final String KEY_ALIAS = "smartspend_secrets_v1";     // same key the native app used
    private static final String VAULT = "smartspend_vault";
    private static final String DB_NAME = "spend.db";
    private static final String MIGRATED_SUFFIX = ".migrated-v1";
    private static final String[] DATASTORES = { "profiles", "cloud_settings", "spend_settings" };

    /* ------------------------------ vault ------------------------------ */

    @PluginMethod
    public void vaultLoad(PluginCall call) {
        SharedPreferences sp = prefs();
        JSObject items = new JSObject();
        for (Map.Entry<String, ?> e : sp.getAll().entrySet()) {
            String plain = open(String.valueOf(e.getValue()));
            if (plain != null) items.put(e.getKey(), plain);
        }
        JSObject ret = new JSObject();
        ret.put("items", items);
        call.resolve(ret);
    }

    @PluginMethod
    public void vaultSet(PluginCall call) {
        String key = call.getString("key"), value = call.getString("value");
        if (key == null || value == null) { call.reject("key and value are required"); return; }
        try {
            prefs().edit().putString(key, seal(value)).apply();
            call.resolve();
        } catch (Exception e) {
            call.reject("Couldn't seal the value", e);
        }
    }

    @PluginMethod
    public void vaultRemove(PluginCall call) {
        String key = call.getString("key");
        if (key != null) prefs().edit().remove(key).apply();
        call.resolve();
    }

    private SharedPreferences prefs() { return getContext().getSharedPreferences(VAULT, Context.MODE_PRIVATE); }

    private static SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore");
        ks.load(null);
        java.security.Key k = ks.getKey(KEY_ALIAS, null);
        if (k instanceof SecretKey) return (SecretKey) k;
        KeyGenerator gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        gen.init(new KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build());
        return gen.generateKey();
    }

    /** iv(12) + ciphertext+tag, base64 — the native app's SecretBox format. */
    private static String seal(String plain) throws Exception {
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.ENCRYPT_MODE, key());
        byte[] iv = c.getIV(), ct = c.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] all = new byte[iv.length + ct.length];
        System.arraycopy(iv, 0, all, 0, iv.length);
        System.arraycopy(ct, 0, all, iv.length, ct.length);
        return Base64.encodeToString(all, Base64.NO_WRAP);
    }

    /** Null when it can't be opened (e.g. the data was restored onto another phone). */
    private static String open(String sealed) {
        if (sealed == null || sealed.isEmpty()) return null;
        try {
            byte[] all = Base64.decode(sealed, Base64.DEFAULT);
            Cipher c = Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, Arrays.copyOfRange(all, 0, 12)));
            return new String(c.doFinal(Arrays.copyOfRange(all, 12, all.length)), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return null;
        }
    }

    /* --------------------------- legacy data --------------------------- */

    /**
     * Everything the native app stored: { found, profilesJson, records: [..], tombstones: [..],
     * settings: {key: value}, cloud: {profileId: {...config with token/pass opened}} }.
     */
    @PluginMethod
    public void legacyRead(PluginCall call) {
        Context ctx = getContext();
        JSObject ret = new JSObject();
        File db = ctx.getDatabasePath(DB_NAME);
        File dsDir = new File(ctx.getFilesDir(), "datastore");
        boolean anyStore = false;
        for (String n : DATASTORES) anyStore |= new File(dsDir, n + ".preferences_pb").exists();
        ret.put("found", db.exists() || anyStore);
        if (!db.exists() && !anyStore) { call.resolve(ret); return; }

        try {
            JSArray records = new JSArray(), tombstones = new JSArray();
            if (db.exists()) readDatabase(db, records, tombstones);
            ret.put("records", records);
            ret.put("tombstones", tombstones);

            Map<String, Object> profiles = readPreferences(new File(dsDir, "profiles.preferences_pb"));
            Object pj = profiles.get("profiles_v1");
            if (pj instanceof String) ret.put("profilesJson", pj);

            JSObject settings = new JSObject();
            for (Map.Entry<String, Object> e : readPreferences(new File(dsDir, "spend_settings.preferences_pb")).entrySet()) {
                settings.put(e.getKey(), e.getValue());
            }
            ret.put("settings", settings);

            JSObject cloud = new JSObject();
            for (Map.Entry<String, Object> e : readPreferences(new File(dsDir, "cloud_settings.preferences_pb")).entrySet()) {
                if (!e.getKey().startsWith("cloud_") || !(e.getValue() instanceof String)) continue;
                try {
                    JSONObject cfg = new JSONObject((String) e.getValue());
                    String token = open(cfg.optString("tokenSealed", null));
                    String pass = cfg.isNull("passSealed") ? null : open(cfg.optString("passSealed", null));
                    cfg.remove("tokenSealed");
                    cfg.remove("passSealed");
                    if (token == null) continue;                                   // can't be used any more
                    cfg.put("token", token);
                    if (pass != null) cfg.put("pass", pass);
                    cloud.put(e.getKey().substring("cloud_".length()), cfg);
                } catch (Exception ignored) { /* skip a damaged entry */ }
            }
            ret.put("cloud", cloud);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Couldn't read the previous app's data: " + e.getMessage(), e);
        }
    }

    /** Moves the old files aside (not deleted) once the web app has saved everything. */
    @PluginMethod
    public void legacyDone(PluginCall call) {
        Context ctx = getContext();
        File db = ctx.getDatabasePath(DB_NAME);
        for (String suffix : new String[] { "", "-wal", "-shm", "-journal" }) {
            File f = new File(db.getPath() + suffix);
            if (f.exists()) f.renameTo(new File(f.getPath() + MIGRATED_SUFFIX));
        }
        File dsDir = new File(ctx.getFilesDir(), "datastore");
        for (String n : DATASTORES) {
            File f = new File(dsDir, n + ".preferences_pb");
            if (f.exists()) f.renameTo(new File(f.getPath() + MIGRATED_SUFFIX));
        }
        call.resolve();
    }

    private static boolean hasColumn(SQLiteDatabase d, String table, String col) {
        try (Cursor c = d.rawQuery("PRAGMA table_info(" + table + ")", null)) {
            while (c.moveToNext()) if (col.equals(c.getString(c.getColumnIndexOrThrow("name")))) return true;
        }
        return false;
    }

    private static boolean hasTable(SQLiteDatabase d, String table) {
        try (Cursor c = d.rawQuery("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", new String[] { table })) {
            return c.moveToFirst();
        }
    }

    private static void readDatabase(File file, JSArray records, JSArray tombstones) {
        long now = System.currentTimeMillis();
        try (SQLiteDatabase d = SQLiteDatabase.openDatabase(file.getPath(), null, SQLiteDatabase.OPEN_READWRITE)) {
            if (!hasTable(d, "transactions")) return;
            boolean v2 = hasColumn(d, "transactions", "uid");
            String sql = "SELECT title, amount, type, category, date_epoch_day" +
                (v2 ? ", profile_id, uid, created_at, updated_at" : "") + " FROM transactions";
            try (Cursor c = d.rawQuery(sql, null)) {
                while (c.moveToNext()) {
                    JSObject r = new JSObject();
                    r.put("title", c.getString(0));
                    r.put("amount", c.getDouble(1));
                    r.put("type", "income".equals(c.getString(2)) ? "in" : "out");
                    r.put("category", c.getString(3));
                    r.put("day", c.getLong(4));
                    String pid = v2 ? c.getString(5) : "";
                    String uid = v2 ? c.getString(6) : "";
                    long created = v2 ? c.getLong(7) : 0, updated = v2 ? c.getLong(8) : 0;
                    r.put("profileId", pid == null || pid.isEmpty() ? "main" : pid);
                    r.put("id", uid == null || uid.isEmpty() ? UUID.randomUUID().toString() : uid);
                    r.put("createdAt", created > 0 ? created : now);
                    r.put("updatedAt", updated > 0 ? updated : (created > 0 ? created : now));
                    records.put(r);
                }
            }
            if (hasTable(d, "tombstones")) {
                try (Cursor c = d.rawQuery("SELECT profile_id, uid, deleted_at FROM tombstones", null)) {
                    while (c.moveToNext()) {
                        JSObject t = new JSObject();
                        t.put("profileId", c.getString(0));
                        t.put("id", c.getString(1));
                        t.put("deletedAt", c.getLong(2));
                        tombstones.put(t);
                    }
                }
            }
        }
    }

    /* ------------- Jetpack DataStore .preferences_pb (protobuf) ------------- */

    private static Map<String, Object> readPreferences(File f) {
        Map<String, Object> out = new HashMap<>();
        if (!f.exists()) return out;
        try (InputStream in = new FileInputStream(f)) {
            Pb pb = new Pb(readAll(in));
            while (pb.more()) {
                int tag = pb.varintInt();
                if ((tag >>> 3) == 1 && (tag & 7) == 2) {
                    Pb entry = pb.sub();
                    String key = null; Object value = null;
                    while (entry.more()) {
                        int t = entry.varintInt();
                        if ((t >>> 3) == 1 && (t & 7) == 2) key = new String(entry.bytes(), StandardCharsets.UTF_8);
                        else if ((t >>> 3) == 2 && (t & 7) == 2) value = readValue(entry.sub());
                        else entry.skip(t & 7);
                    }
                    if (key != null && value != null) out.put(key, value);
                } else pb.skip(tag & 7);
            }
        } catch (Exception ignored) { /* unreadable: treat as empty */ }
        return out;
    }

    private static Object readValue(Pb v) {
        Object value = null;
        while (v.more()) {
            int t = v.varintInt(), field = t >>> 3, wire = t & 7;
            if (field == 1 && wire == 0) value = v.varint() != 0;
            else if (field == 2 && wire == 5) value = (double) Float.intBitsToFloat(v.fixed32());
            else if (field == 3 && wire == 0) value = (long) (int) v.varint();
            else if (field == 4 && wire == 0) value = v.varint();
            else if (field == 5 && wire == 2) value = new String(v.bytes(), StandardCharsets.UTF_8);
            else if (field == 7 && wire == 1) value = Double.longBitsToDouble(v.fixed64());
            else v.skip(wire);
        }
        return value;
    }

    private static byte[] readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream bo = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        return bo.toByteArray();
    }

    /** Just enough protobuf to read a PreferenceMap. */
    private static final class Pb {
        private final byte[] b; private int p; private final int end;
        Pb(byte[] b) { this(b, 0, b.length); }
        Pb(byte[] b, int start, int end) { this.b = b; this.p = start; this.end = end; }
        boolean more() { return p < end; }
        long varint() {
            long r = 0; int s = 0;
            while (p < end) { int x = b[p++] & 0xff; r |= (long) (x & 0x7f) << s; if ((x & 0x80) == 0) return r; s += 7; }
            throw new IllegalStateException("truncated");
        }
        int varintInt() { return (int) varint(); }
        int fixed32() { int r = 0; for (int i = 0; i < 4; i++) r |= (b[p++] & 0xff) << (8 * i); return r; }
        long fixed64() { long r = 0; for (int i = 0; i < 8; i++) r |= (long) (b[p++] & 0xff) << (8 * i); return r; }
        byte[] bytes() { int n = varintInt(); byte[] r = Arrays.copyOfRange(b, p, p + n); p += n; return r; }
        Pb sub() { int n = varintInt(); Pb s = new Pb(b, p, p + n); p += n; return s; }
        void skip(int wire) {
            if (wire == 0) varint();
            else if (wire == 1) p += 8;
            else if (wire == 2) p += varintInt();
            else if (wire == 5) p += 4;
            else throw new IllegalStateException("wire " + wire);
        }
    }

    /* ---------------------------- save a file ---------------------------- */

    /** Asks where to save, then writes `text` there. Resolves { saved: bool }. */
    @PluginMethod
    public void saveFile(PluginCall call) {
        String name = call.getString("filename", "smart-spend-backup.json");
        if (call.getString("text") == null) { call.reject("text is required"); return; }
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(call.getString("mime", "application/json"));
        i.putExtra(Intent.EXTRA_TITLE, name);
        startActivityForResult(call, i, "onSaveTarget");
    }

    @ActivityCallback
    private void onSaveTarget(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        Uri uri = result.getData() != null ? result.getData().getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) { ret.put("saved", false); call.resolve(ret); return; }
        try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null) throw new java.io.IOException("no stream");
            out.write(call.getString("text", "").getBytes(StandardCharsets.UTF_8));
            ret.put("saved", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Couldn't write the file", e);
        }
    }
}
