import type { ComponentProps } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

type AssistantMarkdownProps = { readonly text: string };

export function AssistantMarkdown({ text }: AssistantMarkdownProps) {
  return (
    <div className="assistant-markdown">
      <ReactMarkdown
        skipHtml
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          img: () => null,
          a: SafeLink,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function SafeLink({ children, ...props }: ComponentProps<'a'>) {
  return (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
