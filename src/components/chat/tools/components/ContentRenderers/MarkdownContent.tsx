import { type FC } from 'react';
import { Markdown } from '../../../view/subcomponents/Markdown';

type MarkdownContentProps = {
  content: string;
  className?: string;
}

export const MarkdownContent: FC<MarkdownContentProps> = ({
  content,
  className = 'mt-1 prose prose-sm max-w-none dark:prose-invert'
}) => {
  return (
    <Markdown className={className}>
      {content}
    </Markdown>
  );
};
