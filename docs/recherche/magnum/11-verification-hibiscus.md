# Vérification des modèles historiques sur Hibiscus

Le 20 novembre 2026, Chrome a exécuté les fichiers JavaScript extraits des images GHCR `2606db7` et `61a6f90`, puis ceux d’une compilation de production du correctif. Le fichier `commit_id.txt` des deux images correspond au tag testé. Magnum, Nova, les profils et les autres services ont été simulés sur le loopback. Les fichiers de l’audit initial étaient indisponibles. Les UUID, les bornes et les régions de cette vérification sont synthétiques.

Les deux cas historiques ont un modèle `driver: null`, le triplet `vm / ubuntu / kubernetes` et le label de chart `0.29.0+mustelinet.4` ou `0.29.0+mustelinet.5`. La région de test associe explicitement le triplet à `k8s_capi_helm_v1`. L’effectif initial est de 1 ou 2 workers, et les bornes permettent une montée en charge. Le test d’assistant utilise la même saveur de 2 vCPU et 4 GiB sur un plan de contrôle et deux workers. [Configuration de la résolution](07-pilote-capi-helm.md#modèles-historiques-et-régions)

| Parcours vérifié | Image `61a6f90` | Correctif |
|---|---|---|
| Afficher les deux clusters historiques | Un appel Heat par cluster. Création de groupe et édition des bornes absentes. | Aucun appel Heat. La création de groupe, l’édition des bornes et le resize du plan de contrôle sont accessibles au membre autorisé. |
| Worker dont l’autoscaler gouverne la taille | L’action de resize est disponible avec le pilote historique. | Les bornes effectives sont visibles. Le champ de resize est désactivé et le callback refuse la soumission. |
| Créer avec zéro worker et autoscaling hérité actif | Le champ a un minimum de 0. Le callback émet un POST en 1.10. | Le champ a un minimum de 1. Le callback refuse la demande avant tout POST. |
| Prévisualiser le quota pour une saveur héritée par nom | 0 vCPU et 0 GiB. | 6 vCPU et 12 GiB. |
| Modèle au pilote explicite, cluster en suppression, triplet inconnu | Le pilote explicite donne accès aux parcours CAPI. | Le pilote explicite conserve ses actions. Le cluster en suppression reste consultable. Les actions CAPI restent indisponibles pour un triplet inconnu. |

Sur l’image `2606db7`, la fiche produit un appel Heat sur les deux cas historiques. L’onglet des groupes est absent, le champ de création a un minimum de 1 et la prévisualisation de quota renvoie 0 pour la saveur par nom. Ces constats portent sur les images publiées exécutées avec les réponses simulées.

## Rejouer les régressions

Au terme de la revue, les 136 tests des 25 suites ont réussi sous Node 16.20.2. Webpack a compilé le bundle de production et ESLint a contrôlé les fichiers source modifiés.

Depuis le dépôt avec les dépendances installées, `yarn test:unit --runInBand` lance la suite complète. Le parcours multi-pools se rejoue avec `yarn test:unit --runInBand test/unit/magnum-nodegroups.spec.jsx`. Il vérifie la lecture par UUID, le corps et la microversion des mutations, un refus 403, les droits du lecteur, du membre propriétaire et des utilisateurs d’un autre projet. Dans Chrome, un clic sur le modèle puis deux clics sur « Suivant » atteignent l’étape réseau avec les deux saveurs héritées. Le test de navigation vérifie également le changement de modèle et la requête finale. Avec l’autoscaling actif, la soumission de deux workers avec un label de minimum à zéro est refusée avant tout POST. [Groupes de nœuds](../../../test/unit/magnum-nodegroups.spec.jsx) · [Assistant cluster](../../../src/pages/container-infra/containers/Clusters/actions/StepCreate/index.test.jsx) · [Navigation de l’assistant](../../../src/pages/container-infra/containers/Clusters/actions/StepCreate/navigation.test.jsx) · [Assistant modèle](../../../src/pages/container-infra/containers/ClusterTemplates/actions/StepCreate/index.spec.jsx)

La convergence du chart et le comportement du véritable autoscaler restent à qualifier sur le cloud. Aucun cluster, modèle ou nœud de locataire n’a été modifié.
