# Features Inventory — CloudCLI (fork)

Inventaire des fonctionnalités spécifiques au fork (au-delà de l'upstream siteboon).

| Feature | Description | Fichiers clés |
|---|---|---|
| Sélecteur de mode de permission (Claude) | Pill + dropdown dans le composer (à côté du contexte) pour choisir le mode **Plan / Auto / Bypass**. Le mode est envoyé au SDK par message et basculable à chaud (`query.setPermissionMode` via bridge). Le badge est réconcilié avec le **vrai** mode émis par le SDK (`system/init` & `system/status`). Persisté dans `localStorage['claude-permission-mode']`. **Défaut = `auto`** (human-in-the-loop). | `src/components/chat/constants/permissionModes.ts`, `src/components/chat/view/subcomponents/PermissionModeSelector.tsx`, `useChatComposerState.ts`, `useChatRealtimeHandlers.ts`, `server/claude-sdk.js` |
| Approbation interactive des outils (Claude) | Bannière inline **Accepter / Toujours accepter / Refuser** quand le SDK escalade un outil (mode `auto`/`default`). La demande **attend indéfiniment** (plus d'auto-refus 60s) et **survit aux déconnexions / fermeture de l'app** : le serveur garde la demande en attente et la **ré-émet à la reconnexion** (`check-session-status`). **« Toujours accepter » persiste une règle NATIVE** dans `.claude/settings.json` via `updatedPermissions` du SDK (pas une couche CloudCLI). `bypassPermissions` reste sans prompt ; `plan` n'exécute rien. | `server/claude-sdk.js` (`canUseTool`, `pendingToolApprovals`, `waitForToolApproval`, `resolveToolApproval`, `getPendingApprovalsForSession`, `buildPermissionRule`), `server/modules/websocket/services/chat-websocket.service.ts`, `server/shared/types.ts`, `src/components/chat/hooks/useChatPermissions.ts`, `src/components/chat/view/subcomponents/PermissionRequestsBanner.tsx`, `src/components/chat/hooks/useChatRealtimeHandlers.ts`, `src/components/chat/view/ChatInterface.tsx` |

## Notes
- Facturation **abonnement** préservée : `CLAUDE_CODE_ENTRYPOINT=cli` + `pathToClaudeCodeExecutable` (binaire CLI loggué) dans `server/claude-sdk.js`. Ne pas introduire de clé API.
