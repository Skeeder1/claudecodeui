import LoadingState from '../../../../shared/view/ui/LoadingState';
import { getEditorLoadingStyles } from '../../utils/editorStyles';

type CodeEditorLoadingStateProps = {
  isDarkMode: boolean;
  isSidebar: boolean;
  loadingText: string;
};

export default function CodeEditorLoadingState({ isDarkMode, isSidebar, loadingText }: CodeEditorLoadingStateProps) {
  return (
    <>
      <style>{getEditorLoadingStyles(isDarkMode)}</style>
      {isSidebar ? (
        <LoadingState text={loadingText} variant="inline" />
      ) : (
        <LoadingState text={loadingText} variant="overlay" zIndex="z-[9999]" contentClassName="code-editor-loading" />
      )}
    </>
  );
}
