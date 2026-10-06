import type { ReactNode } from "react";

export const SUPPORT_EMAIL = "kalchat.service@gmail.com";
export const LEGAL_UPDATED = "6 octobre 2026";

type Section = { title: string; paras?: string[]; bullets?: string[] };

function Sections({ sections }: { sections: Section[] }): ReactNode {
  return (
    <div className="space-y-5">
      {sections.map((s, i) => (
        <section key={s.title}>
          <h2 className="mb-1.5 text-sm font-bold text-foreground">{i + 1}. {s.title}</h2>
          {s.paras?.map((p) => (
            <p key={p} className="mb-2 text-sm leading-relaxed text-muted-foreground">{p}</p>
          ))}
          {s.bullets && (
            <ul className="list-disc space-y-1 pl-5 text-sm leading-relaxed text-muted-foreground">
              {s.bullets.map((b) => <li key={b}>{b}</li>)}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

const TERMS: Section[] = [
  {
    title: "Présentation",
    paras: [
      "Kalchat est un réseau social francophone : publications, stories, messagerie et groupes. En créant un compte ou en utilisant Kalchat, tu acceptes les présentes conditions d'utilisation.",
    ],
  },
  {
    title: "Ton compte",
    bullets: [
      "Tu dois avoir au moins 13 ans. Si tu es mineur, tu confirmes avoir l'accord d'un parent ou tuteur légal lorsque la loi de ton pays l'exige.",
      "Les informations que tu donnes doivent être exactes.",
      "Ton mot de passe est personnel : ne le partage pas. Tu es responsable de l'activité de ton compte.",
      "Une personne = un compte. Tu ne dois pas usurper l'identité de quelqu'un d'autre.",
    ],
  },
  {
    title: "Ton contenu",
    paras: [
      "Tu restes propriétaire de ce que tu publies (textes, photos, vidéos, messages vocaux). En le publiant, tu nous autorises à l'héberger, l'afficher et le diffuser dans Kalchat, selon tes réglages de confidentialité, uniquement pour faire fonctionner le service.",
      "Tu garantis avoir les droits nécessaires sur ce que tu publies et tu en es seul responsable.",
    ],
  },
  {
    title: "Ce qui est interdit",
    bullets: [
      "Harcèlement, menaces, insultes, discours de haine ou discrimination.",
      "Contenu sexuel impliquant des mineurs, violence extrême, incitation à se faire du mal ou à en faire à autrui.",
      "Arnaques, spam, fausses informations destinées à tromper, publicité abusive.",
      "Partage de données privées d'autrui sans son accord (adresse, numéro, photos intimes…).",
      "Contenu illégal ou qui porte atteinte aux droits d'autrui (droits d'auteur, image, vie privée).",
      "Piratage, collecte automatisée de données ou contournement de la sécurité de Kalchat.",
    ],
  },
  {
    title: "Signalement et modération",
    paras: [
      "Tu peux bloquer un compte ou signaler un contenu ou un profil depuis l'application. Kalchat peut retirer un contenu, limiter ou suspendre un compte, ou le supprimer, si ces conditions ne sont pas respectées.",
    ],
  },
  {
    title: "Kora IA",
    paras: [
      "Kora IA est un assistant basé sur l'intelligence artificielle. Ses réponses peuvent contenir des erreurs et ne remplacent pas l'avis d'un professionnel (médecin, avocat, etc.). N'envoie pas d'informations sensibles à Kora : tes messages à Kora sont traités par un prestataire d'IA externe pour générer les réponses.",
    ],
  },
  {
    title: "Disponibilité du service",
    paras: [
      "Kalchat est fourni « tel quel ». Le service peut être interrompu ou modifié, notamment pour maintenance ou évolution, sans garantie de disponibilité permanente.",
    ],
  },
  {
    title: "Responsabilité",
    paras: [
      "Dans les limites permises par la loi, Kalchat n'est pas responsable des contenus publiés par les utilisateurs, ni des dommages indirects liés à l'utilisation du service.",
    ],
  },
  {
    title: "Supprimer ton compte",
    paras: [
      "Tu peux supprimer ton compte à tout moment depuis Paramètres, puis Informations du compte.",
    ],
  },
  {
    title: "Modifications",
    paras: [
      "Nous pouvons faire évoluer ces conditions. En cas de changement important, tu en seras informé dans l'application. Continuer à utiliser Kalchat après une mise à jour vaut acceptation.",
    ],
  },
  {
    title: "Contact",
    paras: ["Une question ou un problème ? Écris-nous à " + SUPPORT_EMAIL + "."],
  },
];

const PRIVACY: Section[] = [
  {
    title: "Qui sommes-nous",
    paras: [
      "Kalchat est un réseau social francophone. Cette politique explique quelles données nous utilisons et pourquoi. Pour toute question : " + SUPPORT_EMAIL + ".",
    ],
  },
  {
    title: "Les données que nous utilisons",
    bullets: [
      "Compte : prénom, nom, nom d'utilisateur, adresse email (si tu la renseignes), mot de passe (stocké sous forme chiffrée) et photo de profil.",
      "Contenu : publications, stories, commentaires, messages, photos, vidéos et messages vocaux.",
      "Activité et réglages : abonnements, comptes bloqués, signalements, thème, sujets masqués, et, si tu les actives, présence en ligne et accusés de lecture.",
      "Données techniques : identifiant de notification push de ton téléphone et informations techniques de connexion nécessaires au fonctionnement et à la sécurité.",
    ],
  },
  {
    title: "Pourquoi nous les utilisons",
    bullets: [
      "Créer ton compte, te connecter et faire fonctionner Kalchat.",
      "T'envoyer des emails (code de vérification, récupération de mot de passe) et des notifications.",
      "Protéger la communauté : signalements, modération, lutte contre les abus et les fraudes.",
      "Répondre à tes demandes d'aide et améliorer le service.",
    ],
    paras: ["Nous ne vendons pas tes données personnelles."],
  },
  {
    title: "Prestataires techniques",
    paras: [
      "Pour faire fonctionner Kalchat, nous faisons appel à des prestataires qui traitent des données uniquement pour notre compte :",
    ],
    bullets: [
      "Hébergement du service : Render.",
      "Base de données et stockage des fichiers : Supabase.",
      "Envoi des emails : Resend.",
      "Notifications push sur Android : Firebase (Google).",
      "Assistant Kora IA : un fournisseur d'IA externe, qui reçoit uniquement les messages que tu envoies à Kora.",
    ],
  },
  {
    title: "Qui voit quoi",
    paras: [
      "Tes publications sont visibles selon tes réglages. Tes messages privés ne sont visibles que par leurs destinataires. Les contenus et profils signalés peuvent être examinés par l'équipe de modération.",
    ],
  },
  {
    title: "Durée de conservation",
    paras: [
      "Nous gardons tes données tant que ton compte existe. Les stories disparaissent après la durée choisie. Quand tu supprimes ton compte, tes données sont supprimées dans un délai raisonnable, sauf obligation légale ou copie de sauvegarde temporaire.",
    ],
  },
  {
    title: "Tes droits",
    bullets: [
      "Consulter et modifier tes informations depuis Paramètres.",
      "Supprimer ton compte depuis Paramètres, puis Informations du compte.",
      "Demander une copie ou la correction de tes données en écrivant à " + SUPPORT_EMAIL + ".",
      "Désactiver les notifications à tout moment depuis Paramètres.",
    ],
  },
  {
    title: "Sécurité",
    paras: [
      "Les échanges avec Kalchat sont chiffrés (HTTPS) et les mots de passe sont stockés sous forme chiffrée. Aucun système n'est parfaitement sûr : choisis un mot de passe solide et ne le partage pas.",
    ],
  },
  {
    title: "Mineurs",
    paras: [
      "Kalchat n'est pas destiné aux moins de 13 ans. Si tu penses qu'un enfant de moins de 13 ans a créé un compte, écris-nous pour que nous le supprimions.",
    ],
  },
  {
    title: "Modifications",
    paras: [
      "Nous pouvons mettre à jour cette politique. La date de dernière mise à jour est indiquée en haut de la page.",
    ],
  },
];

export function TermsContent() {
  return <Sections sections={TERMS} />;
}

export function PrivacyContent() {
  return <Sections sections={PRIVACY} />;
}
