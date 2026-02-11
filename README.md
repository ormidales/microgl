## Concept
Développement d'un moteur de rendu 3D WebGL 2.0 minimaliste et performant, structuré autour d'une architecture Entity-Component-System (ECS). L'objectif est de fournir une alternative légère (sous les 50kb gzipped) aux frameworks majeurs pour le prototypage rapide et les jeux web à faible consommation de ressources.

## Stack Technique

* **Langage Principal** : TypeScript (Typage strict pour la maintenabilité et l'autocomplétion).
* **API Graphique** : WebGL 2.0 (Support natif large, performance supérieure à WebGL 1).
* **Architecture** : ECS (Entity Component System) pour la gestion optimisée de la mémoire et la composition logique.
* **Mathématiques** : gl-matrix (Standard industriel pour les opérations matricielles/vectorielles).
* **Build System** : Vite (HMR rapide, bundling optimisé avec Rollup).
* **Shaders** : GLSL ES 3.0.
