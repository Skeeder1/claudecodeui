# Features Inventory — CloudCLI (fork)

Inventaire des fonctionnalités spécifiques au fork (au-delà de l'upstream siteboon).

| Feature | Description | Fichiers clés |
|---|---|---|
| Sélecteur de mode de permission (Claude) | Pill + dropdown dans le composer (à côté du contexte) pour choisir le mode **Plan / Auto / Bypass**. Le mode est envoyé au SDK par message et basculable à chaud (`query.setPermissionMode` via bridge). Le badge est réconcilié avec le **vrai** mode émis par le SDK (`system/init` & `system/status`). Persisté dans `localStorage['claude-permission-mode']`. Modes restreints à ceux qui marchent sans UI d'approbation (celle-ci ayant été retirée). | `src/components/chat/constants/permissionModes.ts`, `src/components/chat/view/subcomponents/PermissionModeSelector.tsx`, `useChatComposerState.ts`, `useChatRealtimeHandlers.ts`, `server/claude-sdk.js` |

## Notes
- Facturation **abonnement** préservée : `CLAUDE_CODE_ENTRYPOINT=cli` + `pathToClaudeCodeExecutable` (binaire CLI loggué) dans `server/claude-sdk.js`. Ne pas introduire de clé API.
