# Magnum Kubernetes dans le fork Skyline

Les écarts décrivent la branche `master` du fork au commit `5a8ca40e`. La branche `feat/magnum-cli-parity` met en œuvre les parcours retenus pour Hibiscus et CAPI Helm 1.4.0. [Vérification des modèles historiques sur Hibiscus](11-verification-hibiscus.md) · [Conception des écrans](../../superpowers/specs/2026-11-20-magnum-hibiscus-design.md) · [Plan et tests](../../superpowers/plans/2026-11-20-magnum-hibiscus.md)

**Magnum permet bien de créer plusieurs pools de workers dans un même cluster Kubernetes.** La ressource s’appelle `nodegroup`. Le cluster démarre avec `default-master` et `default-worker`. Un membre autorisé peut ensuite ajouter, par exemple, un groupe de calcul avec un autre flavor Nova. Sur le commit de référence, Skyline affiche les totaux du cluster et propose un redimensionnement, mais aucun écran ne permet de voir ses groupes ou d’en créer un. [Guide OpenStack des groupes](https://opendev.org/openstack/magnum/src/commit/68befbf84e8ec50e57dee682cea9398bba606904/doc/source/user/node-groups.rst) · [Fiche cluster Skyline](https://github.com/armeldemarsac92/skyline-console/blob/5a8ca40e86cbcbacf725b38fc14ca5acbed1e19a/src/pages/container-infra/containers/Clusters/Detail/index.jsx) · [Actions accessibles](https://github.com/armeldemarsac92/skyline-console/blob/5a8ca40e86cbcbacf725b38fc14ca5acbed1e19a/src/pages/container-infra/containers/Clusters/actions/index.jsx)

## Pourquoi corriger le redimensionnement en premier ?

**Le formulaire « Resize Cluster » du commit de référence peut demander trop de VM sur un cluster qui compte déjà plusieurs pools.** Magnum renvoie dans `cluster.node_count` la somme des workers de tous les groupes. Skyline préremplit la nouvelle taille avec ce total + 1 et envoie la demande sans `nodegroup`. Magnum l’applique alors au groupe worker par défaut. Avec 2 workers par défaut et 3 dans un autre pool, valider **6** demanderait de faire passer le groupe par défaut de 2 à 6, soit **9 workers au total** si l’opération aboutit. C’est un écart établi par lecture du code, pas un incident observé. [Calcul du total](https://opendev.org/openstack/magnum/src/commit/68befbf84e8ec50e57dee682cea9398bba606904/magnum/objects/cluster.py#L165) · [Formulaire Skyline](https://github.com/armeldemarsac92/skyline-console/blob/5a8ca40e86cbcbacf725b38fc14ca5acbed1e19a/src/pages/container-infra/containers/Clusters/actions/Resize.jsx) · [Choix du groupe par Magnum](https://opendev.org/openstack/magnum/src/commit/68befbf84e8ec50e57dee682cea9398bba606904/magnum/api/controllers/v1/cluster_actions.py#L100)

La branche de fonctionnalité affiche désormais les groupes dans le détail du cluster avec leur rôle, leur flavor, leur taille et leur état. Elle permet de créer un groupe et de le redimensionner par UUID. Le formulaire part de la taille du groupe sélectionné. Les bornes d’autoscaling et la suppression d’un groupe supplémentaire complètent ce parcours. CAPI Helm 1.4.0 ne transmet pas les labels Kubernetes et les taints des groupes au chart.

## Où trouver chaque constat ?

Les 29 commandes `openstack coe` enregistrées par le plugin stable sont réparties ci-dessous. « Présent » ou « partiel » décrit un parcours accessible dans le code de ce fork. La présence d’une méthode HTTP ou d’un fichier JSX isolé ne suffit pas. [Registre officiel des commandes](https://opendev.org/openstack/python-magnumclient/src/commit/cf374db1a93cc0fe8d326a61333837e3b7eeb0e9/pyproject.toml) · [Référence de la CLI 2026.2](https://docs.openstack.org/python-openstackclient/2026.2/cli/plugin-commands/magnum.html)

| Fiche | Commandes après `openstack coe` | Couverture sur le commit de référence |
|---|---|---|
| [01 · Groupes de nœuds](01-nodegroups.md) | `nodegroup list/show/create/update/delete` | Les cinq opérations manquent. Contient les contrats HTTP, les restrictions sur les groupes par défaut et des exemples. |
| [02 · Cycle de vie du cluster](02-cycle-du-cluster.md) | `cluster list/show/create/update/delete` | Liste, détail, création et suppression accessibles selon la vue. Options de création et édition après création partiellement ou non exposées. |
| [03a · Redimensionnement](03a-redimensionner-un-groupe.md) | `cluster resize` | Partiel. L’écran ignore le groupe cible et utilise le total des workers. |
| [03b · Mise à niveau](03b-mise-a-niveau.md) | `cluster upgrade` | Modale présente dans le code, absente des actions accessibles. |
| [04a · Kubeconfig](04a-kubeconfig.md) | `cluster config` | Adresse Kubernetes visible. La génération du fichier manque. |
| [04b · Certificats](04b-certificats.md) | `ca show/sign/rotate` | Consultation de la CA, signature d’une demande et rotation absentes. |
| [04c · Identifiant du cluster](04c-rotation-identifiant.md) | `credential rotate` | Rotation de l’identifiant OpenStack absente. |
| [05 · Modèles de clusters](05-modeles.md) | `cluster template list/show/create/update/delete` | Écrans existants. En création, le formulaire omet `coe`, pourtant obligatoire côté Magnum. Tags et sélection du pilote manquent aussi. |
| [08 · Quotas](08-quotas.md) | `quotas list/show/create/update/delete` | Consultation du quota projet et administration de la limite déjà intégrées. Liste globale et retour au défaut manquent. |
| [09 · Statistiques](09-statistiques.md) | `stats list` | Les compteurs agrégés Magnum ne sont pas consommés. |
| [10 · Services Magnum](10-services-magnum.md) | `service list` | Inventaire des conducteurs absent de l’administration Skyline. |

Trois fiches répondent aux questions communes à plusieurs parcours :

- [06a · Microversions](06a-microversions.md) explique comment obtenir le contrat attendu et préserver la lecture du détail des clusters.
- [06b · Autorisations](06b-droits-dans-skyline.md) décrit la résolution des règles dans le fork avant de présenter une action.
- [07 · Effets du pilote CAPI Helm](07-pilote-capi-helm.md) indique ce qui arrive jusqu’aux machines. Elle couvre les flavors, les bornes d’autoscaling, les champs de placement et la portée du redimensionnement et de la mise à niveau.

L’API monte également un contrôleur de fédérations. Le plugin stable étudié n’enregistre aucune commande `openstack coe federation`, et CAPI Helm lève `NotImplementedError` pour les opérations correspondantes. Les fédérations ne sont donc pas comptées comme un écart de parité CLI. [Racine v1](https://opendev.org/openstack/magnum/src/commit/68befbf84e8ec50e57dee682cea9398bba606904/magnum/api/controllers/v1/__init__.py) · [Méthodes du pilote](https://opendev.org/openstack/magnum-capi-helm/src/commit/a8b82c2480a286a10b60ecc1d94c6cd9f1d01823/magnum_capi_helm/driver.py#L1455)

## Références et périmètre

Étude du **20 novembre 2026**. La cible associe la série OpenStack 2026.2 (Hibiscus) et le pilote officiel CAPI Helm 1.4.0, dernière version stable publiée à la date de l’étude. Les commandes proviennent des entrées OSC et de leurs gestionnaires Python. Les routes, validations et statuts proviennent des contrôleurs et du conducteur. Côté Skyline, l’analyse suit les routes, les actions enregistrées, les formulaires et le client HTTP. Les guides publics expliquent l’intention et les fiches signalent leurs écarts avec le code. Les conclusions portent sur les révisions suivantes, sans exécution sur un cloud.

| Composant | Révision étudiée |
|---|---|
| Fork Skyline Console, `master` | [`5a8ca40e`](https://github.com/armeldemarsac92/skyline-console/blob/5a8ca40e86cbcbacf725b38fc14ca5acbed1e19a/src/client/magnum/index.js), incluant la stable officielle `9b839364` |
| API et conducteur Magnum, `stable/2026.2` | [`68befbf8`](https://opendev.org/openstack/magnum/src/commit/68befbf84e8ec50e57dee682cea9398bba606904/magnum/api/controllers/v1) |
| Plugin `python-magnumclient`, `stable/2026.2` | [`cf374db1`](https://opendev.org/openstack/python-magnumclient/src/commit/cf374db1a93cc0fe8d326a61333837e3b7eeb0e9/magnumclient/osc/v1) |
| Pilote officiel `magnum-capi-helm` (publication indépendante) | [Tag `1.4.0`, commit `a8b82c24`](https://opendev.org/openstack/magnum-capi-helm/src/commit/a8b82c2480a286a10b60ecc1d94c6cd9f1d01823/magnum_capi_helm/driver.py) · [Versions officielles OpenStack](https://releases.openstack.org/teams/magnum.html#magnum-capi-helm) |

La [référence REST Magnum](https://docs.openstack.org/api-ref/container-infrastructure-management/) est incomplète sur les nodegroups. Le [guide utilisateur](https://docs.openstack.org/magnum/latest/user/#node-groups), les [notes de la série 2026.2](https://docs.openstack.org/releasenotes/magnum/2026.2.html) et les sources épinglées permettent de retrouver le contrat utilisé dans ces fiches.
