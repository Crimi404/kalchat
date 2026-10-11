# kalchat-correctifs-securite

Copie le dossier `backend/` de ce zip dans le dépôt (il remplace 4 fichiers et en ajoute 1), puis push -> Render redéploie.

Fichiers : backend/uploadGuard.js (nouveau), server.js, storage.js, db.js, mediaCleanup.js
Aucune nouvelle dépendance, aucune variable obligatoire, la table `media_delete_queue` se crée toute seule au démarrage.

Réglages facultatifs (Render > Environment) : UPLOAD_USER_PER_10MIN (60), UPLOAD_GUEST_PER_10MIN (5),
UPLOAD_GUEST_PER_HOUR_GLOBAL (60), UPLOAD_MAX_CONCURRENT (4), MAX_UPLOAD_MB (25)

Après déploiement, tester : 1) inscription avec photo de profil 2) photo + vidéo + vocal dans un message
3) publier un post avec vidéo 4) story photo et vidéo. Dans les logs Render, tu dois voir le démarrage normal, sans erreur.
