package com.kalchat.app;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;

/**
 * Kalchat dans le menu « Partager » d'Android.
 * Reçoit un texte, un lien, une photo ou une vidéo d'une autre appli et envoie l'événement « shareReceived »
 * à la page : { title, texts: [..], files: [{ uri, name, mimeType }] }.
 * Les fichiers sont copiés dans le cache de l'appli (uri = file://...) pour que la page puisse les lire.
 */
@CapacitorPlugin(name = "CapacitorShareTarget")
public class ShareTargetPlugin extends Plugin {

    @Override
    public void load() {
        if (getActivity() != null) {
            handle(getActivity().getIntent());
        }
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        handle(intent);
    }

    /**
     * Ouvre une adresse dans le navigateur par défaut d'Android (Chrome…), jamais dans Kalchat lui-même,
     * même si l'adresse est un lien kalchat.site. Sert à télécharger la mise à jour de l'APK.
     */
    @PluginMethod
    public void openExternal(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.length() == 0) {
            call.reject("Adresse manquante");
            return;
        }
        try {
            Intent go = Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_BROWSER);
            go.setData(Uri.parse(url));
            go.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(go);
            call.resolve();
        } catch (Exception e) {
            call.reject("Impossible d'ouvrir le navigateur");
        }
    }

    private void handle(final Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_SEND.equals(action) && !Intent.ACTION_SEND_MULTIPLE.equals(action)) return;

        final String type = intent.getType();
        final CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        final CharSequence subject = intent.getCharSequenceExtra(Intent.EXTRA_SUBJECT);
        final ArrayList<Uri> uris = new ArrayList<Uri>();
        if (Intent.ACTION_SEND.equals(action)) {
            Uri one = (Uri) intent.getParcelableExtra(Intent.EXTRA_STREAM);
            if (one != null) uris.add(one);
        } else {
            ArrayList<Uri> many = intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (many != null) uris.addAll(many);
        }

        // Ne pas traiter deux fois le même partage (rotation, retour dans l'appli…)
        intent.setAction(Intent.ACTION_MAIN);

        // La copie des fichiers (vidéos) se fait hors du fil principal
        new Thread(new Runnable() {
            @Override
            public void run() {
                JSObject data = new JSObject();
                data.put("title", subject == null ? "" : subject.toString());
                JSArray texts = new JSArray();
                if (text != null && text.toString().trim().length() > 0) texts.put(text.toString());
                data.put("texts", texts);
                JSArray files = new JSArray();
                for (Uri uri : uris) {
                    JSObject f = copyToCache(uri, type);
                    if (f != null) files.put(f);
                }
                data.put("files", files);
                // true : l'événement est gardé si la page n'a pas encore branché son écouteur (ouverture à froid)
                notifyListeners("shareReceived", data, true);
            }
        }).start();
    }

    private JSObject copyToCache(Uri uri, String intentType) {
        try {
            ContentResolver cr = getContext().getContentResolver();
            String mime = cr.getType(uri);
            if (mime == null || mime.length() == 0) mime = intentType;
            if (mime == null || mime.endsWith("/*")) mime = "";
            String name = displayName(cr, uri);

            File dir = new File(getContext().getCacheDir(), "shared");
            dir.mkdirs();
            String safe = name.replaceAll("[^A-Za-z0-9._-]", "_");
            File out = new File(dir, System.currentTimeMillis() + "_" + safe);

            InputStream in = cr.openInputStream(uri);
            if (in == null) return null;
            OutputStream os = new FileOutputStream(out);
            try {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            } finally {
                os.close();
                in.close();
            }

            JSObject o = new JSObject();
            o.put("uri", "file://" + out.getAbsolutePath());
            o.put("name", name);
            o.put("mimeType", mime);
            return o;
        } catch (Exception e) {
            return null;
        }
    }

    private String displayName(ContentResolver cr, Uri uri) {
        String name = null;
        Cursor c = null;
        try {
            c = cr.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null);
            if (c != null && c.moveToFirst()) name = c.getString(0);
        } catch (Exception ignored) {
            name = null;
        } finally {
            if (c != null) c.close();
        }
        if (name == null || name.length() == 0) name = "partage-" + System.currentTimeMillis();
        return name;
    }
}
