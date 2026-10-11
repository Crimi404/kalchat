# K-Short — phase 2 (serveur + site)

## Contenu
backend/r2.js, backend/shorts.js            -> NOUVEAUX (stockage R2, base, routes, expiration)
frontend/src/lib/shorts.ts                   -> NOUVEAU
frontend/src/components/ShortsFeed.tsx       -> NOUVEAU (lecteur vertical, commentaires)
frontend/src/components/ShortUploadSheet.tsx -> NOUVEAU (publication, durée 1 à 60 jours)
frontend/src/components/ShortFeedCard.tsx    -> NOUVEAU (vidéo dans le fil "Pour vous")
frontend/src/routes/index.tsx                -> REMPLACE l'accueil (onglet K-Short après Abonnements)

## server.js : 2 lignes à ajouter (aucune autre modification)
1) Sous la ligne   const { startEmailPrompts } = require('./emailPrompt');
   ajoute          const { setupShorts } = require('./shorts');
2) Sous la ligne   .then(() => startEmailPrompts(io))
   ajoute          .then(() => setupShorts(app).catch((err) => console.error('K-Short : initialisation impossible :', err.message)))

(Option : OPTION-server-complet/server.js a déjà ces 2 lignes ET les correctifs de sécurité de l'upload.
 À n'utiliser que si tu n'as pas modifié server.js depuis ce matin.)

## Activer K-Short (dans cet ordre)
1. Déploie le code D'ABORD, sans rien configurer : K-Short reste invisible et Kalchat fonctionne exactement comme avant.
2. Cloudflare > R2 > crée un bucket "kalchat-shorts" (PRIVÉ : n'active ni l'accès public ni r2.dev).
3. R2 > Manage API tokens > jeton "Object Read & Write" limité à ce bucket. Note : Account ID, Access Key ID, Secret Access Key.
4. Bucket > Settings > CORS policy :
   [{"AllowedOrigins":["https://kalchat.site"],"AllowedMethods":["GET","PUT","HEAD"],"AllowedHeaders":["Content-Type"],"ExposeHeaders":["ETag"],"MaxAgeSeconds":3600}]
5. Bucket > Settings > Object lifecycle rules : supprimer les objets 62 jours après l'envoi, préfixe "shorts/" (filet de sécurité).
6. Render > Environment : R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET=kalchat-shorts  -> redéploie.
   Dans les logs : "K-Short activé". L'onglet K-Short apparaît alors tout seul.

Réglages facultatifs (Render) : SHORTS_MAX_MB (50), SHORTS_PER_DAY (10), SHORTS_GET_TTL_SEC (1800), SHORTS_SIGN_LENGTH=1 (à tester avant).
