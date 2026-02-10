# HabboCity Nitro Emoji & GIF Extension

Cette extension Chromium permet d'utiliser des emojis et GIFs personnalisés sur le client Nitro de HabboCity. Elle s'intègre nativement au chat pour enrichir l'expérience utilisateur tout en restant légère.

## Fonctionnement Technique

1.  **Parsing de Codes Directs** : L'extension scanne les messages envoyés et reçus. Les codes de type `:dance:` sont automatiquement détectés et remplacés par les GIFs correspondants s'ils existent dans la base.
2.  **Synchronisation Cloud (Supabase)** : La liste des GIFs est stockée sur **Supabase** et synchronisée au lancement. Cela permet une mise à jour instantanée pour tous les utilisateurs sans recharger l'extension.
3.  **Rendu Local (Twemoji)** : Pour garantir une esthétique homogène, les emojis standards (Unicode) sont automatiquement convertis en images **Twemoji** (le style standard de Twitter/Discord).
4.  **Gestion de l'Identité** : L'extension utilise un système de login transparent via la commande `:login` pour identifier les contributeurs et administrateurs.

## Fonctionnalités Clés

-   **Interface Intuitive** : Un panel fluide avec des onglets dédiés pour les GIFs et les Emojis.
-   **Auto-Send** : Un simple clic sur un GIF suffit pour l'envoyer instantanément si votre champ de texte est vide.
-   **Adaptation Intelligente** : Les GIFs sont automatiquement redimensionnés pour s'intégrer parfaitement aux dimensions des bulles de chat Nitro.
-   **Gestion Administrative Intégrée** : Les administrateurs peuvent ajouter ou supprimer des GIFs directement depuis l'extension grâce à un système de token sécurisé (RLS policies).
-   **Lisibilité Maximale** : Pour les joueurs n'ayant pas l'extension, les codes restent lisibles (ex: `:drake:`) au lieu de codes techniques illisibles.

## Installation

1.  Activez le **Mode Développeur** dans `chrome://extensions`.
2.  Cliquez sur **Charger l'extension décompressée** et sélectionnez le dossier racine.
3.  Utilisez le bouton `🙂` à côté de votre barre de chat pour commencer !

> [!IMPORTANT]
> Pour les administrateurs, assurez-vous de configurer votre token secret dans `config.js` et de synchroniser vos politiques RLS sur Supabase via le fichier `supabase_setup.sql`.
