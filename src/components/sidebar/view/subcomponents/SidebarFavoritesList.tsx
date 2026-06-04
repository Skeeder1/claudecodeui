import { useState } from 'react';
import type { TFunction } from 'i18next';
import { Star } from 'lucide-react';
import { Spinner } from '../../../../shared/view/ui';

import type { MergedFavoriteGroup } from '../../hooks/useSidebarController';
import type { SessionWithProvider } from '../../types/types';
import type { SidebarProjectListProps } from './SidebarProjectList';
import SidebarProjectItem from './SidebarProjectItem';

type SidebarFavoritesListProps = {
  mergedFavoriteGroups: MergedFavoriteGroup[];
  isLoading: boolean;
  projectListProps: SidebarProjectListProps;
  onMarkSessionRead: (sessionId: string) => void;
  t: TFunction;
};

export default function SidebarFavoritesList({
  mergedFavoriteGroups,
  isLoading,
  projectListProps,
  onMarkSessionRead,
  t,
}: SidebarFavoritesListProps) {
  const MAX_OPEN = 3;
  const [expandedIds, setExpandedIds] = useState<string[]>([]);

  if (isLoading && mergedFavoriteGroups.length === 0) {
    return (
      <div className="px-4 py-12 text-center md:py-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
          <Spinner />
        </div>
        <p className="text-sm text-muted-foreground">
          {t('favorites.loading', 'Loading favorites...')}
        </p>
      </div>
    );
  }

  if (mergedFavoriteGroups.length === 0) {
    return (
      <div className="px-4 py-12 text-center md:py-8">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-muted md:mb-3">
          <Star className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="mb-2 text-base font-medium text-foreground md:mb-1">
          {t('favorites.empty.title', 'No favorite conversations yet')}
        </h3>
        <p className="text-sm text-muted-foreground">
          {t(
            'favorites.empty.description',
            'Star a conversation from the projects tab to pin it here for fast access and status alerts.',
          )}
        </p>
      </div>
    );
  }

  const handleToggleProject = (projectId: string) => {
    setExpandedIds((prev) => {
      if (prev.includes(projectId)) {
        return prev.filter((id) => id !== projectId);
      }
      const next = [...prev, projectId];
      return next.length > MAX_OPEN ? next.slice(1) : next;
    });
  };

  return (
    <div className="space-y-1 px-1.5">
      {mergedFavoriteGroups.map((group) => {
        const project = projectListProps.projects.find(
          (p) => p.projectId === group.projectId || p.fullPath === group.projectPath,
        );
        if (!project) return null;

        const handleSessionSelect = (session: SessionWithProvider, projectId: string) => {
          if (projectListProps.sessionStatusMap?.get(session.id) === 'done_unread') {
            onMarkSessionRead(session.id);
          }
          projectListProps.onSessionSelect(session, projectId);
        };

        const favoriteSessionIds = new Set(group.sessions.map((s) => s.sessionId));
        const favoriteSessions = projectListProps
          .getProjectSessions(project)
          .filter((s) => favoriteSessionIds.has(s.id));

        return (
          <SidebarProjectItem
            key={project.projectId}
            project={project}
            selectedProject={projectListProps.selectedProject}
            selectedSession={projectListProps.selectedSession}
            isExpanded={expandedIds.includes(project.projectId)}
            isDeleting={projectListProps.deletingProjects.has(project.projectId)}
            isStarred={projectListProps.isProjectStarred(project.projectId)}
            editingProject={projectListProps.editingProject}
            editingName={projectListProps.editingName}
            sessions={favoriteSessions}
            initialSessionsLoaded={projectListProps.initialSessionsLoaded.has(project.projectId)}
            isLoadingMoreSessions={projectListProps.loadingMoreProjects.has(project.projectId)}
            currentTime={projectListProps.currentTime}
            editingSession={projectListProps.editingSession}
            editingSessionName={projectListProps.editingSessionName}
            tasksEnabled={projectListProps.tasksEnabled}
            mcpServerStatus={projectListProps.mcpServerStatus}
            onEditingNameChange={projectListProps.onEditingNameChange}
            onToggleProject={handleToggleProject}
            onProjectSelect={projectListProps.onProjectSelect}
            onToggleStarProject={projectListProps.onToggleStarProject}
            onStartEditingProject={projectListProps.onStartEditingProject}
            onCancelEditingProject={projectListProps.onCancelEditingProject}
            onSaveProjectName={projectListProps.onSaveProjectName}
            onDeleteProject={projectListProps.onDeleteProject}
            onSessionSelect={handleSessionSelect}
            onDeleteSession={projectListProps.onDeleteSession}
            onLoadMoreSessions={projectListProps.onLoadMoreSessions}
            onNewSession={projectListProps.onNewSession}
            onEditingSessionNameChange={projectListProps.onEditingSessionNameChange}
            onStartEditingSession={projectListProps.onStartEditingSession}
            onCancelEditingSession={projectListProps.onCancelEditingSession}
            onSaveEditingSession={projectListProps.onSaveEditingSession}
            starredSessionIds={projectListProps.starredSessionIds}
            onToggleStarSession={projectListProps.onToggleStarSession}
            sessionStatusMap={projectListProps.sessionStatusMap}
            t={t}
          />
        );
      })}
    </div>
  );
}
