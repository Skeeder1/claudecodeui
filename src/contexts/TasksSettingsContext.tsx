import React, { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { api } from '../utils/api';

type InstallationStatus = Record<string, unknown> | null;

type TasksSettingsContextValue = {
  tasksEnabled: boolean;
  setTasksEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  toggleTasksEnabled: () => void;
  isTaskMasterInstalled: boolean | null;
  isTaskMasterReady: boolean | null;
  installationStatus: InstallationStatus;
  isCheckingInstallation: boolean;
};

const TasksSettingsContext = createContext<TasksSettingsContextValue>({
  tasksEnabled: true,
  setTasksEnabled: () => {},
  toggleTasksEnabled: () => {},
  isTaskMasterInstalled: null,
  isTaskMasterReady: null,
  installationStatus: null,
  isCheckingInstallation: true,
});

export const useTasksSettings = () => {
  const context = useContext(TasksSettingsContext);
  if (!context) {
    throw new Error('useTasksSettings must be used within a TasksSettingsProvider');
  }
  return context;
};

export const TasksSettingsProvider = ({ children }: { children: ReactNode }) => {
  const [tasksEnabled, setTasksEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('tasks-enabled');
    return saved !== null ? JSON.parse(saved) : true;
  });

  const [isTaskMasterInstalled, setIsTaskMasterInstalled] = useState<boolean | null>(null);
  const [isTaskMasterReady, setIsTaskMasterReady] = useState<boolean | null>(null);
  const [installationStatus, setInstallationStatus] = useState<InstallationStatus>(null);
  const [isCheckingInstallation, setIsCheckingInstallation] = useState(true);

  useEffect(() => {
    localStorage.setItem('tasks-enabled', JSON.stringify(tasksEnabled));
  }, [tasksEnabled]);

  useEffect(() => {
    const checkInstallation = async () => {
      try {
        const response = await api.get('/taskmaster/installation-status');
        if (response.ok) {
          const data = await response.json();
          setInstallationStatus(data);
          setIsTaskMasterInstalled(data.installation?.isInstalled || false);
          setIsTaskMasterReady(data.isReady || false);

          if (data.installation?.isInstalled) {
            setTasksEnabled(true);
          } else {
            const userEnabledTasks = localStorage.getItem('tasks-enabled');
            if (!userEnabledTasks) {
              setTasksEnabled(false);
            }
          }
        } else {
          console.error('Failed to check TaskMaster installation status');
          setIsTaskMasterInstalled(false);
          setIsTaskMasterReady(false);
        }
      } catch (error) {
        console.error('Error checking TaskMaster installation:', error);
        setIsTaskMasterInstalled(false);
        setIsTaskMasterReady(false);
      } finally {
        setIsCheckingInstallation(false);
      }
    };

    setTimeout(checkInstallation, 0);
  }, []);

  const toggleTasksEnabled = () => {
    setTasksEnabled((prev) => !prev);
  };

  const contextValue: TasksSettingsContextValue = {
    tasksEnabled,
    setTasksEnabled,
    toggleTasksEnabled,
    isTaskMasterInstalled,
    isTaskMasterReady,
    installationStatus,
    isCheckingInstallation,
  };

  return <TasksSettingsContext.Provider value={contextValue}>{children}</TasksSettingsContext.Provider>;
};

export default TasksSettingsContext;
