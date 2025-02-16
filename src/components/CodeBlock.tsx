import { Highlight, themes } from "prism-react-renderer";

interface CodeBlockProps {
  code: string;
  language?: string;
}

export default function CodeBlock({
  code,
  language = "typescript",
}: CodeBlockProps) {
  return (
    <Highlight theme={themes.github} code={code} language={language}>
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre className="overflow-x-auto" style={style}>
          <code className={`${className} block p-4 text-sm font-mono`}>
            {tokens.map((line, i) => {
              const lineProps = getLineProps({ line, key: i });
              const { key: _key, ...restLineProps } = lineProps;
              return (
                <div key={i} {...restLineProps}>
                  {line.map((token, key) => {
                    const tokenProps = getTokenProps({ token, key });
                    const { key: _tokenKey, ...restTokenProps } = tokenProps;
                    return <span key={key} {...restTokenProps} />;
                  })}
                </div>
              );
            })}
          </code>
        </pre>
      )}
    </Highlight>
  );
}
